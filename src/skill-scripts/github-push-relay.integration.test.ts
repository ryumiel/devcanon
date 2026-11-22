import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { it } from "vitest";

const execute = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "delivers signed GitHub push fixtures to the exact ledger-bound recipients",
  async () => {
    await execute("python3", [
      "-B",
      "src/skill-scripts/github-push-relay.fixture.py",
      "skills/issue-batch-coordination/scripts/github-push-relay.py",
    ]);
  },
);
