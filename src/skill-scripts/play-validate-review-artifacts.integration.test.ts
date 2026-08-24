import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
);
const wrapperTimeoutMs = 10_000;
const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map(cleanupTempDir));
});

async function createInstalledWrapper() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-review-artifacts-wrapper-"),
  );
  createdRoots.push(root);
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  const runtime = path.join(
    root,
    "devcanon-runtime/scripts/devcanon-runtime.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await mkdir(path.dirname(runtime), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return { root, script, runtime };
}

async function writeRuntime(runtime: string, body: readonly string[]) {
  await writeFile(
    runtime,
    ["#!/usr/bin/env bash", "set -euo pipefail", ...body, ""].join("\n"),
  );
  await chmod(runtime, 0o755);
}

async function runWrapper(
  root: string,
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [script, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
    timeout: wrapperTimeoutMs,
    killSignal: "SIGTERM",
  });
}

describe("play-validate-review-artifacts helper", () => {
  it("resolves the installed sibling runtime and forwards the public command", async () => {
    const { root, script, runtime } = await createInstalledWrapper();
    await writeRuntime(runtime, [
      'if [ "$1" = "resolve-entrypoint" ]; then printf "%s\\n" "$0"; exit 0; fi',
      '[ "$1" = "runtime" ]',
      '[ "$2" = "review-artifacts" ]',
      '[ "$3" = "validate-risk-signals" ]',
      'printf "validated\\n"',
    ]);

    await expect(
      runWrapper(root, script, ["validate-risk-signals"]),
    ).resolves.toMatchObject({
      stdout: "validated\n",
    });
  });

  it("fails before dispatch when the runtime sibling is unavailable", async () => {
    const { root, script } = await createInstalledWrapper();

    await expect(
      runWrapper(root, script, ["validate-risk-signals"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "devcanon-runtime passive runtime bundle missing for play-validate-review-artifacts",
      ),
    });
  });

  it("uses an explicit runtime directory override", async () => {
    const { root, script } = await createInstalledWrapper();
    const overrideRoot = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-runtime-override-"),
    );
    createdRoots.push(overrideRoot);
    const runtime = path.join(overrideRoot, "scripts/devcanon-runtime.sh");
    await mkdir(path.dirname(runtime), { recursive: true });
    await writeRuntime(runtime, [
      'if [ "$1" = "resolve-entrypoint" ]; then printf "%s\\n" "$0"; exit 0; fi',
      '[ "$1" = "runtime" ]',
      '[ "$2" = "review-artifacts" ]',
      '[ "$3" = "validate-scope-decision" ]',
      'printf "validated\\n"',
    ]);

    await expect(
      runWrapper(root, script, ["validate-scope-decision"], {
        DEVCANON_RUNTIME_DIR: overrideRoot,
      }),
    ).resolves.toMatchObject({ stdout: "validated\n" });
  });
});
