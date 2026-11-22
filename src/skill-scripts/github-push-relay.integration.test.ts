import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";

it("validates signed push delivery and its ledger and queue boundaries", async () => {
  const fixture = fileURLToPath(
    new URL("./github-push-relay.fixture.mjs", import.meta.url),
  );
  await promisify(execFile)(process.execPath, ["--test", fixture]);
}, 15000);
