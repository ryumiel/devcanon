import { spawn as spawnChild } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import {
  dispatchRuntimeOverride,
  validateRuntimeOverride,
} from "./bootstrap.js";

async function writeRuntime(root: string, name = "runtime"): Promise<string> {
  const runtime = path.join(root, name);
  const typedRuntime = path.join(runtime, "scripts", "runtime");
  await mkdir(typedRuntime, { recursive: true });
  const entrypoint = path.join(typedRuntime, "devcanon-runtime.mjs");
  await writeFile(
    entrypoint,
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.DEVCANON_TEST_ARGUMENTS, process.argv.slice(2).join("\\0") + "\\0");',
      "writeFileSync(process.env.DEVCANON_TEST_OVERRIDE, process.env.DEVCANON_RUNTIME_DIR);",
      "process.exit(23);",
      "",
    ].join("\n"),
  );
  return runtime;
}

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForContents(
  filePath: string,
  contents: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await readFile(filePath, "utf8")) === contents) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${contents} in ${filePath}`);
}

async function waitForChildExit(child: ReturnType<typeof spawnChild>): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => {
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function expectProcessGroupGone(processGroupId: number): void {
  try {
    process.kill(-processGroupId, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  throw new Error(`process group ${processGroupId} still exists`);
}

function terminateProcessGroupIfPresent(processGroupId: number): void {
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function writeSigquitRuntime(root: string): Promise<{
  runtime: string;
  ready: string;
  forwarded: string;
  descendantForwarded: string;
  descendantReady: string;
  childPid: string;
}> {
  const runtime = await writeRuntime(root);
  const ready = path.join(root, "ready");
  const forwarded = path.join(root, "forwarded");
  const descendantForwarded = path.join(root, "descendant-forwarded");
  const descendantReady = path.join(root, "descendant-ready");
  const childPid = path.join(root, "child-pid");
  const entrypoint = path.join(
    runtime,
    "scripts",
    "runtime",
    "devcanon-runtime.mjs",
  );
  const runtimeProgram = entrypoint;
  const descendantProgram = [
    'const { writeFileSync } = require("node:fs");',
    "let count = 0;",
    'process.on("SIGQUIT", () => {',
    "  count += 1;",
    "  writeFileSync(process.env.DEVCANON_TEST_DESCENDANT_FORWARDED, String(count));",
    "  process.exit(0);",
    "});",
    'writeFileSync(process.env.DEVCANON_TEST_DESCENDANT_READY, "ready");',
    "setInterval(() => {}, 1_000);",
    "",
  ].join("\n");
  await writeFile(
    runtimeProgram,
    [
      'import { spawn } from "node:child_process";',
      'import { existsSync, writeFileSync } from "node:fs";',
      `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantProgram)}], {`,
      "  env: process.env,",
      '  stdio: "ignore",',
      "});",
      "let count = 0;",
      "let descendantClosed = descendant.exitCode !== null;",
      "let receivedSigquit = false;",
      "let exiting = false;",
      "function exitWhenSigquitIsComplete() {",
      "  if (!receivedSigquit || !descendantClosed || exiting) return;",
      "  exiting = true;",
      "  process.exit(0);",
      "}",
      'descendant.once("close", () => {',
      "  descendantClosed = true;",
      "  exitWhenSigquitIsComplete();",
      "});",
      'process.on("SIGQUIT", () => {',
      "  count += 1;",
      "  receivedSigquit = true;",
      "  writeFileSync(process.env.DEVCANON_TEST_FORWARDED, String(count));",
      "  exitWhenSigquitIsComplete();",
      "});",
      "function announceReady() {",
      "  if (!existsSync(process.env.DEVCANON_TEST_DESCENDANT_READY)) {",
      "    setTimeout(announceReady, 5);",
      "    return;",
      "  }",
      '  writeFileSync(process.env.DEVCANON_TEST_READY, "ready");',
      "  writeFileSync(process.env.DEVCANON_TEST_CHILD_PID, String(process.pid));",
      "}",
      "announceReady();",
      "",
    ].join("\n"),
  );
  return {
    runtime,
    ready,
    forwarded,
    descendantForwarded,
    descendantReady,
    childPid,
  };
}

async function writeExecutionSentinels(
  runtime: string,
  root: string,
): Promise<{ bundle: string }> {
  const bundle = path.join(root, "bundle-executed");
  const entrypoint = path.join(
    runtime,
    "scripts",
    "runtime",
    "devcanon-runtime.mjs",
  );
  await writeFile(
    entrypoint,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(bundle)}, "bundle");\n`,
  );
  return { bundle };
}

async function expectNoExecution(sentinels: { bundle: string }): Promise<void> {
  await expect(readFile(sentinels.bundle, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
}

describe("trusted runtime bootstrap", () => {
  it("validates a real runtime and dispatches exact child arguments with the raw override", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const rawOverride = `${runtime}/.`;
      const validated = await validateRuntimeOverride(rawOverride);
      expect(validated.rawPath).toBe(rawOverride);
      expect(validated.entrypoint).toContain(
        "scripts/runtime/devcanon-runtime.mjs",
      );

      const originalOverride = process.env.DEVCANON_RUNTIME_DIR;
      const originalArguments = process.env.DEVCANON_TEST_ARGUMENTS;
      const originalOverrideCapture = process.env.DEVCANON_TEST_OVERRIDE;
      process.env.DEVCANON_RUNTIME_DIR = rawOverride;
      process.env.DEVCANON_TEST_ARGUMENTS = path.join(root, "arguments");
      process.env.DEVCANON_TEST_OVERRIDE = path.join(root, "override");
      try {
        await expect(
          dispatchRuntimeOverride(rawOverride, ["derive-path", "two words"]),
        ).resolves.toEqual({ exitCode: 23, signal: null });
        expect(await readFile(process.env.DEVCANON_TEST_ARGUMENTS)).toEqual(
          Buffer.from("runtime\0derive-path\0two words\0"),
        );
        expect(await readFile(process.env.DEVCANON_TEST_OVERRIDE, "utf8")).toBe(
          rawOverride,
        );
      } finally {
        if (originalOverride === undefined)
          Reflect.deleteProperty(process.env, "DEVCANON_RUNTIME_DIR");
        else process.env.DEVCANON_RUNTIME_DIR = originalOverride;
        if (originalArguments === undefined)
          Reflect.deleteProperty(process.env, "DEVCANON_TEST_ARGUMENTS");
        else process.env.DEVCANON_TEST_ARGUMENTS = originalArguments;
        if (originalOverrideCapture === undefined) {
          Reflect.deleteProperty(process.env, "DEVCANON_TEST_OVERRIDE");
        } else process.env.DEVCANON_TEST_OVERRIDE = originalOverrideCapture;
      }
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects raw traversal before any override entrypoint can run", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const sentinel = path.join(root, "sentinel");
      await writeFile(
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(sentinel)}, "entered");\n`,
      );

      await expect(
        dispatchRuntimeOverride(`${runtime}/scripts/..`, ["derive-path"]),
      ).rejects.toThrow(
        "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
      );
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects a final runtime symlink before its entrypoint runs", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const linked = path.join(root, "linked-runtime");
      await symlink(runtime, linked);
      await expect(validateRuntimeOverride(`${linked}/.`)).rejects.toThrow(
        "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects a symlinked entrypoint", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const external = path.join(root, "external.mjs");
      await writeFile(external, "export {};\n");
      await rm(
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );
      await symlink(
        external,
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );

      await expect(validateRuntimeOverride(runtime)).rejects.toThrow(
        "devcanon-runtime entrypoint must not contain a symlink or reparse-point component",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects an entrypoint reached through an escaping resolver directory", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const externalScripts = path.join(root, "external-scripts");
      await mkdir(externalScripts);
      await mkdir(path.join(externalScripts, "runtime"));
      await writeFile(
        path.join(externalScripts, "runtime", "devcanon-runtime.mjs"),
        "export {};\n",
      );
      await rm(path.join(runtime, "scripts"), { recursive: true });
      await symlink(externalScripts, path.join(runtime, "scripts"));

      await expect(validateRuntimeOverride(runtime)).rejects.toThrow(
        "devcanon-runtime entrypoint must not contain a symlink or reparse-point component",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects an internal symlinked resolver directory", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const internalScripts = path.join(runtime, "internal-scripts");
      await mkdir(internalScripts);
      await mkdir(path.join(internalScripts, "runtime"));
      await writeFile(
        path.join(internalScripts, "runtime", "devcanon-runtime.mjs"),
        "export {};\n",
      );
      await rm(path.join(runtime, "scripts"), { recursive: true });
      await symlink(internalScripts, path.join(runtime, "scripts"));

      await expect(validateRuntimeOverride(runtime)).rejects.toThrow(
        "devcanon-runtime entrypoint must not contain a symlink or reparse-point component",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects an internal symlinked typed-runtime directory before execution", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const internalTypedRuntime = path.join(
        runtime,
        "scripts",
        "internal-runtime",
      );
      await mkdir(internalTypedRuntime);
      await writeFile(
        path.join(internalTypedRuntime, "devcanon-runtime.mjs"),
        "process.exit(0);\n",
      );
      await rm(path.join(runtime, "scripts", "runtime"), {
        recursive: true,
      });
      await symlink(
        internalTypedRuntime,
        path.join(runtime, "scripts", "runtime"),
      );
      const sentinels = await writeExecutionSentinels(runtime, root);

      await expect(
        dispatchRuntimeOverride(runtime, ["derive-path"]),
      ).rejects.toThrow(
        "devcanon-runtime entrypoint must not contain a symlink or reparse-point component",
      );
      await expectNoExecution(sentinels);
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("rejects an externally resolving typed CLI symlink before execution", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root);
      const externalCli = path.join(root, "external-runtime.mjs");
      await writeFile(externalCli, "process.exit(0);\n");
      await rm(
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );
      await symlink(
        externalCli,
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );
      const sentinels = await writeExecutionSentinels(runtime, root);
      await rm(
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );
      await symlink(
        externalCli,
        path.join(runtime, "scripts", "runtime", "devcanon-runtime.mjs"),
      );

      await expect(
        dispatchRuntimeOverride(runtime, ["derive-path"]),
      ).rejects.toThrow(
        "devcanon-runtime entrypoint must not contain a symlink or reparse-point component",
      );
      await expectNoExecution(sentinels);
    } finally {
      await cleanupTempDir(root);
    }
  });

  it.runIf(process.platform !== "win32")(
    "forwards repeated termination signals and preserves the child's signal",
    async () => {
      const root = await createTempDir();
      try {
        const runtime = await writeRuntime(root);
        const entrypoint = path.join(
          runtime,
          "scripts",
          "runtime",
          "devcanon-runtime.mjs",
        );
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const childPid = path.join(root, "child-pid");
        await writeFile(
          entrypoint,
          [
            'import { writeFileSync } from "node:fs";',
            "let count = 0;",
            'process.on("SIGTERM", () => {',
            "  count += 1;",
            "  writeFileSync(process.env.DEVCANON_TEST_FORWARDED, String(count));",
            '  if (count === 2) { process.removeAllListeners("SIGTERM"); process.kill(process.pid, "SIGTERM"); }',
            "});",
            "setTimeout(() => {",
            '  writeFileSync(process.env.DEVCANON_TEST_READY, "ready");',
            "  writeFileSync(process.env.DEVCANON_TEST_CHILD_PID, String(process.pid));",
            "}, 50);",
            "setInterval(() => {}, 1_000);",
            "",
          ].join("\n"),
        );
        const bootstrap = spawnChild(
          process.execPath,
          [
            "--import",
            "tsx",
            path.resolve("src/runtime/bootstrap-cli.ts"),
            "--runtime-dir",
            runtime,
            "--",
            "derive-path",
          ],
          {
            env: {
              ...process.env,
              DEVCANON_RUNTIME_DIR: runtime,
              DEVCANON_TEST_FORWARDED: forwarded,
              DEVCANON_TEST_READY: ready,
              DEVCANON_TEST_CHILD_PID: childPid,
            },
            stdio: "ignore",
          },
        );
        await waitForFile(ready);
        expect(bootstrap.kill("SIGTERM")).toBe(true);
        await waitForContents(forwarded, "1");
        expect(bootstrap.kill("SIGTERM")).toBe(true);
        const result = await waitForChildExit(bootstrap);

        expect(await readFile(forwarded, "utf8")).toBe("2");
        expect(result).toEqual({ exitCode: null, signal: "SIGTERM" });
      } finally {
        await cleanupTempDir(root);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "forwards a bootstrap-group signal to the detached child exactly once",
    async () => {
      const root = await createTempDir();
      let childGroupPid: number | undefined;
      try {
        const runtime = await writeRuntime(root);
        const entrypoint = path.join(
          runtime,
          "scripts",
          "runtime",
          "devcanon-runtime.mjs",
        );
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const descendantForwarded = path.join(root, "descendant-forwarded");
        const childPid = path.join(root, "child-pid");
        await writeFile(
          entrypoint,
          [
            'import { spawn } from "node:child_process";',
            'import { writeFileSync } from "node:fs";',
            "const descendant = spawn(process.execPath, ['-e', `",
            "  const { writeFileSync } = require('node:fs');",
            "  process.on('SIGTERM', () => { writeFileSync(process.env.DEVCANON_TEST_DESCENDANT_FORWARDED, '1'); process.exit(0); });",
            "  setInterval(() => {}, 1000);",
            "`], { env: process.env, stdio: 'ignore' });",
            'process.on("SIGTERM", () => {',
            '  writeFileSync(process.env.DEVCANON_TEST_FORWARDED, "1");',
            '  descendant.once("close", () => process.exit(0));',
            '  descendant.kill("SIGTERM");',
            "});",
            "setTimeout(() => {",
            '  writeFileSync(process.env.DEVCANON_TEST_READY, "ready");',
            "  writeFileSync(process.env.DEVCANON_TEST_CHILD_PID, String(process.pid));",
            "}, 50);",
            "setInterval(() => {}, 1_000);",
            "",
          ].join("\n"),
        );
        const bootstrap = spawnChild(
          process.execPath,
          [
            "--import",
            "tsx",
            path.resolve("src/runtime/bootstrap-cli.ts"),
            "--runtime-dir",
            runtime,
            "--",
            "derive-path",
          ],
          {
            detached: true,
            env: {
              ...process.env,
              DEVCANON_RUNTIME_DIR: runtime,
              DEVCANON_TEST_CHILD_PID: childPid,
              DEVCANON_TEST_DESCENDANT_FORWARDED: descendantForwarded,
              DEVCANON_TEST_FORWARDED: forwarded,
              DEVCANON_TEST_READY: ready,
            },
            stdio: "ignore",
          },
        );
        await waitForFile(ready);
        childGroupPid = Number(await readFile(childPid, "utf8"));
        if (bootstrap.pid === undefined) {
          throw new Error("bootstrap did not provide a process id");
        }
        process.kill(-bootstrap.pid, "SIGTERM");
        expect(await waitForChildExit(bootstrap)).toEqual({
          exitCode: 0,
          signal: null,
        });
        expect(await readFile(forwarded, "utf8")).toBe("1");
        await waitForFile(descendantForwarded);
        expect(await readFile(descendantForwarded, "utf8")).toBe("1");
      } finally {
        if (childGroupPid !== undefined) {
          try {
            process.kill(-childGroupPid, "SIGKILL");
          } catch {}
        }
        await cleanupTempDir(root);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "forwards SIGQUIT received by the bootstrap PID to its detached runtime group",
    async () => {
      const root = await createTempDir();
      let childGroupPid: number | undefined;
      try {
        const fixture = await writeSigquitRuntime(root);
        const bootstrap = spawnChild(
          process.execPath,
          [
            "--import",
            "tsx",
            path.resolve("src/runtime/bootstrap-cli.ts"),
            "--runtime-dir",
            fixture.runtime,
            "--",
            "derive-path",
          ],
          {
            env: {
              ...process.env,
              DEVCANON_RUNTIME_DIR: fixture.runtime,
              DEVCANON_TEST_CHILD_PID: fixture.childPid,
              DEVCANON_TEST_DESCENDANT_FORWARDED: fixture.descendantForwarded,
              DEVCANON_TEST_DESCENDANT_READY: fixture.descendantReady,
              DEVCANON_TEST_FORWARDED: fixture.forwarded,
              DEVCANON_TEST_READY: fixture.ready,
            },
            stdio: "ignore",
          },
        );
        await waitForFile(fixture.ready);
        childGroupPid = Number(await readFile(fixture.childPid, "utf8"));
        expect(bootstrap.kill("SIGQUIT")).toBe(true);
        expect(await waitForChildExit(bootstrap)).toEqual({
          exitCode: 0,
          signal: null,
        });
        expect(await readFile(fixture.forwarded, "utf8")).toBe("1");
        expect(await readFile(fixture.descendantForwarded, "utf8")).toBe("1");
        expectProcessGroupGone(childGroupPid);
      } finally {
        if (childGroupPid !== undefined) {
          terminateProcessGroupIfPresent(childGroupPid);
        }
        await cleanupTempDir(root);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "forwards SIGQUIT from an isolated bootstrap group to its detached runtime group",
    async () => {
      const root = await createTempDir();
      let childGroupPid: number | undefined;
      try {
        const fixture = await writeSigquitRuntime(root);
        const bootstrap = spawnChild(
          process.execPath,
          [
            "--import",
            "tsx",
            path.resolve("src/runtime/bootstrap-cli.ts"),
            "--runtime-dir",
            fixture.runtime,
            "--",
            "derive-path",
          ],
          {
            detached: true,
            env: {
              ...process.env,
              DEVCANON_RUNTIME_DIR: fixture.runtime,
              DEVCANON_TEST_CHILD_PID: fixture.childPid,
              DEVCANON_TEST_DESCENDANT_FORWARDED: fixture.descendantForwarded,
              DEVCANON_TEST_DESCENDANT_READY: fixture.descendantReady,
              DEVCANON_TEST_FORWARDED: fixture.forwarded,
              DEVCANON_TEST_READY: fixture.ready,
            },
            stdio: "ignore",
          },
        );
        await waitForFile(fixture.ready);
        childGroupPid = Number(await readFile(fixture.childPid, "utf8"));
        if (bootstrap.pid === undefined) {
          throw new Error("bootstrap did not provide a process id");
        }
        process.kill(-bootstrap.pid, "SIGQUIT");
        expect(await waitForChildExit(bootstrap)).toEqual({
          exitCode: 0,
          signal: null,
        });
        expect(await readFile(fixture.forwarded, "utf8")).toBe("1");
        expect(await readFile(fixture.descendantForwarded, "utf8")).toBe("1");
        expectProcessGroupGone(childGroupPid);
      } finally {
        if (childGroupPid !== undefined) {
          terminateProcessGroupIfPresent(childGroupPid);
        }
        await cleanupTempDir(root);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "uses the shipped runtime command without ambient Bash lookup",
    async () => {
      const root = await createTempDir();
      try {
        const packagedRuntime = path.join(root, "packaged-runtime");
        const commandBin = path.join(root, "command-bin");
        await mkdir(path.join(packagedRuntime, "scripts", "runtime"), {
          recursive: true,
        });
        await cp(
          path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
          path.join(packagedRuntime, "scripts", "devcanon-runtime.sh"),
        );
        await mkdir(commandBin);
        await symlink(process.execPath, path.join(commandBin, "node"));
        await symlink("/usr/bin/dirname", path.join(commandBin, "dirname"));
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const runtimeBundle = path.join(
          packagedRuntime,
          "scripts",
          "runtime",
          "devcanon-runtime.mjs",
        );
        await writeFile(
          runtimeBundle,
          [
            'import { writeFileSync } from "node:fs";',
            'writeFileSync(process.env.DEVCANON_TEST_READY, "ready");',
            'process.on("SIGTERM", () => {',
            '  writeFileSync(process.env.DEVCANON_TEST_FORWARDED, "forwarded");',
            '  process.removeAllListeners("SIGTERM");',
            '  process.kill(process.pid, "SIGTERM");',
            "});",
            "setInterval(() => {}, 1000);",
            "",
          ].join("\n"),
        );
        const runtime = spawnChild(
          "/bin/bash",
          [
            path.join(packagedRuntime, "scripts", "devcanon-runtime.sh"),
            "runtime",
            "signal-fixture",
          ],
          {
            env: {
              ...process.env,
              BASH: "/poisoned/bash",
              SHELL: "/poisoned/shell",
              PATH: commandBin,
              DEVCANON_TEST_FORWARDED: forwarded,
              DEVCANON_TEST_READY: ready,
            },
            stdio: "ignore",
          },
        );
        await waitForFile(ready);
        expect(runtime.kill("SIGTERM")).toBe(true);
        expect(await waitForChildExit(runtime)).toEqual({
          exitCode: null,
          signal: "SIGTERM",
        });
        expect(await readFile(forwarded, "utf8")).toBe("forwarded");
      } finally {
        await cleanupTempDir(root);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "runs bootstrap without ambient Bash lookup despite poisoned values",
    async () => {
      const root = await createTempDir();
      try {
        const packagedRuntime = path.join(root, "packaged-runtime");
        const override = path.join(root, "override");
        const commandBin = path.join(root, "command-bin");
        await mkdir(path.join(packagedRuntime, "scripts", "runtime"), {
          recursive: true,
        });
        await cp(
          path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
          path.join(packagedRuntime, "scripts", "devcanon-runtime.sh"),
        );
        await writeFile(
          path.join(
            packagedRuntime,
            "scripts",
            "runtime",
            "devcanon-runtime.mjs",
          ),
          "process.exit(0);\n",
        );
        await mkdir(path.join(override, "scripts", "runtime"), {
          recursive: true,
        });
        await mkdir(commandBin);
        await symlink(process.execPath, path.join(commandBin, "node"));
        await symlink("/usr/bin/dirname", path.join(commandBin, "dirname"));
        const entrypoint = path.join(
          override,
          "scripts",
          "devcanon-runtime.sh",
        );
        await writeFile(entrypoint, "#!/bin/bash\nexit 0\n");
        await chmod(entrypoint, 0o755);
        await writeFile(
          path.join(override, "scripts", "runtime", "devcanon-runtime.mjs"),
          "process.exit(0);\n",
        );
        const bootstrap = spawnChild(
          "/bin/bash",
          [
            path.join(packagedRuntime, "scripts", "devcanon-runtime.sh"),
            "bootstrap",
            "--runtime-dir",
            override,
            "--",
            "derive-path",
          ],
          {
            env: {
              ...process.env,
              BASH: "/poisoned/bash",
              SHELL: "/poisoned/shell",
              PATH: commandBin,
              DEVCANON_RUNTIME_DIR: override,
            },
            stdio: "ignore",
          },
        );
        expect(await waitForChildExit(bootstrap)).toEqual({
          exitCode: 0,
          signal: null,
        });
      } finally {
        await cleanupTempDir(root);
      }
    },
  );
});
