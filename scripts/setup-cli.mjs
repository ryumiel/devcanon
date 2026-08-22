import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const command = isWindows ? "npm" : "pnpm";
const args = isWindows
  ? ["install", "--global", "--force", repositoryRoot]
  : ["add", "--global", repositoryRoot];

const result = spawn.sync(command, args, {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
