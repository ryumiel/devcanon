import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const command = isWindows ? "npm" : "pnpm";
const args = isWindows
  ? ["install", "--global", repositoryRoot]
  : ["add", "--global", repositoryRoot];

if (isWindows) {
  const currentRegistration = spawn.sync(
    "npm",
    ["list", "--global", "devcanon", "--depth=0"],
    { cwd: repositoryRoot, stdio: "ignore" },
  );

  if (currentRegistration.error) {
    throw currentRegistration.error;
  }

  if (currentRegistration.status === 0) {
    args.splice(2, 0, "--force");
  }
}

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
