import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PrReviewCommandHarness } from "./pr-review-command-harness.js";

const testEnvKey = "DEVCANON_PR_REVIEW_HARNESS_TEST";

describe("PR-review command harness seeded workspaces", () => {
  const harness = new PrReviewCommandHarness({
    envKeys: [testEnvKey],
    seed: "review",
  });

  beforeAll(async () => {
    await harness.setup();
  });

  beforeEach(() => {
    harness.beginTest();
  });

  afterEach(async () => {
    await harness.endTest();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it("copies immutable history into independent short registered worktrees", async () => {
    const first = await harness.createRegisteredReviewWorkspace();
    const second = await harness.createRegisteredReviewWorkspace();

    expect(relativePath(harness.suiteRoot, first.primary)).toBe("c/0000/p");
    expect(relativePath(harness.suiteRoot, first.worktree)).toBe("c/0000/w");
    expect(relativePath(harness.suiteRoot, second.primary)).toBe("c/0001/p");
    await writeFile(path.join(first.primary, "README.md"), "changed\n");

    expect(await readFile(path.join(second.primary, "README.md"), "utf8")).toBe(
      "baseline\n",
    );
    expect(await harness.readSeedFile("README.md")).toBe("baseline\n");
    await expect(
      harness.run("git", [
        "-C",
        first.primary,
        "worktree",
        "list",
        "--porcelain",
      ]),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it("removes a healthy registered worktree before its case root", async () => {
    const workspace = await harness.createRegisteredReviewWorkspace();

    await harness.endTest();

    await expect(access(workspace.tempRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    harness.beginTest();
  });

  it("prunes a registered worktree whose directory is missing", async () => {
    const workspace = await harness.createRegisteredReviewWorkspace();
    await rm(workspace.worktree, { recursive: true, force: true });

    await harness.endTest();

    await expect(access(workspace.tempRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    harness.beginTest();
  });

  it("prunes a registered worktree whose .git marker is missing", async () => {
    const workspace = await harness.createRegisteredReviewWorkspace();
    await rm(path.join(workspace.worktree, ".git"));

    await harness.endTest();

    await expect(access(workspace.tempRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    harness.beginTest();
  });

  it("skips Git removal for an already-unregistered worktree", async () => {
    const workspace = await harness.createRegisteredReviewWorkspace();
    await harness.run(
      "git",
      [
        "-C",
        workspace.primary,
        "worktree",
        "remove",
        "--force",
        workspace.worktree,
      ],
      { cwd: workspace.tempRoot },
    );
    await mkdir(path.join(workspace.worktree, ".ephemeral"), {
      recursive: true,
    });

    await harness.endTest();

    await expect(access(workspace.tempRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    harness.beginTest();
  });

  it("surfaces Git cleanup failures after removing the case root", async () => {
    const workspace = await harness.createRegisteredReviewWorkspace();
    await rm(path.join(workspace.primary, ".git"), {
      recursive: true,
      force: true,
    });

    await expect(harness.endTest()).rejects.toThrow("not a git repository");
    await expect(access(workspace.tempRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    harness.beginTest();
  });

  it("tracks outer work and restores exact cwd and environment state", async () => {
    const originalCwd = process.cwd();
    const originalValue = process.env[testEnvKey];
    const workspace = await harness.createPlainReviewWorkspace();
    process.chdir(workspace.worktree);
    process.env[testEnvKey] = "mutated";

    await expect(
      harness.trackOuter(Promise.resolve("complete"), "outer operation"),
    ).resolves.toBe("complete");

    await harness.endTest();
    expect(process.cwd()).toBe(originalCwd);
    expect(process.env[testEnvKey]).toBe(originalValue);
    harness.beginTest();
  });

  it("fails fast when a generated suffix exceeds the path budget", () => {
    expect(() =>
      harness.assertOwnedPath(
        path.join(harness.suiteRoot, "c", "0000", "p", "x".repeat(121)),
      ),
    ).toThrow("suffix exceeds 120 code units");
  });
});

function relativePath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

describe("PR-review command harness source seeds", () => {
  const harness = new PrReviewCommandHarness({
    envKeys: [],
    seed: "source",
  });

  beforeAll(async () => {
    await harness.setup();
  });

  beforeEach(() => {
    harness.beginTest();
  });

  afterEach(async () => {
    await harness.endTest();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it("provides committed, unborn, and no-ephemeral independent copies", async () => {
    const committed = await harness.createSourceWorkspace();
    const unborn = await harness.createSourceWorkspace({ commit: false });
    const noEphemeral = await harness.createSourceWorkspace({
      ephemeral: false,
    });

    await expect(
      harness.run("git", ["-C", committed, "rev-parse", "--verify", "HEAD"]),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      harness.run("git", ["-C", unborn, "rev-parse", "--verify", "HEAD"], {
        acceptedExitCodes: [128],
      }),
    ).resolves.toMatchObject({ exitCode: 128 });
    await expect(
      access(path.join(noEphemeral, ".ephemeral")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("PR-review command harness process ownership", () => {
  it("terminates an over-deadline child and drains it through close", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
    });
    harness.beginTest();

    await expect(
      harness.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        deadlineMs: 100,
      }),
    ).rejects.toThrow("exceeded the 100ms child deadline");
    await harness.endTest();

    expect(harness.activeChildCount).toBe(0);
    expect(harness.activeOperationCount).toBe(0);
  });

  it("terminates a child whose output exceeds the bounded buffer", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
    });
    harness.beginTest();

    await expect(
      harness.run(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(4096))"],
        { outputLimitBytes: 64 },
      ),
    ).rejects.toThrow("stdout exceeded 64 bytes");
    await harness.endTest();

    expect(harness.activeChildCount).toBe(0);
    expect(harness.activeOperationCount).toBe(0);
  });
});
