#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.argv.length !== 2) {
  fail("resolve-bash.mjs does not accept arguments");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(scriptDir, "runtime", "devcanon-runtime.mjs");
try {
  const stat = lstatSync(cliPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`devcanon-runtime bundle missing: ${cliPath}`);
  }
} catch {
  fail(`devcanon-runtime bundle missing: ${cliPath}`);
}

const child = spawnSync(
  process.execPath,
  [cliPath, "runtime", "resolve-bash"],
  {
    encoding: "utf8",
    env: process.env,
    input: "",
    windowsHide: true,
  },
);
if (child.error) fail(child.error.message);
if (child.status !== 0) {
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(child.status ?? 1);
}

const stdout = child.stdout ?? "";
if (child.stderr) {
  fail(`resolve-bash returned unexpected stderr: ${child.stderr.trim()}`);
}
const executable = stdout.endsWith("\n") ? stdout.slice(0, -1) : "";
if (
  executable.length === 0 ||
  executable.includes("\n") ||
  executable.includes("\r") ||
  !path.isAbsolute(executable)
) {
  fail("resolve-bash returned missing or malformed path stdout");
}
process.stdout.write(stdout);
