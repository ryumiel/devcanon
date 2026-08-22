import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const [command, args] =
  process.platform === "win32"
    ? ["npm", ["install", "--global", "--force", repositoryRoot]]
    : ["pnpm", ["add", "--global", repositoryRoot]];

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
