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
  const scripts = path.join(runtime, "scripts");
  const typedRuntime = path.join(scripts, "runtime");
  await mkdir(typedRuntime, { recursive: true });
  const entrypoint = path.join(scripts, "devcanon-runtime.sh");
  await writeFile(
    entrypoint,
    [
      "#!/bin/bash",
      'printf \'%s\\0\' "$@" >"$DEVCANON_TEST_ARGUMENTS"',
      'printf \'%s\' "$DEVCANON_RUNTIME_DIR" >"$DEVCANON_TEST_OVERRIDE"',
      "exit 23",
      "",
    ].join("\n"),
  );
  await chmod(entrypoint, 0o755);
  await writeFile(
    path.join(typedRuntime, "cli.js"),
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

async function writeExecutionSentinels(
  runtime: string,
  root: string,
): Promise<{ shell: string; typed: string }> {
  const shell = path.join(root, "shell-executed");
  const typed = path.join(root, "typed-executed");
  const shellEntrypoint = path.join(runtime, "scripts", "devcanon-runtime.sh");
  await writeFile(
    shellEntrypoint,
    `#!/bin/bash\nprintf shell >${JSON.stringify(shell)}\n`,
  );
  await chmod(shellEntrypoint, 0o755);
  await writeFile(
    path.join(runtime, "scripts", "runtime", "cli.js"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(typed)}, "typed");\n`,
  );
  return { shell, typed };
}

async function expectNoExecution(sentinels: {
  shell: string;
  typed: string;
}): Promise<void> {
  await expect(readFile(sentinels.shell, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(sentinels.typed, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
}

describe("trusted runtime bootstrap", () => {
  it("validates a real runtime and dispatches exact child arguments with the raw override", async () => {
    const root = await createTempDir();
    try {
      const runtime = await writeRuntime(root, "runtime\\literal");
      const rawOverride = `${runtime}/.`;
      const validated = await validateRuntimeOverride(rawOverride);
      expect(validated.rawPath).toBe(rawOverride);
      expect(validated.entrypoint).toContain("devcanon-runtime.sh");

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
          Buffer.from(
            process.platform === "win32"
              ? "derive-path\0two words\0"
              : "runtime\0derive-path\0two words\0",
          ),
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
        path.join(runtime, "scripts", "devcanon-runtime.sh"),
        `#!/usr/bin/env bash\nprintf entered >${JSON.stringify(sentinel)}\n`,
      );
      await chmod(path.join(runtime, "scripts", "devcanon-runtime.sh"), 0o755);

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
      const external = path.join(root, "external.sh");
      await writeFile(external, "#!/usr/bin/env bash\n");
      await chmod(external, 0o755);
      await rm(path.join(runtime, "scripts", "devcanon-runtime.sh"));
      await symlink(
        external,
        path.join(runtime, "scripts", "devcanon-runtime.sh"),
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
      await writeFile(
        path.join(externalScripts, "devcanon-runtime.sh"),
        "#!/usr/bin/env bash\n",
      );
      await chmod(path.join(externalScripts, "devcanon-runtime.sh"), 0o755);
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
      await writeFile(
        path.join(internalScripts, "devcanon-runtime.sh"),
        "#!/usr/bin/env bash\n",
      );
      await chmod(path.join(internalScripts, "devcanon-runtime.sh"), 0o755);
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
        path.join(internalTypedRuntime, "cli.js"),
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
        "devcanon-runtime typed entrypoint must not contain a symlink or reparse-point component",
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
      const externalCli = path.join(root, "external-cli.js");
      await writeFile(externalCli, "process.exit(0);\n");
      await rm(path.join(runtime, "scripts", "runtime", "cli.js"));
      await symlink(
        externalCli,
        path.join(runtime, "scripts", "runtime", "cli.js"),
      );
      const sentinels = await writeExecutionSentinels(runtime, root);
      await rm(path.join(runtime, "scripts", "runtime", "cli.js"));
      await symlink(
        externalCli,
        path.join(runtime, "scripts", "runtime", "cli.js"),
      );

      await expect(
        dispatchRuntimeOverride(runtime, ["derive-path"]),
      ).rejects.toThrow(
        "devcanon-runtime typed entrypoint must not contain a symlink or reparse-point component",
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
        const entrypoint = path.join(runtime, "scripts", "devcanon-runtime.sh");
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const childPid = path.join(root, "child-pid");
        await writeFile(
          entrypoint,
          [
            "#!/bin/bash",
            "count=0",
            'trap \'count=$((count + 1)); printf "%s" "$count" > "$DEVCANON_TEST_FORWARDED"; if [ "$count" -eq 2 ]; then trap - TERM; kill -TERM $$; fi\' TERM',
            'printf ready > "$DEVCANON_TEST_READY"',
            'printf "%s" "$$" > "$DEVCANON_TEST_CHILD_PID"',
            "while true; do sleep 1; done",
            "",
          ].join("\n"),
        );
        await chmod(entrypoint, 0o755);
        const bootstrap = spawnChild(
          process.execPath,
          [
            path.resolve(
              "skills/devcanon-runtime/scripts/runtime/bootstrap-cli.js",
            ),
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
        const entrypoint = path.join(runtime, "scripts", "devcanon-runtime.sh");
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const descendantForwarded = path.join(root, "descendant-forwarded");
        const childPid = path.join(root, "child-pid");
        await writeFile(
          entrypoint,
          [
            "#!/bin/bash",
            "count=0",
            "(",
            "  descendant_count=0",
            '  trap \'descendant_count=$((descendant_count + 1)); printf "%s" "$descendant_count" > "$DEVCANON_TEST_DESCENDANT_FORWARDED"; exit 0\' TERM',
            "  while true; do sleep 1; done",
            ") &",
            "descendant=$!",
            'trap \'count=$((count + 1)); printf "%s" "$count" > "$DEVCANON_TEST_FORWARDED"; wait "$descendant"; exit 0\' TERM',
            'printf ready > "$DEVCANON_TEST_READY"',
            'printf "%s" "$$" > "$DEVCANON_TEST_CHILD_PID"',
            "while true; do sleep 1; done",
            "",
          ].join("\n"),
        );
        await chmod(entrypoint, 0o755);
        const bootstrap = spawnChild(
          process.execPath,
          [
            path.resolve(
              "skills/devcanon-runtime/scripts/runtime/bootstrap-cli.js",
            ),
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
    "uses the shipped runtime command without ambient Bash lookup",
    async () => {
      const root = await createTempDir();
      try {
        const packagedRuntime = path.join(root, "packaged-runtime");
        const commandBin = path.join(root, "command-bin");
        await cp(path.resolve("skills/devcanon-runtime"), packagedRuntime, {
          recursive: true,
        });
        await mkdir(commandBin);
        await symlink(process.execPath, path.join(commandBin, "node"));
        await symlink("/usr/bin/dirname", path.join(commandBin, "dirname"));
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        const runtimeCli = path.join(
          packagedRuntime,
          "scripts",
          "runtime",
          "cli.js",
        );
        await writeFile(
          runtimeCli,
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
        await cp(path.resolve("skills/devcanon-runtime"), packagedRuntime, {
          recursive: true,
        });
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
          path.join(override, "scripts", "runtime", "cli.js"),
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
