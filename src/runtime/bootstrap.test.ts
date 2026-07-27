import {
  chmod,
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
  await mkdir(scripts, { recursive: true });
  const entrypoint = path.join(scripts, "devcanon-runtime.sh");
  await writeFile(
    entrypoint,
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\0\' "$@" >"$DEVCANON_TEST_ARGUMENTS"',
      'printf \'%s\' "$DEVCANON_RUNTIME_DIR" >"$DEVCANON_TEST_OVERRIDE"',
      "exit 23",
      "",
    ].join("\n"),
  );
  await chmod(entrypoint, 0o755);
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
          Buffer.from("runtime\0derive-path\0two words\0"),
        );
        expect(await readFile(process.env.DEVCANON_TEST_OVERRIDE, "utf8")).toBe(
          rawOverride,
        );
      } finally {
        if (originalOverride === undefined)
          process.env.DEVCANON_RUNTIME_DIR = undefined;
        else process.env.DEVCANON_RUNTIME_DIR = originalOverride;
        if (originalArguments === undefined)
          process.env.DEVCANON_TEST_ARGUMENTS = undefined;
        else process.env.DEVCANON_TEST_ARGUMENTS = originalArguments;
        if (originalOverrideCapture === undefined) {
          process.env.DEVCANON_TEST_OVERRIDE = undefined;
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

  it.runIf(process.platform !== "win32")(
    "forwards termination to the child and preserves the child's signal",
    async () => {
      const root = await createTempDir();
      try {
        const runtime = await writeRuntime(root);
        const entrypoint = path.join(runtime, "scripts", "devcanon-runtime.sh");
        const ready = path.join(root, "ready");
        const forwarded = path.join(root, "forwarded");
        await writeFile(
          entrypoint,
          [
            "#!/usr/bin/env bash",
            "trap 'printf forwarded > \"$DEVCANON_TEST_FORWARDED\"; trap - TERM; kill -TERM $$' TERM",
            'printf ready > "$DEVCANON_TEST_READY"',
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
            },
            stdio: "ignore",
          },
        );
        await waitForFile(ready);
        expect(bootstrap.kill("SIGTERM")).toBe(true);
        const result = await new Promise<{
          exitCode: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve) => {
          bootstrap.once("close", (exitCode, signal) => {
            resolve({ exitCode, signal });
          });
        });

        expect(await readFile(forwarded, "utf8")).toBe("forwarded");
        expect(result).toEqual({ exitCode: null, signal: "SIGTERM" });
      } finally {
        await cleanupTempDir(root);
      }
    },
  );
});
import { spawn as spawnChild } from "node:child_process";
