import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASH_HELPER_PATH_ENV_KEYS,
  normalizeBashScriptEnvPaths,
} from "./bash-paths.js";

describe("bash path normalization", () => {
  it("normalizes nested helper script env paths for Bash", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bash-paths-"));
    const helper = path.join(tempRoot, "helper.sh");

    try {
      await writeFile(
        helper,
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'helper-ok\\n'\n",
      );

      const env = await normalizeBashScriptEnvPaths(
        {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: helper,
        },
        ["PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT"],
      );
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

      const normalized = await normalizeBashScriptEnvPaths(
        env,
        BASH_HELPER_PATH_ENV_KEYS,
      );

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
});
