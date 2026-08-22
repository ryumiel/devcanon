import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const operations =
  process.platform === "win32"
    ? [
        ["npm", ["uninstall", "--global", "devcanon", "--ignore-scripts"]],
        ["npm", ["install", "--global", repositoryRoot]],
      ]
    : [["pnpm", ["add", "--global", repositoryRoot]]];

for (const [command, args] of operations) {
  const result = spawn.sync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
