import * as childProcess from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalPath,
  collectWorktrees,
  commitIsMerged,
  git,
  inspectNestedRepositories,
  nestedRepositoryBlocker,
  removeLinkedWorktree,
} from "./cleanup-git.js";
import { runGitWorkspaceCleanupCommand } from "./git-workspace-cleanup.js";
import { runPrMergeWorktreeCommand } from "./pr-merge-worktree.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function initRepo(directory: string) {
  await mkdir(directory, { recursive: true });
  await git(["init", "--initial-branch=main"], directory);
  await git(["config", "user.name", "Cleanup Test"], directory);
  await git(["config", "user.email", "cleanup@example.com"], directory);
  await writeFile(path.join(directory, "tracked.txt"), "delivered\n");
  await git(["add", "."], directory);
  await git(["commit", "-m", "initial"], directory);
}

async function fixture(nested = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-cleanup-"));
  roots.push(root);
  const source = path.join(root, "submodule-source");
  await initRepo(source);
  if (nested) {
    const inner = path.join(root, "inner-source");
    await initRepo(inner);
    await git(
      ["-c", "protocol.file.allow=always", "submodule", "add", inner, "inner"],
      source,
    );
    await git(["commit", "-am", "nested module"], source);
  }
  const primary = path.join(root, "primary");
  await initRepo(primary);
  await git(
    ["-c", "protocol.file.allow=always", "submodule", "add", source, "module"],
    primary,
  );
  await writeFile(path.join(primary, ".gitignore"), "ignored/\n");
  await git(["add", "."], primary);
  await git(["commit", "-m", "module delivered"], primary);
  const origin = path.join(root, "origin.git");
  await git(["clone", "--bare", primary, origin], root);
  await git(["remote", "add", "origin", origin], primary);
  await git(["fetch", "origin"], primary);
  await git(["branch", "--set-upstream-to=origin/main", "main"], primary);
  const linked = path.join(root, "linked");
  await git(["worktree", "add", "-b", "feature/delivered", linked], primary);
  await git(
    [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive",
    ],
    linked,
  );
  return { root, primary, linked, source };
}

describe("nested Git cleanup custody and removal", () => {
  it.each(["clean", "dirty", "local-only", "shared"])(
    "applies targeted cleanup to %s submodule custody",
    async (kind) => {
      const { root, primary, linked } = await fixture();
      const module = path.join(linked, "module");
      if (kind === "dirty")
        await writeFile(path.join(module, "untracked"), "keep");
      if (kind === "local-only") {
        await git(["config", "user.name", "Test"], module);
        await git(["config", "user.email", "test@example.com"], module);
        await writeFile(path.join(module, "local"), "keep");
        await git(["add", "."], module);
        await git(["commit", "-m", "local"], module);
        await git(["reset", "--hard", "origin/main"], module);
      }
      if (kind === "shared")
        await git(
          ["worktree", "add", "--detach", path.join(root, "external")],
          module,
        );
      const head = (await git(["rev-parse", "HEAD"], linked)).stdout.trim();
      const result = await runGitWorkspaceCleanupCommand([
        "--repo",
        primary,
        "--worktree",
        linked,
        "--branch",
        "feature/delivered",
        "--expected-head",
        head,
        "--execute",
      ]);
      expect(result.exitCode).toBe(kind === "clean" ? 0 : 1);
      expect(result.stdout).toContain(
        `WORKTREE_STATUS=${kind === "clean" ? "removed" : "retained"}`,
      );
      if (kind === "clean") expect(await canonicalPath(linked)).toBeNull();
      if (kind !== "clean") expect(await canonicalPath(linked)).not.toBeNull();
    },
  );

  it("removes clean initialized submodules without changing shared configuration or other worktrees", async () => {
    const { root, primary, linked } = await fixture();
    const unrelated = path.join(root, "active");
    await git(["worktree", "add", "-b", "feature/active", unrelated], primary);
    const configBefore = await readFile(
      path.join(primary, ".git", "config"),
      "utf8",
    );
    const primaryHead = (await git(["rev-parse", "HEAD"], primary)).stdout;
    const facts = await inspectNestedRepositories(linked);
    expect(facts).toHaveLength(1);
    expect(facts[0].reason).toBe("clean-initialized-submodule");
    expect(facts[0].commonDir).toBe(facts[0].gitDir);
    await removeLinkedWorktree(primary, linked);
    expect(await canonicalPath(linked)).toBeNull();
    expect(
      (await collectWorktrees(primary)).map((entry) =>
        path.basename(entry.path),
      ),
    ).toEqual(["primary", "active"]);
    expect(await readFile(path.join(primary, ".git", "config"), "utf8")).toBe(
      configBefore,
    );
    expect((await git(["rev-parse", "HEAD"], primary)).stdout).toBe(
      primaryHead,
    );
    expect((await git(["status", "--porcelain"], unrelated)).stdout).toBe("");
  });

  it("removes recursive clean submodules and classifies each separately", async () => {
    const { primary, linked } = await fixture(true);
    const facts = await inspectNestedRepositories(linked);
    expect(facts.map((fact) => fact.reason)).toEqual([
      "clean-initialized-submodule",
      "clean-initialized-submodule",
    ]);
    await removeLinkedWorktree(primary, linked);
    expect(await canonicalPath(linked)).toBeNull();
  });

  it("protects dirty nested work even with the broad dirty override and ignore configuration", async () => {
    const { primary, linked } = await fixture();
    await git(["config", "submodule.module.ignore", "all"], primary);
    await writeFile(path.join(linked, "module", "untracked.txt"), "preserve\n");
    expect(
      nestedRepositoryBlocker(await inspectNestedRepositories(linked)),
    ).toContain("dirty-or-untracked-submodule:");
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "dirty-or-untracked-submodule:",
    );
    expect(
      await readFile(path.join(linked, "module", "untracked.txt"), "utf8"),
    ).toBe("preserve\n");
  });

  it("retains ignored submodule artifacts even when ordinary dirty removal is authorized", async () => {
    const { primary, linked } = await fixture();
    const module = path.join(linked, "module");
    const admin = (
      await git(["rev-parse", "--absolute-git-dir"], module)
    ).stdout.trim();
    await writeFile(path.join(admin, "info", "exclude"), "artifact.cache\n");
    await writeFile(
      path.join(module, "artifact.cache"),
      "required local artifact\n",
    );
    expect(
      (await git(["status", "--porcelain", "--untracked-files=all"], module))
        .stdout,
    ).toBe("");
    for (const allowDirty of [false, true]) {
      await expect(
        removeLinkedWorktree(primary, linked, allowDirty),
      ).rejects.toThrow("dirty-or-untracked-submodule:");
    }
    expect(await readFile(path.join(module, "artifact.cache"), "utf8")).toBe(
      "required local artifact\n",
    );
    expect(await canonicalPath(linked)).not.toBeNull();
  });

  it("protects clean submodule-local commits including work reachable only through reflogs", async () => {
    const { primary, linked } = await fixture();
    const module = path.join(linked, "module");
    await git(["config", "user.name", "Cleanup Test"], module);
    await git(["config", "user.email", "cleanup@example.com"], module);
    await writeFile(path.join(module, "local.txt"), "unpublished\n");
    await git(["add", "."], module);
    await git(["commit", "-m", "local work"], module);
    await git(["reset", "--hard", "origin/main"], module);
    expect((await git(["status", "--porcelain"], module)).stdout).toBe("");
    await expect(removeLinkedWorktree(primary, linked)).rejects.toThrow(
      "submodule-local-only-work:",
    );
  });

  it("distinguishes ignored embedded repositories and never forces them", async () => {
    const { primary, linked } = await fixture();
    await initRepo(path.join(linked, "ignored", "embedded"));
    const facts = await inspectNestedRepositories(linked);
    expect(
      facts.some(
        (fact) =>
          fact.kind === "embedded" && fact.reason === "embedded-repository",
      ),
    ).toBe(true);
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "embedded-repository:",
    );
    const result = await runGitWorkspaceCleanupCommand([
      "--repo",
      primary,
      "--execute",
      "--force-dirty-worktrees",
      "--force-branches",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("STATUS=blocked");
    expect(result.stdout).toContain("REASON=embedded-repository");
  });

  it("protects submodule administration shared with another checkout", async () => {
    const { primary, linked } = await fixture();
    const sharedDir = (
      await git(
        ["rev-parse", "--absolute-git-dir"],
        path.join(primary, "module"),
      )
    ).stdout.trim();
    await writeFile(
      path.join(linked, "module", ".git"),
      `gitdir: ${sharedDir}\n`,
    );
    await expect(removeLinkedWorktree(primary, linked)).rejects.toThrow(
      "shared-or-external-submodule-git-dir:",
    );
    expect(await canonicalPath(path.join(primary, "module"))).not.toBeNull();
  });

  it("protects a submodule's external linked checkout and ignored bare repositories", async () => {
    const { root, primary, linked, source } = await fixture();
    const module = path.join(linked, "module");
    const external = path.join(root, "module-active");
    await git(["worktree", "add", "--detach", external, "HEAD"], module);
    const externalHead = (await git(["rev-parse", "HEAD"], external)).stdout;
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "shared-submodule-worktrees:",
    );
    expect((await git(["rev-parse", "HEAD"], external)).stdout).toBe(
      externalHead,
    );
    await git(["worktree", "remove", external], module);
    await mkdir(path.join(linked, "ignored"));
    await git(
      ["clone", "--bare", source, path.join(linked, "ignored", "bare.git")],
      primary,
    );
    const facts = await inspectNestedRepositories(linked);
    expect(facts.find((fact) => fact.path.endsWith("bare.git"))?.kind).toBe(
      "embedded",
    );
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "embedded-repository:",
    );
  });

  it("protects cached administration after a submodule checkout is deinitialized", async () => {
    const { primary, linked } = await fixture();
    const module = path.join(linked, "module");
    const admin = (
      await git(["rev-parse", "--absolute-git-dir"], module)
    ).stdout.trim();
    // Remove only the temporary checkout, leaving its administration as deinit does.
    await rm(module, { recursive: true });
    await mkdir(module);
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "uninitialized-submodule-administration:",
    );
    expect(await readFile(path.join(admin, "HEAD"), "utf8")).not.toBe("");
  });

  it("protects primary and locked checkouts even through the shared removal primitive", async () => {
    const { primary, linked } = await fixture();
    await expect(removeLinkedWorktree(primary, primary, true)).rejects.toThrow(
      "protected or unregistered",
    );
    await git(["worktree", "lock", linked], primary);
    await expect(removeLinkedWorktree(primary, linked, true)).rejects.toThrow(
      "protected or unregistered",
    );
  });

  it("uses nested handling in scoped PR cleanup and leaves an unrelated active worktree", async () => {
    const { root, primary, linked } = await fixture();
    const unrelated = path.join(root, "active");
    await git(["worktree", "add", "-b", "feature/active", unrelated], primary);
    const head = (await git(["rev-parse", "HEAD"], linked)).stdout.trim();
    const previous = { ...process.env };
    Object.assign(process.env, {
      PR_STATE: "MERGED",
      PR_HEAD_BRANCH: "feature/delivered",
      PR_BASE_BRANCH: "main",
      PR_HEAD_SHA: head,
      PR_HEAD_REPO: "fork/repo",
      PR_BASE_REPO: "base/repo",
      PR_BASE_DEFAULT_BRANCH: "main",
      PR_BASE_REMOTE_URL: "unused",
      PRIMARY_WORKTREE: primary,
      HEAD_WORKTREE: linked,
      CURRENT_WORKTREE: primary,
    });
    try {
      process.env.HEAD_WORKTREE = unrelated;
      const mismatched = await runPrMergeWorktreeCommand(["cleanup"]);
      expect(mismatched.stdout).toContain("WORKTREE_CLEANUP=retained");
      expect(mismatched.stdout).toContain(
        "WORKTREE_CLEANUP_REASON=head-worktree-binding-mismatch",
      );
      expect(await canonicalPath(unrelated)).not.toBeNull();
      process.env.HEAD_WORKTREE = linked;
      const artifact = path.join(linked, "module", "local-artifact.txt");
      await writeFile(artifact, "preserve me\n");
      const dirtyNested = await runPrMergeWorktreeCommand(["cleanup"]);
      expect(dirtyNested.stdout).toContain(
        `WORKTREE_CLEANUP_REASON=dirty-or-untracked-submodule:${path.join((await canonicalPath(linked)) ?? linked, "module")}`,
      );
      expect(dirtyNested.stdout).toContain("LOCAL_BRANCH_CLEANUP=retained");
      expect(await readFile(artifact, "utf8")).toBe("preserve me\n");
      await rm(artifact);
      const result = await runPrMergeWorktreeCommand(["cleanup"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("WORKTREE_CLEANUP=removed");
      expect(result.stdout).toContain("LOCAL_BRANCH_CLEANUP=deleted");
      expect(await canonicalPath(linked)).toBeNull();
      expect(await canonicalPath(unrelated)).not.toBeNull();
      expect(
        (await git(["branch", "--show-current"], unrelated)).stdout.trim(),
      ).toBe("feature/active");
    } finally {
      process.env = previous;
    }
  });
});

describe("raw squash equivalence", () => {
  // CLEANUP-04, shared runtime proof: small patches lacked large-history coverage.
  it.each(["single", "aggregate"])(
    "recognizes squash delivery through %s history above the buffered limit",
    async (kind) => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-large-patch-"),
      );
      roots.push(root);
      await initRepo(root);
      await git(["checkout", "-b", "feature"], root);
      await writeFile(path.join(root, "tracked.txt"), "small feature\n");
      await git(["commit", "-am", "feature"], root);
      await git(["checkout", "main"], root);
      const count = kind === "single" ? 1 : 2;
      const size = kind === "single" ? 11 : 6;
      for (let index = 0; index < count; index++) {
        await writeFile(
          path.join(root, `unrelated-${index}`),
          "unrelated text line\n".repeat(Math.ceil((size * 1024 * 1024) / 20)),
        );
        await git(["add", "."], root);
        await git(["commit", "-m", "unrelated history"], root);
      }
      await git(["merge", "--squash", "feature"], root);
      await git(["commit", "-m", "squash delivery"], root);
      expect(await commitIsMerged(root, "feature", "main")).toBe(true);
    },
  );

  // CLEANUP-04 shared proof owns complete producer/consumer termination, even after a match.
  it.each(["producer", "consumer"])(
    "rejects a failed %s after matching output and reaps inspection children",
    async (failure) => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-failed-patch-"),
      );
      roots.push(root);
      await initRepo(root);
      await git(["checkout", "-b", "feature"], root);
      await writeFile(path.join(root, "tracked.txt"), "feature\n");
      await git(["commit", "-am", "feature"], root);
      await git(["checkout", "main"], root);
      await git(["merge", "--squash", "feature"], root);
      await git(["commit", "-m", "delivered"], root);
      const patch = (await git(["show", "--format=%H", "HEAD"], root)).stdout;
      const id = childProcess.spawnSync("git", ["patch-id", "--stable"], {
        input: patch,
        encoding: "utf8",
      }).stdout;
      const spawn = (
        await vi.importActual<typeof childProcess>("node:child_process")
      ).spawn;
      const children: ReturnType<typeof spawn>[] = [];
      let consumers = 0;
      const spy = vi
        .mocked(childProcess.spawn)
        .mockImplementation((...args: Parameters<typeof spawn>) => {
          const gitArgs = args[1] as string[];
          if (gitArgs.includes("patch-id")) consumers++;
          const inject =
            failure === "producer"
              ? gitArgs.includes("log")
              : consumers === 2 && gitArgs.includes("patch-id");
          const child = inject
            ? spawn(
                process.execPath,
                [
                  "-e",
                  failure === "producer"
                    ? "process.stdout.write(process.argv[1], () => process.exit(1))"
                    : "process.stdin.resume(); process.stdout.write(process.argv[1], () => process.exit(1))",
                  failure === "producer" ? patch : id,
                ],
                args[2],
              )
            : spawn(...args);
          children.push(child);
          return child;
        });
      try {
        await expect(commitIsMerged(root, "feature", "main")).rejects.toThrow(
          "patch equivalence inspection failed",
        );
        expect(children.length).toBeGreaterThan(0);
        expect(
          children.every(
            (child) => child.exitCode !== null || child.signalCode !== null,
          ),
        ).toBe(true);
      } finally {
        spy.mockImplementation(spawn);
        for (const child of children)
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
      }
    },
  );

  it("retains unique content hidden by a configured text conversion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-raw-patch-"));
    roots.push(root);
    await initRepo(root);
    await writeFile(path.join(root, "document"), "title\noriginal bytes\n");
    await writeFile(
      path.join(root, ".gitattributes"),
      "document diff=summary\n",
    );
    await git(
      [
        "config",
        "diff.summary.textconv",
        'node -e "process.stdout.write(1+String.fromCharCode(10))"',
      ],
      root,
    );
    await git(["add", "."], root);
    await git(["commit", "-m", "document"], root);
    await git(["checkout", "-b", "feature"], root);
    await writeFile(path.join(root, "tracked.txt"), "updated\n");
    await writeFile(path.join(root, "document"), "title\nunique work\n");
    await git(["commit", "-am", "mixed changes"], root);
    await git(["checkout", "main"], root);
    await writeFile(path.join(root, "tracked.txt"), "updated\n");
    await git(["commit", "-am", "delivered change"], root);
    expect(await commitIsMerged(root, "feature", "main")).toBe(false);
    await writeFile(path.join(root, "document"), "title\nunique work\n");
    await git(["commit", "--amend", "--no-edit", "-a"], root);
    await git(["config", "diff.external", "false"], root);
    expect(await commitIsMerged(root, "feature", "main")).toBe(true);
  });
});
