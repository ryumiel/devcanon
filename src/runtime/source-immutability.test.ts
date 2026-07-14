import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runSourceImmutabilityCommand } from "./source-immutability.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout;
}

async function fixture(
  options: { ephemeral?: boolean; commit?: boolean } = {},
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-source-guard-"));
  tempDirs.push(cwd);
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.name", "Test User");
  await git(cwd, "config", "user.email", "test@example.com");
  await writeFile(path.join(cwd, ".gitignore"), ".ephemeral/\nignored/\n");
  await writeFile(path.join(cwd, "tracked.txt"), "baseline\n");
  await writeFile(path.join(cwd, "mode.sh"), "#!/bin/sh\n");
  await chmod(path.join(cwd, "mode.sh"), 0o644);
  if (options.commit !== false) {
    await git(cwd, "add", ".gitignore", "tracked.txt", "mode.sh");
    await git(cwd, "commit", "-m", "chore: baseline");
  }
  if (options.ephemeral !== false) {
    await mkdir(path.join(cwd, ".ephemeral"));
  }
  return cwd;
}

async function capture(cwd: string, handoff?: string): Promise<string> {
  const result = await runSourceImmutabilityCommand(
    handoff === undefined ? ["capture"] : ["capture", "--handoff", handoff],
    cwd,
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(
    /^\.ephemeral\/\.devcanon-source-immutability-[0-9a-f]{32}\.json\n$/u,
  );
  return result.stdout.trim();
}

async function expectChanged(cwd: string, baseline: string) {
  await expect(
    runSourceImmutabilityCommand(["verify", "--baseline", baseline], cwd),
  ).resolves.toMatchObject({
    exitCode: 1,
    stdout: "",
    stderr: "source changed since the retained baseline was captured\n",
  });
}

describe("source-immutability runtime", () => {
  it("captures, verifies, and cleans a clean workspace with exact stdout", async () => {
    const cwd = await fixture();
    const baseline = await capture(cwd);
    expect((await lstat(path.join(cwd, baseline))).mode & 0o777).toBe(0o600);

    await expect(
      runSourceImmutabilityCommand(["verify", "--baseline", baseline], cwd),
    ).resolves.toEqual({ exitCode: 0, stdout: "unchanged\n", stderr: "" });
    await expect(
      runSourceImmutabilityCommand(["cleanup", "--baseline", baseline], cwd),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });
    await expect(lstat(path.join(cwd, baseline))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves staged, unstaged, binary, and nonignored untracked pre-dirt while excluding ignored changes", async () => {
    const cwd = await fixture();
    await writeFile(path.join(cwd, "staged.txt"), "staged\n");
    await git(cwd, "add", "staged.txt");
    await writeFile(path.join(cwd, "tracked.txt"), "unstaged\n");
    await writeFile(path.join(cwd, "binary.bin"), Buffer.from([0, 255, 1]));
    await writeFile(path.join(cwd, "untracked.txt"), "untracked\n");
    const baseline = await capture(cwd);

    await mkdir(path.join(cwd, "ignored"));
    await writeFile(
      path.join(cwd, "ignored", "noise.bin"),
      Buffer.from([9, 8, 7]),
    );
    await expect(
      runSourceImmutabilityCommand(["verify", "--baseline", baseline], cwd),
    ).resolves.toEqual({ exitCode: 0, stdout: "unchanged\n", stderr: "" });
  });

  it.each([
    {
      name: "staged index entries",
      mutate: async (cwd: string) => {
        await git(cwd, "update-index", "--chmod=+x", "mode.sh");
      },
    },
    {
      name: "unstaged tracked content",
      mutate: async (cwd: string) =>
        writeFile(path.join(cwd, "tracked.txt"), "changed\n"),
    },
    {
      name: "tracked file mode",
      mutate: async (cwd: string) => chmod(path.join(cwd, "mode.sh"), 0o755),
    },
    {
      name: "tracked file kind",
      mutate: async (cwd: string) => {
        await rm(path.join(cwd, "tracked.txt"));
        await symlink("mode.sh", path.join(cwd, "tracked.txt"));
      },
    },
    {
      name: "nonignored untracked content",
      before: async (cwd: string) =>
        writeFile(path.join(cwd, "loose.txt"), "one\n"),
      mutate: async (cwd: string) =>
        writeFile(path.join(cwd, "loose.txt"), "two\n"),
    },
    {
      name: "HEAD",
      mutate: async (cwd: string) => {
        await git(cwd, "commit", "--allow-empty", "-m", "test: move head");
      },
    },
    {
      name: "symbolic ref",
      mutate: async (cwd: string) => {
        await git(cwd, "switch", "-c", "same-head-other-ref");
      },
    },
  ])("detects $name changes", async ({ before, mutate }) => {
    const cwd = await fixture();
    await before?.(cwd);
    const baseline = await capture(cwd);
    await mutate(cwd);
    await expectChanged(cwd, baseline);
  });

  it.each([
    {
      name: "assume-unchanged",
      args: ["--assume-unchanged", "--", "tracked.txt"],
    },
    {
      name: "skip-worktree",
      args: ["--skip-worktree", "--", "tracked.txt"],
    },
  ])(
    "detects the $name index-entry flag without file-byte changes",
    async ({ args }) => {
      const cwd = await fixture();
      const baseline = await capture(cwd);
      const beforeContent = await readFile(path.join(cwd, "tracked.txt"));
      const beforeHead = (await git(cwd, "rev-parse", "HEAD")).trim();

      await git(cwd, "update-index", ...args);

      expect(await readFile(path.join(cwd, "tracked.txt"))).toEqual(
        beforeContent,
      );
      expect((await git(cwd, "rev-parse", "HEAD")).trim()).toBe(beforeHead);
      await expectChanged(cwd, baseline);
    },
  );

  it("enforces the zero-or-one handoff lifecycle and exact declaration", async () => {
    const cwd = await fixture();
    const handoff = ".ephemeral/result.json";
    const baseline = await capture(cwd, handoff);

    await expect(
      runSourceImmutabilityCommand(
        ["verify", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: `declared handoff is missing: ${handoff}\n`,
    });
    await writeFile(path.join(cwd, handoff), "");
    await expect(
      runSourceImmutabilityCommand(
        ["verify", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: `declared handoff must be nonempty: ${handoff}\n`,
    });
    await rm(path.join(cwd, handoff));
    await symlink("../tracked.txt", path.join(cwd, handoff));
    await expect(
      runSourceImmutabilityCommand(
        ["verify", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: `declared handoff must be a nonsymlinked regular file: ${handoff}\n`,
    });
    await rm(path.join(cwd, handoff));
    await mkdir(path.join(cwd, handoff));
    await expect(
      runSourceImmutabilityCommand(
        ["verify", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: `declared handoff must be a nonsymlinked regular file: ${handoff}\n`,
    });
    await rm(path.join(cwd, handoff), { recursive: true });
    await writeFile(path.join(cwd, handoff), "{}\n");
    await expect(
      runSourceImmutabilityCommand(
        [
          "verify",
          "--baseline",
          baseline,
          "--handoff",
          ".ephemeral/other.json",
        ],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "handoff declaration does not match the retained baseline\n",
    });
    await expect(
      runSourceImmutabilityCommand(
        ["verify", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "unchanged\n", stderr: "" });
  });

  it("rejects invalid capture handoffs and workspace preconditions", async () => {
    const cwd = await fixture();
    await writeFile(path.join(cwd, ".ephemeral", "existing.json"), "x");
    await expect(
      runSourceImmutabilityCommand(
        ["capture", "--handoff", ".ephemeral/existing.json"],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("must be absent"),
    });
    await expect(
      runSourceImmutabilityCommand(
        ["capture", "--handoff", ".ephemeral/nested/result.json"],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "handoff must be a direct child of .ephemeral\n",
    });

    const missingEphemeral = await fixture({ ephemeral: false });
    await expect(
      runSourceImmutabilityCommand(["capture"], missingEphemeral),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: ".ephemeral must already exist as an ignored directory\n",
    });
    const noHead = await fixture({ commit: false });
    await expect(
      runSourceImmutabilityCommand(["capture"], noHead),
    ).resolves.toMatchObject({ exitCode: 1 });

    const symlinkedEphemeral = await fixture({ ephemeral: false });
    await mkdir(path.join(symlinkedEphemeral, "ignored"));
    await symlink("ignored", path.join(symlinkedEphemeral, ".ephemeral"));
    await expect(
      runSourceImmutabilityCommand(["capture"], symlinkedEphemeral),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: ".ephemeral must be a real nonsymlinked directory\n",
    });

    const nonignoredBaseline = await fixture();
    await writeFile(
      path.join(nonignoredBaseline, ".gitignore"),
      ".ephemeral/*\n!.ephemeral/.devcanon-source-immutability-*\n",
    );
    await git(nonignoredBaseline, "add", ".gitignore");
    await git(nonignoredBaseline, "commit", "-m", "test: baseline exception");
    await expect(
      runSourceImmutabilityCommand(["capture"], nonignoredBaseline),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining(
        "retained baseline must be ignored by Git",
      ),
    });
  });

  it("keeps verify write-free", async () => {
    const cwd = await fixture();
    const handoff = ".ephemeral/result.json";
    const baseline = await capture(cwd, handoff);
    await writeFile(path.join(cwd, handoff), "payload\n");
    const beforeNames = await readdir(path.join(cwd, ".ephemeral"));
    const beforeBaseline = await readFile(path.join(cwd, baseline));
    const beforeHandoff = await readFile(path.join(cwd, handoff));
    const indexPath = (
      await git(cwd, "rev-parse", "--git-path", "index")
    ).trim();
    const beforeIndex = await readFile(path.join(cwd, indexPath));
    const beforeIndexMtime = (await lstat(path.join(cwd, indexPath))).mtimeMs;

    await runSourceImmutabilityCommand(
      ["verify", "--baseline", baseline, "--handoff", handoff],
      cwd,
    );
    expect(await readdir(path.join(cwd, ".ephemeral"))).toEqual(beforeNames);
    expect(await readFile(path.join(cwd, baseline))).toEqual(beforeBaseline);
    expect(await readFile(path.join(cwd, handoff))).toEqual(beforeHandoff);
    expect(await readFile(path.join(cwd, indexPath))).toEqual(beforeIndex);
    expect((await lstat(path.join(cwd, indexPath))).mtimeMs).toBe(
      beforeIndexMtime,
    );
  });

  it("cleans exact missing, regular, and symlink leaves while preserving neighbors and source", async () => {
    const cwd = await fixture();
    const handoff = ".ephemeral/result.json";
    const baseline = await capture(cwd, handoff);
    await writeFile(path.join(cwd, handoff), "payload\n");
    await writeFile(path.join(cwd, ".ephemeral", "neighbor.txt"), "keep\n");
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });
    expect(
      await readFile(path.join(cwd, ".ephemeral", "neighbor.txt"), "utf8"),
    ).toBe("keep\n");
    expect(await readFile(path.join(cwd, "tracked.txt"), "utf8")).toBe(
      "baseline\n",
    );
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });

    const symlinkBaseline =
      ".ephemeral/.devcanon-source-immutability-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json";
    await symlink("../tracked.txt", path.join(cwd, symlinkBaseline));
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", symlinkBaseline],
        cwd,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });
    expect(await readFile(path.join(cwd, "tracked.txt"), "utf8")).toBe(
      "baseline\n",
    );

    const handoffSymlink = ".ephemeral/symlink-result.json";
    const secondBaseline = await capture(cwd, handoffSymlink);
    await symlink("../tracked.txt", path.join(cwd, handoffSymlink));
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", secondBaseline, "--handoff", handoffSymlink],
        cwd,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });
    expect(await readFile(path.join(cwd, "tracked.txt"), "utf8")).toBe(
      "baseline\n",
    );
  });

  it("validates every cleanup leaf before unlinking any", async () => {
    const cwd = await fixture();
    const handoff = ".ephemeral/result.json";
    const baseline = await capture(cwd, handoff);
    await mkdir(path.join(cwd, handoff));

    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", baseline, "--handoff", handoff],
        cwd,
      ),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: `handoff cleanup path has a disallowed file kind: ${handoff}\n`,
    });
    expect((await lstat(path.join(cwd, baseline))).isFile()).toBe(true);
  });

  it.each([
    {
      name: "truncated JSON",
      malformed: () => "{\n",
    },
    {
      name: "structurally incomplete fingerprint",
      malformed: (cwd: string, handoff: string) =>
        `${JSON.stringify({
          kind: "devcanon-source-immutability-private",
          handoff,
          fingerprint: { worktree: cwd },
        })}\n`,
    },
  ])(
    "rejects a regular baseline with $name before verify or cleanup removes either leaf",
    async ({ malformed }) => {
      const cwd = await fixture();
      const handoff = ".ephemeral/result.json";
      const baseline = await capture(cwd, handoff);
      const malformedContent = malformed(cwd, handoff);
      await writeFile(path.join(cwd, baseline), malformedContent);
      await writeFile(path.join(cwd, handoff), "payload\n");

      await expect(
        runSourceImmutabilityCommand(
          ["verify", "--baseline", baseline, "--handoff", handoff],
          cwd,
        ),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: `retained baseline is invalid: ${baseline}\n`,
      });
      await expect(
        runSourceImmutabilityCommand(
          ["cleanup", "--baseline", baseline, "--handoff", handoff],
          cwd,
        ),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: `retained baseline is invalid: ${baseline}\n`,
      });
      expect(await readFile(path.join(cwd, baseline), "utf8")).toBe(
        malformedContent,
      );
      expect(await readFile(path.join(cwd, handoff), "utf8")).toBe("payload\n");
    },
  );

  it("treats leaves as clean when their parent disappeared and does not require repaired Git metadata", async () => {
    const missingParent = await fixture();
    const missingBaseline = await capture(missingParent);
    await rm(path.join(missingParent, ".ephemeral"), { recursive: true });
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", missingBaseline],
        missingParent,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });

    const gitless = await fixture();
    const handoff = ".ephemeral/result.json";
    const gitlessBaseline = await capture(gitless, handoff);
    await writeFile(path.join(gitless, handoff), "payload\n");
    await rm(path.join(gitless, ".git"), { recursive: true });
    await expect(
      runSourceImmutabilityCommand(
        ["cleanup", "--baseline", gitlessBaseline, "--handoff", handoff],
        gitless,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "cleaned\n", stderr: "" });
  });

  it("rejects malformed command shapes with stdout/stderr/exit-code separation", async () => {
    const cwd = await fixture();
    for (const args of [
      [],
      ["capture", "--handoff"],
      ["capture", "--handoff", ".ephemeral/a", "--handoff", ".ephemeral/b"],
      ["verify"],
      ["cleanup", "--unknown", "value"],
    ]) {
      const result = await runSourceImmutabilityCommand(args, cwd);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/\n$/u);
    }
  });
});
