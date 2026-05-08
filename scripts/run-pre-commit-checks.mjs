#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readdirSync, writeSync } from "node:fs";
import path from "node:path";

function getStagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  ).trim();

  if (!output) {
    return [];
  }

  return output.split("\n").filter(Boolean);
}

function hasCaseMismatch(filePath) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const entries = readdirSync(directory === "." ? process.cwd() : directory, {
    encoding: "utf8",
  });
  const actual = entries.find(
    (entry) => entry.toLowerCase() === basename.toLowerCase(),
  );

  return Boolean(actual && actual !== basename);
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function writeCapturedOutput(result) {
  if (result.stdout) {
    writeSync(process.stdout.fd, result.stdout);
  }

  if (result.stderr) {
    writeSync(process.stderr.fd, result.stderr);
  }
}

async function runScript(label, args, fileCount, verbose) {
  const child = spawn("pnpm", ["run", ...args], {
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let error;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("error", (childError) => {
    error = childError;
  });

  const status = await new Promise((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });

  const prefix = status === 0 ? "OK" : "FAIL";
  console.log(`${prefix} ${label} (${pluralize(fileCount, "staged file")})`);

  if (error) {
    console.error(error.message);
  }

  if (verbose || status !== 0 || error) {
    writeCapturedOutput({ stdout, stderr });
  }

  return status;
}

function runRepoScript(name) {
  const result = spawnSync("pnpm", ["run", name], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

const stagedFiles = getStagedFiles();
const PRECOMMIT_VERBOSE_ENV_VAR = "DEVCANON_PRECOMMIT_VERBOSE";
const verbose = process.env[PRECOMMIT_VERBOSE_ENV_VAR] === "1";
const stagedMarkdownFiles = stagedFiles.filter((file) => file.endsWith(".md"));
const stagedRepoCodeFiles = stagedFiles.filter((file) =>
  /\.(?:ts|c?js|json|jsonc|mjs)$/.test(file),
);
const hasMarkdown = stagedMarkdownFiles.length > 0;
const hasRepoCode = stagedRepoCodeFiles.length > 0;

let failed = false;

for (const file of stagedFiles) {
  if (hasCaseMismatch(file)) {
    console.error(`ERROR: Case mismatch detected for ${file}`);
    failed = true;
  }
}

if (hasRepoCode && runRepoScript("format:check") !== 0) {
  failed = true;
}

if (hasRepoCode && runRepoScript("lint") !== 0) {
  failed = true;
}

if (
  hasMarkdown &&
  (await runScript(
    "markdown format",
    ["format:markdown:check", "--", ...stagedMarkdownFiles],
    stagedMarkdownFiles.length,
    verbose,
  )) !== 0
) {
  failed = true;
}

if (
  hasMarkdown &&
  (await runScript(
    "markdown lint",
    ["lint:markdown", "--", ...stagedMarkdownFiles],
    stagedMarkdownFiles.length,
    verbose,
  )) !== 0
) {
  failed = true;
}

process.exit(failed ? 1 : 0);
