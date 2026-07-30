import { ChildProcess } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PR_REVIEW_PROCESS_LIFECYCLE_LIMITS,
  type PrReviewProcessGeneratedRoot,
  createPrReviewProcessGeneratedRoot,
  launchPrReviewProcessLifecycle,
} from "./pr-review-process-lifecycle.js";

const roots: string[] = [];

async function generatedRoot(): Promise<PrReviewProcessGeneratedRoot> {
  const root = await createPrReviewProcessGeneratedRoot();
  roots.push(root.path);
  return root;
}

async function lifecycle(
  root: PrReviewProcessGeneratedRoot,
  source: string,
  options: Partial<Parameters<typeof launchPrReviewProcessLifecycle>[0]> = {},
) {
  return launchPrReviewProcessLifecycle({
    executable: process.execPath,
    args: ["-e", source],
    cwd: root.path,
    generatedRoot: root,
    deadlineMs: 250,
    outputLimitBytes: 128,
    environment: {},
    ...options,
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("pr-review process lifecycle", () => {
  it("observes a normal root-process exit", async () => {
    const root = await generatedRoot();
    const processLifecycle = await lifecycle(
      root,
      'process.stdout.write("normal");',
    );

    const result = await processLifecycle.finish();

    expect(result.rootProcess).toMatchObject({
      exitObserved: true,
      closeObserved: true,
    });
    expect(result.output.stdout.text).toBe("normal");
    expect(result.generatedRoot).toBe("removed");
  });

  it("records cooperative cancellation acknowledgement", async () => {
    const root = await generatedRoot();
    const source = [
      'const fs = require("node:fs");',
      "const read = fs.createReadStream(null, { fd: 3 });",
      'read.once("data", () => {',
      '  const body = Buffer.from(JSON.stringify({ type: "descendants_stopped", version: 1 }));',
      "  const frame = Buffer.alloc(body.length + 4); frame.writeUInt32BE(body.length); body.copy(frame, 4);",
      "  fs.writeSync(3, frame); process.exit(0);",
      "});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const processLifecycle = await lifecycle(root, source);

    const result = await processLifecycle.finish({
      cancel: true,
      cooperativeGraceMs: 100,
    });

    expect(result.cooperative.descendantsAcknowledged).toBe(true);
    expect(result.cleanup.forceTermination).toBe("not-needed");
  });

  it("attempts root termination after the shared deadline phase", async () => {
    const root = await generatedRoot();
    const processLifecycle = await lifecycle(
      root,
      "setInterval(() => {}, 1000);",
      { deadlineMs: 100 },
    );

    const result = await processLifecycle.finish({
      cancel: true,
      cooperativeGraceMs: 1,
    });

    expect(result.cleanup.forceTermination).toBe("attempted");
    expect(result.rootProcess.closeObserved).toBe(true);
  });

  it("reports an incomplete root observation without claiming descendant absence", async () => {
    const root = await generatedRoot();
    const source =
      'process.on("SIGTERM", () => {}); setTimeout(() => process.exit(0), 300);';
    const processLifecycle = await lifecycle(root, source, { deadlineMs: 40 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = await processLifecycle.finish({
      cancel: true,
      cooperativeGraceMs: 1,
    });

    expect(result.rootProcess.closeObserved).toBe(false);
    expect(result.cooperative.descendantsAcknowledged).toBe("unknown");
    expect(result).not.toHaveProperty("descendantsAbsent");
  });

  it("caps and redacts incremental output overflow evidence", async () => {
    const exactRoot = await generatedRoot();
    const exactLifecycle = await lifecycle(
      exactRoot,
      'process.stdout.write("x".repeat(32));',
      { outputLimitBytes: 32 },
    );
    const exact = await exactLifecycle.finish();
    const root = await generatedRoot();
    const processLifecycle = await lifecycle(
      root,
      'process.stdout.write("TOP_SECRET" + "x".repeat(300));',
      { outputLimitBytes: 32, redact: ["TOP_SECRET"] },
    );

    const result = await processLifecycle.finish();

    expect(result.output.stdout).toMatchObject({
      overflowed: true,
      bytes: 310,
    });
    expect(exact.output.stdout).toMatchObject({
      overflowed: false,
      bytes: 32,
    });
    expect(result.output.stdout.text).not.toContain("TOP_SECRET");
    expect(result.output.stdout.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("redacts across chunks before the retained-byte boundary", async () => {
    const root = await generatedRoot();
    const processLifecycle = await lifecycle(
      root,
      'process.stdout.write("TOP_"); setTimeout(() => process.stdout.write("SECRET"), 1);',
      { outputLimitBytes: 4, redact: ["TOP_SECRET"] },
    );

    const result = await processLifecycle.finish();

    expect(result.output.stdout.text).not.toContain("TOP_SECRET");
    expect(result.output.stdout.text).not.toContain("TOP_");
    expect(
      Buffer.byteLength(result.output.stdout.text, "utf8"),
    ).toBeLessThanOrEqual(4);
    const completeRoot = await generatedRoot();
    const completeLifecycle = await lifecycle(
      completeRoot,
      'process.stdout.write("TOKEN"); setTimeout(() => process.stdout.write("-LONG"), 1);',
      { redact: ["TOKEN", "TOKEN-LONG"] },
    );
    const incompleteRoot = await generatedRoot();
    const incompleteLifecycle = await lifecycle(
      incompleteRoot,
      'process.stdout.write("TOKEN-");',
      { redact: ["TOKEN-LONG"] },
    );

    const complete = await completeLifecycle.finish();
    const incomplete = await incompleteLifecycle.finish();

    expect(complete.output.stdout.text).toBe("[REDACTED]");
    expect(incomplete.output.stdout.text).toBe("[REDACTED]");
  });

  it("uses a synchronous request snapshot after launch begins", async () => {
    const root = await generatedRoot();
    const args = ["-e", 'process.stdout.write("original");'];
    const redact = ["original"];
    const launched = launchPrReviewProcessLifecycle({
      executable: process.execPath,
      args,
      cwd: root.path,
      generatedRoot: root,
      deadlineMs: 250,
      outputLimitBytes: 128,
      environment: { SNAPSHOT_VALUE: "original" },
      redact,
    });
    args[1] = 'process.stdout.write("mutated");';

    const result = await (await launched).finish();

    expect(result.output.stdout.text).toBe("[REDACTED]");
  });

  it("rejects a forged generated-root object even when its path is helper-created", async () => {
    const root = await generatedRoot();

    await expect(
      launchPrReviewProcessLifecycle({
        executable: process.execPath,
        args: ["-e", "process.exit(0);"],
        cwd: root.path,
        generatedRoot: { path: root.path },
        deadlineMs: 250,
        outputLimitBytes: 128,
        environment: {},
      }),
    ).rejects.toThrow("helper-created enrollment");
    await expect(access(root.path)).resolves.toBeUndefined();
  });

  it("records a real spawn failure without claiming the root process spawned", async () => {
    const root = await generatedRoot();
    const executableDirectory = await mkdtemp(
      path.join(os.tmpdir(), "dc-process-lifecycle-executable-"),
    );
    roots.push(executableDirectory);
    const executable = path.join(executableDirectory, "missing-interpreter");
    await writeFile(executable, "#!/not/a/real/interpreter\n");
    await chmod(executable, 0o700);
    const processLifecycle = await launchPrReviewProcessLifecycle({
      executable,
      args: [],
      cwd: root.path,
      generatedRoot: root,
      deadlineMs: 250,
      outputLimitBytes: 128,
      environment: {},
    });

    const result = await processLifecycle.finish();

    expect(result.rootProcess.spawned).toBe(false);
    expect(result.rootProcess.exitObserved).toBe(false);
    expect(result.evidence.some((entry) => entry.startsWith("spawn:"))).toBe(
      true,
    );
    expect(result.generatedRoot).toBe("preserved_unsafe");
  });

  it("records protocol failure and a false root kill without overstating cleanup", async () => {
    const root = await generatedRoot();
    const source = [
      'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], { stdio: ["ignore", "inherit", "inherit"] });',
      'process.stdout.write("ready");',
      'require("node:fs").writeSync(3, Buffer.from([0, 0, 0, 1, 0xff]));',
      "process.exit(0);",
    ].join("\n");
    const processLifecycle = await lifecycle(root, source, { deadlineMs: 200 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const result = await processLifecycle.finish({
      cancel: true,
      cooperativeGraceMs: 1,
    });

    expect(result.rootProcess.exitObserved).toBe(true);
    expect(result.cleanup.forceTermination).toBe("failed");
    expect(result.evidence).toContain("kill:false");
    expect(result.evidence.some((entry) => entry.startsWith("protocol:"))).toBe(
      true,
    );
    const failureRoot = await generatedRoot();
    const secret = "PRIVATE_FAILURE";
    const errorName = `${secret}${"é".repeat(100)}`;
    const kill = vi
      .spyOn(ChildProcess.prototype, "kill")
      .mockImplementation(() => {
        const error = new Error("bounded failure");
        error.name = errorName;
        throw error;
      });
    try {
      const processLifecycle = await lifecycle(
        failureRoot,
        "setTimeout(() => process.exit(0), 150);",
        { deadlineMs: 100, redact: [secret] },
      );

      const result = await processLifecycle.finish({
        cancel: true,
        cooperativeGraceMs: 0,
      });
      const failure = result.evidence.find((entry) =>
        entry.startsWith("kill:"),
      );

      expect(failure).toBeDefined();
      expect(failure).not.toContain(secret);
      expect(Buffer.byteLength(failure ?? "", "utf8")).toBeLessThanOrEqual(
        PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxFailureEvidenceBytes,
      );
      expect(Buffer.from(failure ?? "", "utf8").toString("utf8")).toBe(failure);
    } finally {
      kill.mockRestore();
    }
  });

  it("restores controller cwd before generated-root disposition", async () => {
    const root = await generatedRoot();
    const beforeCwd = process.cwd();
    const processLifecycle = await lifecycle(root, "process.exit(0);");
    process.chdir(root.path);

    const result = await processLifecycle.finish();

    expect(process.cwd()).toBe(beforeCwd);
    expect(result.restoration).toBe("restored");
    expect(result.generatedRoot).toBe("removed");
    const failedRoot = await generatedRoot();
    const originalCwd = process.cwd();
    const removedControllerCwd = await mkdtemp(
      path.join(os.tmpdir(), "dc-process-lifecycle-controller-"),
    );
    process.chdir(removedControllerCwd);
    try {
      const failedLifecycle = await lifecycle(failedRoot, "process.exit(0);");
      await rm(removedControllerCwd, { recursive: true });

      const failed = await failedLifecycle.finish();

      expect(failed.restoration).toBe("failed");
      expect(failed.generatedRoot).toBe("preserved_unsafe");
      await expect(access(failedRoot.path)).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("enforces every finite request boundary with exact and plus-one cases", async () => {
    const source = "process.exit(0);";
    const boundaryCases = [
      {
        name: "deadline",
        exact: 60_000,
        plusOne: 60_001,
        assign: (request: Record<string, unknown>, value: number) => {
          request.deadlineMs = value;
        },
      },
      {
        name: "output",
        exact: 65_536,
        plusOne: 65_537,
        assign: (request: Record<string, unknown>, value: number) => {
          request.outputLimitBytes = value;
        },
      },
      {
        name: "arguments",
        exact: 128,
        plusOne: 129,
        assign: (request: Record<string, unknown>, value: number) => {
          request.args = Array.from({ length: value }, () => "x");
        },
      },
      {
        name: "argument bytes",
        exact: 8_192,
        plusOne: 8_193,
        assign: (request: Record<string, unknown>, value: number) => {
          request.args = ["-e", "process.exit(0);", "x".repeat(value)];
        },
      },
      {
        name: "environment entries",
        exact: 64,
        plusOne: 65,
        assign: (request: Record<string, unknown>, value: number) => {
          request.environment = Object.fromEntries(
            Array.from({ length: value }, (_, index) => [`K${index}`, "v"]),
          );
        },
      },
      {
        name: "environment key bytes",
        exact: 256,
        plusOne: 257,
        assign: (request: Record<string, unknown>, value: number) => {
          request.environment = { ["K".repeat(value)]: "v" };
        },
      },
      {
        name: "environment value bytes",
        exact: 8_192,
        plusOne: 8_193,
        assign: (request: Record<string, unknown>, value: number) => {
          request.environment = { K: "v".repeat(value) };
        },
      },
      {
        name: "redactions",
        exact: 16,
        plusOne: 17,
        assign: (request: Record<string, unknown>, value: number) => {
          request.redact = Array.from(
            { length: value },
            (_, index) => `secret-${index}`,
          );
        },
      },
      {
        name: "redaction bytes",
        exact: 4_096,
        plusOne: 4_097,
        assign: (request: Record<string, unknown>, value: number) => {
          request.redact = ["s".repeat(value)];
        },
      },
    ] as const;
    for (const boundaryCase of boundaryCases) {
      const exactRoot = await generatedRoot();
      const exact: Record<string, unknown> = {
        executable: process.execPath,
        args: ["-e", source],
        cwd: exactRoot.path,
        generatedRoot: exactRoot,
        deadlineMs: 250,
        outputLimitBytes: 128,
        environment: {},
      };
      boundaryCase.assign(exact, boundaryCase.exact);
      await expect(
        launchPrReviewProcessLifecycle(
          exact as unknown as Parameters<
            typeof launchPrReviewProcessLifecycle
          >[0],
        ),
        `accepts exact ${boundaryCase.name}`,
      ).resolves.toBeDefined();

      const plusOneRoot = await generatedRoot();
      const plusOne: Record<string, unknown> = {
        ...exact,
        cwd: plusOneRoot.path,
        generatedRoot: plusOneRoot,
      };
      boundaryCase.assign(plusOne, boundaryCase.plusOne);
      await expect(
        launchPrReviewProcessLifecycle(
          plusOne as unknown as Parameters<
            typeof launchPrReviewProcessLifecycle
          >[0],
        ),
        `rejects ${boundaryCase.name} plus one`,
      ).rejects.toThrow();
    }
    for (const [name, key] of [
      ["deadline", "deadlineMs"],
      ["output", "outputLimitBytes"],
    ] as const) {
      const exactRoot = await generatedRoot();
      const now =
        key === "deadlineMs"
          ? vi.spyOn(performance, "now").mockReturnValue(0)
          : undefined;
      let exactLifecycle:
        | Awaited<ReturnType<typeof launchPrReviewProcessLifecycle>>
        | undefined;
      try {
        exactLifecycle = await launchPrReviewProcessLifecycle({
          executable: process.execPath,
          args: ["-e", "process.exit(0);"],
          cwd: exactRoot.path,
          generatedRoot: exactRoot,
          deadlineMs: key === "deadlineMs" ? 1 : 250,
          outputLimitBytes: key === "outputLimitBytes" ? 1 : 128,
          environment: {},
        });
      } finally {
        now?.mockRestore();
      }
      expect(exactLifecycle, `accepts minimum ${name}`).toBeDefined();
      const belowRoot = await generatedRoot();
      await expect(
        launchPrReviewProcessLifecycle({
          executable: process.execPath,
          args: ["-e", "process.exit(0);"],
          cwd: belowRoot.path,
          generatedRoot: belowRoot,
          deadlineMs: key === "deadlineMs" ? 0 : 250,
          outputLimitBytes: key === "outputLimitBytes" ? 0 : 128,
          environment: {},
        }),
        `rejects below-minimum ${name}`,
      ).rejects.toThrow();
    }

    const zeroRoot = await generatedRoot();
    const zero = await lifecycle(zeroRoot, "process.exit(0);");
    await expect(
      zero.finish({ cancel: true, cooperativeGraceMs: 0 }),
    ).resolves.toBeDefined();
    const upperRoot = await generatedRoot();
    const upper = await lifecycle(upperRoot, "process.exit(0);");
    await expect(
      upper.finish({
        cancel: true,
        cooperativeGraceMs: PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxDeadlineMs,
      }),
    ).resolves.toBeDefined();
    const plusOneRoot = await generatedRoot();
    const plusOne = await lifecycle(plusOneRoot, "process.exit(0);");
    expect(() =>
      plusOne.finish({
        cooperativeGraceMs:
          PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxDeadlineMs + 1,
      }),
    ).toThrow("cooperative grace");
    const retainedExactRoot = await generatedRoot();
    const retainedExactLifecycle = await lifecycle(
      retainedExactRoot,
      'process.stdout.write("x".repeat(32));',
      { outputLimitBytes: 32 },
    );
    const retainedPlusOneRoot = await generatedRoot();
    const retainedPlusOneLifecycle = await lifecycle(
      retainedPlusOneRoot,
      'process.stdout.write("x".repeat(33));',
      { outputLimitBytes: 32 },
    );

    const retainedExact = await retainedExactLifecycle.finish();
    const retainedPlusOne = await retainedPlusOneLifecycle.finish();

    expect(retainedExact.output.stdout).toMatchObject({
      bytes: 32,
      overflowed: false,
      text: "x".repeat(32),
    });
    expect(retainedPlusOne.output.stdout).toMatchObject({
      bytes: 33,
      overflowed: true,
      text: "x".repeat(32),
    });
    const receiptRoot = await generatedRoot();
    const receiptSource = [
      'const fs = require("node:fs");',
      "for (let index = 0; index < 32; index += 1) {",
      "  setTimeout(() => fs.writeSync(3, Buffer.from([0, 0, 0, 1, 255])), index * 3);",
      "}",
      `process.stdout.write(Buffer.alloc(${PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxOutputLimitBytes + 1}));`,
      `process.stderr.write(Buffer.alloc(${PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxOutputLimitBytes + 1}));`,
      "setTimeout(() => process.exit(0), 120);",
    ].join("\n");
    const receiptLifecycle = await lifecycle(receiptRoot, receiptSource, {
      deadlineMs: 1_000,
      outputLimitBytes: PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxOutputLimitBytes,
    });

    const receipt = await receiptLifecycle.finish();

    expect(receipt.evidence).toHaveLength(
      PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxFailureEvidence,
    );
    expect(receipt.output.stdout.overflowed).toBe(true);
    expect(receipt.output.stderr.overflowed).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(receipt), "utf8"),
    ).toBeLessThanOrEqual(
      PR_REVIEW_PROCESS_LIFECYCLE_LIMITS.maxFinalReceiptBytes,
    );
  });

  it("restores harness-owned global state", async () => {
    const root = await generatedRoot();
    const beforeCwd = process.cwd();
    const beforeEnvironment = process.env.PR_REVIEW_PROCESS_LIFECYCLE_TEST;
    const processLifecycle = await lifecycle(root, "process.exit(0);");

    const result = await processLifecycle.finish();

    expect(result.restoration).toBe("restored");
    expect(process.cwd()).toBe(beforeCwd);
    expect(process.env.PR_REVIEW_PROCESS_LIFECYCLE_TEST).toBe(
      beforeEnvironment,
    );
  });

  it("removes a safe helper-created generated root after root close", async () => {
    const root = await generatedRoot();
    const processLifecycle = await lifecycle(root, "process.exit(0);");

    const result = await processLifecycle.finish();

    expect(result.generatedRoot).toBe("removed");
    await expect(access(root.path)).rejects.toThrow();
  });

  it("preserves a changed, aliased, or unsafe generated root", async () => {
    const root = await generatedRoot();
    const moved = `${root.path}-moved`;
    roots.push(moved);
    const source = [
      'const fs = require("node:fs");',
      "fs.renameSync(process.argv[1], process.argv[2]);",
      'fs.symlinkSync(process.argv[2], process.argv[1], "dir");',
    ].join("\n");
    const processLifecycle = await launchPrReviewProcessLifecycle({
      executable: process.execPath,
      args: ["-e", source, root.path, moved],
      cwd: root.path,
      generatedRoot: root,
      deadlineMs: 250,
      outputLimitBytes: 128,
      environment: {},
    });

    const result = await processLifecycle.finish();

    expect(result.generatedRoot).toBe("preserved_unsafe");
    await expect(access(moved)).resolves.toBeUndefined();
  });
});
