import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GENERATED_ROOT_MARKER,
  launchPrReviewProcessLifecycle,
} from "./pr-review-process-lifecycle.js";

const roots: string[] = [];

async function generatedRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dc-process-lifecycle-"));
  roots.push(root);
  await writeFile(path.join(root, GENERATED_ROOT_MARKER), "v1\n");
  return root;
}

async function lifecycle(
  root: string,
  source: string,
  options: Partial<Parameters<typeof launchPrReviewProcessLifecycle>[0]> = {},
) {
  return launchPrReviewProcessLifecycle({
    executable: process.execPath,
    args: ["-e", source],
    cwd: root,
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
    await expect(access(root)).rejects.toThrow();
  });

  it("preserves a changed, aliased, or unsafe generated root", async () => {
    const root = await generatedRoot();
    const moved = `${root}-moved`;
    roots.push(moved);
    const source = [
      'const fs = require("node:fs");',
      "fs.renameSync(process.argv[1], process.argv[2]);",
      'fs.symlinkSync(process.argv[2], process.argv[1], "dir");',
    ].join("\n");
    const processLifecycle = await launchPrReviewProcessLifecycle({
      executable: process.execPath,
      args: ["-e", source, root, moved],
      cwd: root,
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
