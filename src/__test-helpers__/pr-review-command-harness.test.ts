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

  it("skips Git removal for an unregistered worktree with a stale regular .git marker", async () => {
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
    await mkdir(workspace.worktree, { recursive: true });
    await writeFile(path.join(workspace.worktree, ".git"), "stale marker\n");

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
  it("reports bounded taskkill diagnostics after a simulated Windows direct-child fallback", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
      commandDeadlineMs: 1_000,
      terminationPlatform: "win32",
      windowsTaskkillCommand: () => ({
        command: process.execPath,
        args: [
          "-e",
          "process.stderr.write(`denied\\n${'x'.repeat(20_000)}`, () => process.exit(7))",
        ],
      }),
    });
    harness.beginTest();

    const failure = await boundedFailure(
      harness.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        deadlineMs: 100,
      }),
      2_000,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: expect.stringContaining("exceeded the 100ms child deadline"),
    });
    const messages = flattenedErrorMessages(failure);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exceeded the 100ms child deadline"),
        expect.stringContaining("taskkill exited 7: denied"),
      ]),
    );
    const taskkillDiagnostic =
      messages.find((message) => message.startsWith("taskkill exited 7")) ?? "";
    expect(Buffer.byteLength(taskkillDiagnostic, "utf8")).toBeLessThanOrEqual(
      16_450,
    );
    expect(harness.activeChildCount).toBe(0);
    await harness.endTest();
    expect(harness.activeOperationCount).toBe(0);
  });

  it("preserves output overflow when simulated Windows cleanup also fails", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
      commandDeadlineMs: 1_000,
      terminationPlatform: "win32",
      windowsTaskkillCommand: () => ({
        command: process.execPath,
        args: [
          "-e",
          'process.stderr.write("process not found", () => process.exit(128))',
        ],
      }),
    });
    harness.beginTest();

    const failure = await boundedFailure(
      harness.run(
        process.execPath,
        [
          "-e",
          "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)",
        ],
        { outputLimitBytes: 64 },
      ),
      2_000,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: expect.stringContaining("stdout exceeded 64 bytes"),
    });
    expect(flattenedErrorMessages(failure)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stdout exceeded 64 bytes"),
        "taskkill exited 128: process not found",
      ]),
    );
    expect(harness.activeChildCount).toBe(0);
    await harness.endTest();
    expect(harness.activeOperationCount).toBe(0);
  });

  it("reports a failed Windows fallback before a non-closing child is released", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
      commandDeadlineMs: 1_000,
      terminationPlatform: "win32",
      windowsTaskkillCommand: () => ({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
      }),
      directChildKill: () => undefined,
    });
    await harness.setup();
    harness.beginTest();
    const root = await harness.createScratchRoot();
    const release = path.join(root, "release-child");
    const childScript = [
      'const { existsSync } = require("node:fs");',
      `const release = ${JSON.stringify(release)};`,
      "const timer = setInterval(() => {",
      "  if (!existsSync(release)) return;",
      "  clearInterval(timer);",
      "  process.exit(0);",
      "}, 10);",
    ].join("\n");

    try {
      const failure = await boundedFailure(
        harness.run(process.execPath, ["-e", childScript], {
          deadlineMs: 100,
        }),
        1_000,
      );

      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure).toMatchObject({
        message: expect.stringContaining("exceeded the 100ms child deadline"),
      });
      expect(flattenedErrorMessages(failure)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("exceeded the 100ms child deadline"),
          "taskkill exited 7",
          "direct child did not close within 250ms after taskkill failure",
        ]),
      );
      expect(harness.activeChildCount).toBe(1);
    } finally {
      await writeFile(release, "release\n");
      await waitFor(() => harness.activeChildCount === 0);
      try {
        await harness.endTest();
      } finally {
        await harness.dispose();
      }
    }

    expect(harness.activeChildCount).toBe(0);
    expect(harness.activeOperationCount).toBe(0);
  });

  it("terminates a platform descendant before it can outlive the command root", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
    });
    await harness.setup();
    harness.beginTest();
    const root = await harness.createScratchRoot();
    const lateMarker = path.join(root, "descendant-survived");
    const descendantScript = [
      'const { writeFileSync } = require("node:fs");',
      `setTimeout(() => writeFileSync(${JSON.stringify(lateMarker)}, "late\\n"), 400);`,
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const rootScript = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: "ignore" });`,
      "setInterval(() => {}, 1000);",
    ].join("\n");

    try {
      await expect(
        harness.run(process.execPath, ["-e", rootScript], {
          deadlineMs: 150,
        }),
      ).rejects.toThrow("exceeded the 150ms child deadline");
      await delay(500);
      await expect(access(lateMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      try {
        await harness.endTest();
      } finally {
        await harness.dispose();
      }
    }
  });

  it("retains a late outer-operation rejection until drain", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
      commandDeadlineMs: 50,
    });
    harness.beginTest();
    let rejectOperation: (error: Error) => void = () => undefined;
    const operation = new Promise<void>((_resolve, reject) => {
      rejectOperation = reject;
    });

    await expect(
      harness.trackOuter(operation, "controlled outer operation"),
    ).rejects.toThrow("exceeded the 50ms harness deadline");

    let teardownState = "pending";
    const teardown = harness.endTest().then(
      () => {
        teardownState = "resolved";
      },
      (error: unknown) => {
        teardownState = "rejected";
        throw error;
      },
    );
    await delay(20);
    expect(teardownState).toBe("pending");

    rejectOperation(new Error("late outer root cause"));
    await expect(teardown).rejects.toThrow("late outer root cause");
    expect(teardownState).toBe("rejected");
    expect(harness.activeOperationCount).toBe(0);
  });

  it("does not report an outer rejection already delivered before its deadline", async () => {
    const harness = new PrReviewCommandHarness({
      envKeys: [],
      seed: "review",
      commandDeadlineMs: 100,
    });
    harness.beginTest();

    await expect(
      harness.trackOuter(
        Promise.reject(new Error("early outer root cause")),
        "early outer operation",
      ),
    ).rejects.toThrow("early outer root cause");
    await expect(harness.endTest()).resolves.toBeUndefined();
    expect(harness.activeOperationCount).toBe(0);
  });

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

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function boundedFailure(
  operation: Promise<unknown>,
  deadlineMs: number,
): Promise<unknown> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation.then(
        () => new Error("operation unexpectedly resolved"),
        (error) => error,
      ),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`operation exceeded ${deadlineMs}ms`)),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitFor(
  condition: () => boolean,
  deadlineMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start >= deadlineMs) {
      throw new Error(`condition not met within ${deadlineMs}ms`);
    }
    await delay(10);
  }
}

function flattenedErrorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap(flattenedErrorMessages);
  }
  return [error instanceof Error ? error.message : String(error)];
}
