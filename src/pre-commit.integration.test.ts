import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

interface CommandBehavior {
  status: number;
  stdout?: string;
  stderr?: string;
  repeatStdoutChar?: string;
  repeatStdoutCount?: number;
}

interface FixtureOptions {
  stagedFiles: string[];
  trackedMarkdownFiles?: string[];
  pnpmBehaviors?: Record<string, CommandBehavior>;
  env?: Record<string, string>;
}

interface FixtureResult {
  status: number;
  stdout: string;
  stderr: string;
  invocations: string[][];
}

const repoRoot = process.cwd();
const tempDirs: string[] = [];

async function runExecResult(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };

    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

async function initializeGitRepo(rootDir: string): Promise<void> {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: rootDir,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: rootDir,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: rootDir,
  });
}

async function writeMarkdownFiles(
  rootDir: string,
  files: string[],
): Promise<void> {
  for (const file of files) {
    const absolutePath = path.join(rootDir, file);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `# ${path.basename(file)}\n`, "utf8");
  }
}

async function createPnpmShim(
  rootDir: string,
  invocationLogPath: string,
): Promise<string> {
  const shimDir = path.join(rootDir, "bin");
  const shimScriptPath = path.join(shimDir, "pnpm-shim.cjs");
  const shimPath = path.join(shimDir, "pnpm");
  const shimCmdPath = path.join(shimDir, "pnpm.cmd");

  await mkdir(shimDir, { recursive: true });

  const shimSource = `#!/usr/bin/env node
const fs = require("node:fs");
const writeSync = fs.writeSync;

const logPath = process.env.PNPM_INVOCATION_LOG_PATH;
const behaviors = JSON.parse(process.env.PNPM_BEHAVIORS_JSON ?? "{}");
const argv = process.argv.slice(2);
const key = argv.join(" ");
const current = JSON.parse(fs.readFileSync(logPath, "utf8"));
current.push(argv);
fs.writeFileSync(logPath, JSON.stringify(current, null, 2) + "\\n");
const behavior = behaviors[key] ?? { status: 0, stdout: "", stderr: "" };
if (behavior.stdout) writeSync(process.stdout.fd, behavior.stdout);
if (behavior.stderr) writeSync(process.stderr.fd, behavior.stderr);
if (behavior.repeatStdoutChar && behavior.repeatStdoutCount) {
  writeSync(
    process.stdout.fd,
    behavior.repeatStdoutChar.repeat(behavior.repeatStdoutCount),
  );
}
process.exit(behavior.status);
`;

  await writeFile(shimScriptPath, shimSource, "utf8");
  await writeFile(
    shimPath,
    '#!/bin/sh\nnode "$(dirname "$0")/pnpm-shim.cjs" "$@"\n',
    "utf8",
  );
  await writeFile(
    shimCmdPath,
    '@echo off\r\nnode "%~dp0\\pnpm-shim.cjs" %*\r\n',
    "utf8",
  );
  await chmod(shimPath, 0o755);

  return shimDir;
}

async function stageFixtureFiles(
  rootDir: string,
  trackedMarkdownFiles: string[],
  stagedFiles: string[],
): Promise<void> {
  await writeFile(
    path.join(rootDir, "package.json"),
    '{ "name": "fixture" }\n',
    "utf8",
  );
  await writeMarkdownFiles(rootDir, trackedMarkdownFiles);
  await execFileAsync("git", ["add", "."], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-m", "chore: fixture baseline"], {
    cwd: rootDir,
  });

  for (const file of stagedFiles) {
    await writeFile(
      path.join(rootDir, file),
      `# changed ${path.basename(file)}\n`,
      "utf8",
    );
    await execFileAsync("git", ["add", file], { cwd: rootDir });
  }
}

async function runCheckStagedFixture(
  options: FixtureOptions,
): Promise<FixtureResult> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "am-pre-commit-"));
  const trackedMarkdownFiles =
    options.trackedMarkdownFiles ?? options.stagedFiles;
  const invocationLogPath = path.join(rootDir, "pnpm-invocations.json");
  tempDirs.push(rootDir);

  await initializeGitRepo(rootDir);
  await writeFile(invocationLogPath, "[]\n", "utf8");
  await stageFixtureFiles(rootDir, trackedMarkdownFiles, options.stagedFiles);
  const shimDir = await createPnpmShim(rootDir, invocationLogPath);

  const result = await runExecResult(
    "node",
    [path.join(repoRoot, "scripts", "run-pre-commit-checks.mjs")],
    rootDir,
    {
      ...process.env,
      ...options.env,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PNPM_BEHAVIORS_JSON: JSON.stringify(options.pnpmBehaviors ?? {}),
      PNPM_INVOCATION_LOG_PATH: invocationLogPath,
    },
  );

  const invocations = JSON.parse(
    await readFile(invocationLogPath, "utf8"),
  ) as string[][];

  return {
    status: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    invocations,
  };
}

async function runHelperScriptFixture(input: {
  script:
    | "scripts/format-tracked-markdown.mjs"
    | "scripts/lint-tracked-markdown.mjs";
  args: string[];
  trackedMarkdownFiles: string[];
}): Promise<FixtureResult> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "am-markdown-helper-"));
  const invocationLogPath = path.join(rootDir, "pnpm-invocations.json");
  tempDirs.push(rootDir);

  await initializeGitRepo(rootDir);
  await writeFile(invocationLogPath, "[]\n", "utf8");
  await stageFixtureFiles(rootDir, input.trackedMarkdownFiles, []);
  const shimDir = await createPnpmShim(rootDir, invocationLogPath);

  const result = await runExecResult(
    "node",
    [path.join(repoRoot, input.script), ...input.args],
    rootDir,
    {
      ...process.env,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PNPM_INVOCATION_LOG_PATH: invocationLogPath,
      PNPM_BEHAVIORS_JSON: "{}",
    },
  );

  const invocations = JSON.parse(
    await readFile(invocationLogPath, "utf8"),
  ) as string[][];

  return {
    status: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    invocations,
  };
}

describe("pre-commit markdown scripts", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("suppresses successful markdown tool chatter by default", async () => {
    const result = await runCheckStagedFixture({
      stagedFiles: ["docs/guide.md"],
      pnpmBehaviors: {
        "run format:markdown:check -- docs/guide.md": {
          status: 0,
          stdout:
            "Checking formatting...\nAll matched files use Prettier code style!\n",
        },
        "run lint:markdown -- docs/guide.md": {
          status: 0,
          stdout: "markdownlint scanned docs/guide.md\n",
        },
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK markdown format (1 staged file)");
    expect(result.stdout).toContain("OK markdown lint (1 staged file)");
    expect(result.stdout).not.toContain(
      "All matched files use Prettier code style!",
    );
    expect(result.stdout).not.toContain("markdownlint scanned docs/guide.md");
  });

  it("replays markdown diagnostics on failure", async () => {
    const result = await runCheckStagedFixture({
      stagedFiles: ["docs/guide.md"],
      pnpmBehaviors: {
        "run format:markdown:check -- docs/guide.md": {
          status: 1,
          stdout: "Checking formatting...\n[warn] docs/guide.md\n",
        },
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL markdown format (1 staged file)");
    expect(result.stdout).toContain("[warn] docs/guide.md");
  });

  it("replays successful tool chatter in verbose mode", async () => {
    const result = await runCheckStagedFixture({
      stagedFiles: ["docs/guide.md"],
      env: { AGENTS_MANAGER_PRECOMMIT_VERBOSE: "1" },
      pnpmBehaviors: {
        "run format:markdown:check -- docs/guide.md": {
          status: 0,
          stdout:
            "Checking formatting...\nAll matched files use Prettier code style!\n",
        },
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "All matched files use Prettier code style!",
    );
  });

  it("replays large verbose markdown output without truncating the child process", async () => {
    const result = await runCheckStagedFixture({
      stagedFiles: ["docs/guide.md"],
      env: { AGENTS_MANAGER_PRECOMMIT_VERBOSE: "1" },
      pnpmBehaviors: {
        "run format:markdown:check -- docs/guide.md": {
          status: 0,
          repeatStdoutChar: "x",
          repeatStdoutCount: 11_000_000,
        },
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("ENOBUFS");
    expect(result.stdout).toContain("OK markdown format (1 staged file)");
  });

  it("passes only staged markdown files to markdown helper scripts", async () => {
    const result = await runCheckStagedFixture({
      stagedFiles: ["docs/staged.md"],
      trackedMarkdownFiles: ["docs/staged.md", "docs/unrelated.md"],
    });

    expect(result.invocations).toContainEqual([
      "run",
      "format:markdown:check",
      "--",
      "docs/staged.md",
    ]);
    expect(result.invocations).toContainEqual([
      "run",
      "lint:markdown",
      "--",
      "docs/staged.md",
    ]);
    expect(result.invocations.flat()).not.toContain("docs/unrelated.md");
  });

  it("formatter uses explicit file arguments instead of rediscovering tracked files", async () => {
    const result = await runHelperScriptFixture({
      script: "scripts/format-tracked-markdown.mjs",
      args: ["--check", "--", "docs/staged.md"],
      trackedMarkdownFiles: ["docs/staged.md", "docs/unrelated.md"],
    });

    expect(result.invocations).toContainEqual([
      "exec",
      "prettier",
      "--check",
      "docs/staged.md",
    ]);
    expect(result.invocations.flat()).not.toContain("docs/unrelated.md");
  });

  it("linter uses explicit file arguments instead of rediscovering tracked files", async () => {
    const result = await runHelperScriptFixture({
      script: "scripts/lint-tracked-markdown.mjs",
      args: ["--", "docs/staged.md"],
      trackedMarkdownFiles: ["docs/staged.md", "docs/unrelated.md"],
    });

    expect(result.invocations).toContainEqual([
      "exec",
      "markdownlint-cli2",
      "docs/staged.md",
    ]);
    expect(result.invocations.flat()).not.toContain("docs/unrelated.md");
  });

  it("helper scripts keep tracked-file fallback when no file arguments are provided", async () => {
    const formatResult = await runHelperScriptFixture({
      script: "scripts/format-tracked-markdown.mjs",
      args: ["--check"],
      trackedMarkdownFiles: ["docs/staged.md", "docs/unrelated.md"],
    });

    expect(formatResult.invocations).toContainEqual([
      "exec",
      "prettier",
      "--check",
      "docs/staged.md",
      "docs/unrelated.md",
    ]);

    const lintResult = await runHelperScriptFixture({
      script: "scripts/lint-tracked-markdown.mjs",
      args: [],
      trackedMarkdownFiles: ["docs/staged.md", "docs/unrelated.md"],
    });

    expect(lintResult.invocations).toContainEqual([
      "exec",
      "markdownlint-cli2",
      "docs/staged.md",
      "docs/unrelated.md",
    ]);
  });
});
