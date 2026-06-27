import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { normalizeBashScriptEnvPaths } from "./bash-paths.js";

const execFileAsync = promisify(execFile);

describe("bash path normalization", () => {
  it("normalizes nested helper script env paths before Bash consumes them", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bash-paths-"));
    const helper = path.join(tempRoot, "helper.sh");

    try {
      await writeFile(
        helper,
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'helper-ok\\n'\n",
      );
      await chmod(helper, 0o755);

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
      const { stdout } = await execFileAsync("bash", [script ?? ""], { env });
      expect(stdout).toBe("helper-ok\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
