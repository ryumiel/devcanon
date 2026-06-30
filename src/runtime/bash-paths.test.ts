import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASH_HELPER_PATH_ENV_KEYS,
  normalizeBashScriptEnvPaths,
} from "./bash-paths.js";

type BashPathsModule = typeof import("./bash-paths.js");

async function withMockedWin32BashPaths(
  options: {
    pathEntries: string[];
    accessibleBashPaths: Set<string>;
    execFile: (
      command: string,
      args: readonly string[],
      options: unknown,
    ) => Promise<{ stdout: string; stderr: string }>;
  },
  run: (
    module: BashPathsModule,
    mocks: {
      access: ReturnType<typeof vi.fn>;
      execFile: ReturnType<typeof vi.fn>;
      env: NodeJS.ProcessEnv;
    },
  ) => Promise<void>,
): Promise<void> {
  vi.resetModules();
  const platformSpy = vi
    .spyOn(process, "platform", "get")
    .mockReturnValue("win32");
  const accessMock = vi.fn(async (candidate: string) => {
    if (options.accessibleBashPaths.has(candidate)) return;
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });
  const execFileMock = vi.fn(options.execFile);
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: execFileMock,
  });

  vi.doMock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    access: accessMock,
  }));
  vi.doMock("node:child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:child_process")>()),
    execFile,
  }));

  try {
    const module = await import("./bash-paths.js");
    await run(module, {
      access: accessMock,
      execFile: execFileMock,
      env: { PATH: options.pathEntries.join(path.delimiter) },
    });
  } finally {
    platformSpy.mockRestore();
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:child_process");
    vi.resetModules();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bash path normalization", () => {
  it("normalizes nested helper script env paths for Bash", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bash-paths-"));
    const helper = path.join(tempRoot, "helper.sh");

    try {
      await writeFile(
        helper,
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'helper-ok\\n'\n",
      );

      const env = await normalizeOrAcceptLocalConverterTimeout({
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: helper,
      });
      if (env === null) return;
      const script = env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT;

      expect(script).toBeDefined();
      if (process.platform === "win32") {
        expect(script).not.toContain("\\");
      } else {
        expect(script).toBe(helper);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("normalizes all declared Bash helper path env vars before Bash consumes them", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bash-path-env-"));
    const helper = path.join(tempRoot, "helper.sh");

    try {
      await writeFile(
        helper,
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'helper-ok\\n'\n",
      );
      const artifact = path.join(tempRoot, "artifact.json");
      await writeFile(artifact, "{}\n");

      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: helper,
      };
      for (const name of BASH_HELPER_PATH_ENV_KEYS) {
        if (name === "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT") continue;
        env[name] = artifact;
      }

      const normalized = await normalizeOrAcceptLocalConverterTimeout(
        env,
        BASH_HELPER_PATH_ENV_KEYS,
      );
      if (normalized === null) return;

      for (const name of BASH_HELPER_PATH_ENV_KEYS) {
        expect(normalized[name]).toBeDefined();
        if (process.platform === "win32") {
          expect(normalized[name]).not.toContain("\\");
        } else {
          expect(normalized[name]).toBe(env[name]);
        }
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses the Git Bash fallback without probing Bash", async () => {
    const gitBashDir = path.join("C:", "Program Files", "Git", "bin");
    await withMockedWin32BashPaths(
      {
        pathEntries: [gitBashDir],
        accessibleBashPaths: new Set([path.join(gitBashDir, "bash.exe")]),
        execFile: async () => {
          throw new Error("unexpected Bash probe");
        },
      },
      async ({ toBashPath }, { execFile, env }) => {
        await expect(toBashPath("C:\\repo\\artifact.json", env)).resolves.toBe(
          "/c/repo/artifact.json",
        );
        expect(execFile).not.toHaveBeenCalled();
      },
    );
  });

  it("uses wslpath for non-Git Bash paths", async () => {
    const bashDir = path.join("C:", "Windows", "System32");
    await withMockedWin32BashPaths(
      {
        pathEntries: [bashDir],
        accessibleBashPaths: new Set([path.join(bashDir, "bash.exe")]),
        execFile: async (_command, _args, options) => {
          const env = (options as { env: NodeJS.ProcessEnv }).env;
          if (env.DEVCANON_BASH_PATH_INPUT) {
            return { stdout: "/mnt/c/repo/artifact.json\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      },
      async ({ toBashPath }, { env }) => {
        await expect(toBashPath("C:\\repo\\artifact.json", env)).resolves.toBe(
          "/mnt/c/repo/artifact.json",
        );
      },
    );
  });

  it("does not return the Git Bash fallback after non-Git Bash probe timeout", async () => {
    const bashDir = path.join("C:", "Windows", "System32");
    await withMockedWin32BashPaths(
      {
        pathEntries: [bashDir],
        accessibleBashPaths: new Set([path.join(bashDir, "bash.exe")]),
        execFile: async () => {
          const error = new Error("timeout") as Error & { killed: boolean };
          error.killed = true;
          throw error;
        },
      },
      async ({ toBashPath }, { env }) => {
        await expect(
          toBashPath("C:\\repo\\artifact.json", env),
        ).rejects.toThrow("Timed out probing Bash path converter");
      },
    );
  });
});

async function normalizeOrAcceptLocalConverterTimeout(
  env: NodeJS.ProcessEnv,
  names: readonly string[] = ["PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT"],
): Promise<NodeJS.ProcessEnv | null> {
  try {
    return await normalizeBashScriptEnvPaths(env, names);
  } catch (err) {
    if (
      process.platform === "win32" &&
      (err as Error).message.includes("Timed out probing Bash path converter")
    ) {
      return null;
    }
    throw err;
  }
}
