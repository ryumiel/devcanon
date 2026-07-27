import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createRuntimeConformanceFixture,
  renderRuntimeConformanceFixture,
  syncRuntimeConformanceFixture,
} from "../__test-helpers__/runtime-conformance.js";
import { runPlayReviewSharedContextCommand } from "./play-review-shared-context.js";
import {
  type PrReviewLease,
  discoveryFilesystemPath,
  discoveryGitEnvironment,
  invalidateDuplicateDiscoveryWorktreeClaims,
  parseDiscoveryGitPathRecord,
  parseDiscoveryGitlinkRecords,
  parseDiscoveryLease,
  reducePrReviewDiscovery,
  reducePrReviewLease,
  runPrReviewLeasesCommand,
  validatePrReviewDiscoveryJson,
} from "./pr-review-leases.js";

const execFileAsync = promisify(execFile);

const discoveryGitlinkSelectedPathMaxBytes = 64 * 1024;
const discoveryGitlinkSelectedRecordMaxCount = 4096;
const discoveryGitlinkSelectedAggregateMaxBytes = 1024 * 1024;

function discoveryGitlinkRecord(pathBytes: Buffer | string): Buffer {
  return Buffer.concat([
    Buffer.from(`160000 ${"a".repeat(40)} 0\t`, "ascii"),
    typeof pathBytes === "string" ? Buffer.from(pathBytes) : pathBytes,
    Buffer.from([0]),
  ]);
}

const discoveryGitAdapterLogName = "git-adapter.log";
let discoveryGitWindowsLauncherRoot: string | undefined;
let discoveryGitWindowsLauncher: string | undefined;
let discoveryGitWindowsBash: string | undefined;
let activeDiscoveryGitAdapterLog: string | undefined;

const discoveryGitWindowsLauncherSource = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

public static class DevCanonDiscoveryGitLauncher
{
    private static string QuoteWindowsArgument(string value)
    {
        if (value.Length > 0 &&
            value.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0)
        {
            return value;
        }

        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }
            quoted.Append('\\', backslashes);
            backslashes = 0;
            quoted.Append(character);
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static void AppendWindowsArgument(
        StringBuilder commandLine,
        string value)
    {
        if (commandLine.Length > 0)
        {
            commandLine.Append(' ');
        }
        commandLine.Append(QuoteWindowsArgument(value));
    }

    private static void WriteField(Stream stream, string value)
    {
        byte[] bytes = new UTF8Encoding(false, true).GetBytes(value);
        stream.Write(bytes, 0, bytes.Length);
        stream.WriteByte(0);
    }

    public static int Main(string[] args)
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        string adapterDirectory = Path.GetDirectoryName(executable);
        string implementation = Path.Combine(adapterDirectory, "git.impl");
        string logPath = Path.Combine(adapterDirectory, "git-adapter.log");
        string bashPath = File.ReadAllText(
            Path.Combine(adapterDirectory, "git-bash.path"),
            new UTF8Encoding(false, true)
        ).TrimEnd('\r', '\n');
        if (!Path.IsPathRooted(bashPath) || !File.Exists(bashPath))
        {
            throw new InvalidOperationException(
                "Git-for-Windows Bash path is unavailable"
            );
        }

        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = bashPath;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardError = true;
        start.EnvironmentVariables["DEVCANON_TEST_NATIVE_PATH"] = implementation;
        StringBuilder commandLine = new StringBuilder();
        AppendWindowsArgument(commandLine, "-lc");
        AppendWindowsArgument(
            commandLine,
            "adapter=$(cygpath -u -- \"$DEVCANON_TEST_NATIVE_PATH\") || exit $?; exec \"$adapter\" \"$@\""
        );
        AppendWindowsArgument(commandLine, "bash");
        foreach (string argument in args)
        {
            AppendWindowsArgument(commandLine, argument);
        }
        start.Arguments = commandLine.ToString();

        int childExit;
        StringBuilder childStderr = new StringBuilder();
        using (Process child = Process.Start(start))
        {
            char[] buffer = new char[4096];
            int count;
            while ((count = child.StandardError.Read(buffer, 0, buffer.Length)) > 0)
            {
                int remaining = 65536 - childStderr.Length;
                if (remaining > 0)
                {
                    childStderr.Append(buffer, 0, Math.Min(count, remaining));
                }
            }
            child.WaitForExit();
            childExit = child.ExitCode;
        }
        Console.Error.Write(childStderr.ToString());

        using (FileStream log = new FileStream(
            logPath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.ReadWrite))
        {
            WriteField(log, "ENTRY");
            foreach (string key in new[] {
                "GIT_NO_LAZY_FETCH",
                "GIT_CONFIG_NOSYSTEM",
                "GIT_CONFIG_GLOBAL",
                "GIT_ATTR_NOSYSTEM",
                "GIT_OPTIONAL_LOCKS",
                "GIT_TERMINAL_PROMPT",
                "LC_ALL",
                "LANG"
            })
            {
                WriteField(log, "ENV");
                WriteField(log, key);
                WriteField(log, Environment.GetEnvironmentVariable(key) ?? "");
            }
            WriteField(log, "HOST");
            WriteField(log, bashPath);
            WriteField(log, "ARGS");
            foreach (string argument in args)
            {
                WriteField(log, argument);
            }
            WriteField(log, "CHILD_EXIT");
            WriteField(log, childExit.ToString());
            WriteField(log, "CHILD_STDERR");
            WriteField(log, childStderr.ToString());
            WriteField(log, "END");
        }
        return childExit;
    }
}
`;

const discoveryGitWindowsPowerShellArguments = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$ErrorActionPreference = 'Stop';",
    "Add-Type",
    "-TypeDefinition $env:DEVCANON_TEST_LAUNCHER_SOURCE",
    "-Language CSharp",
    "-OutputType ConsoleApplication",
    "-OutputAssembly $env:DEVCANON_TEST_LAUNCHER_OUTPUT",
  ].join(" "),
] as const;

async function resolveInboxWindowsPowerShell(): Promise<string> {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot)) {
    throw new Error(
      "SystemRoot is unavailable; cannot resolve inbox Windows PowerShell",
    );
  }
  const powershell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!(await lstat(powershell)).isFile()) {
    throw new Error(`inbox Windows PowerShell is unavailable: ${powershell}`);
  }
  return powershell;
}

async function resolveGitForWindowsBash(): Promise<string> {
  const { stdout } = await execFileAsync("where.exe", ["git.exe"]);
  const gitExecutables = stdout
    .split(/\r?\n/gu)
    .filter((entry) => path.win32.isAbsolute(entry));
  const candidates = new Set<string>();
  for (const gitExecutable of gitExecutables) {
    const gitDirectory = path.win32.dirname(gitExecutable);
    candidates.add(path.win32.resolve(gitDirectory, "..", "bin", "bash.exe"));
    candidates.add(
      path.win32.resolve(gitDirectory, "..", "usr", "bin", "bash.exe"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (!(await lstat(candidate)).isFile()) continue;
      await execFileAsync(candidate, [
        "-lc",
        "builtin pwd -W >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1 && git --version >/dev/null 2>&1",
      ]);
      return await realpath(candidate);
    } catch {}
  }
  throw new Error("Git-for-Windows Bash is unavailable");
}

async function toGitBashPath(nativePath: string): Promise<string> {
  if (process.platform !== "win32") {
    return nativePath;
  }
  const { stdout } = await execFileAsync(
    "bash",
    [
      "-lc",
      'command -v cygpath >/dev/null 2>&1 || exit 127; cygpath -u -- "$DEVCANON_TEST_NATIVE_PATH"',
    ],
    {
      env: {
        ...process.env,
        DEVCANON_TEST_NATIVE_PATH: nativePath,
      },
    },
  );
  if (!stdout.endsWith("\n")) {
    throw new Error("cygpath did not emit one terminated path");
  }
  const converted = stdout.slice(0, -1);
  if (converted.length === 0 || /[\0\r\n]/u.test(converted)) {
    throw new Error("cygpath did not emit one non-empty path");
  }
  return converted;
}
const identity = {
  repository: "owner/repo",
  prNumber: 432,
  worktreePath: "/tmp/review-worktree",
  worktreeDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  leaseFile:
    ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
};
const resultDigest =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const refreshedResultDigest =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const originalCwd = process.cwd();
const managedEnvKeys = [
  "REPOSITORY",
  "PR_NUMBER",
  "PRIMARY_REPOSITORY_ROOT",
  "WORKTREE_PATH",
  "LEASE_FILE",
  "HANDOFF_FILE",
  "RESULT_FILE",
  "FINDINGS_FILE",
  "HEAD_SHA",
  "REVIEW_CONTEXT_INPUT_FILE",
  "REVIEW_CONTEXT_INPUT_JSON",
  "STATE",
  "BASE_REF",
  "HEAD_REF",
  "CREATED_AT",
  "UPDATED_AT",
  "PRESENTED_AT",
  "PRESENTATION_STATUS",
  "FINISHED_AT",
  "TERMINAL_REASON",
  "FAILURE_PHASE",
  "FAILURE_REASON",
  "FAILURE_RECOVERABILITY",
  "GITHUB_POST_ATTEMPTED",
  "GITHUB_POST_RESULT",
  "GITHUB_POSTED_AT",
  "APPROVED_REVIEW_FILE",
  "VALIDATED_REVIEW_PAYLOAD_FILE",
  "VALIDATED_PAYLOAD_FILE",
  "EXPECTED_STATE",
  "ALLOW_POLICY_OVERRIDE",
  "PR_REVIEW_DIR",
  "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
  "PR_REVIEW_LEASE_HELPER_SCRIPT",
  "PLAY_REVIEW_HELPER",
  "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
  "DEVCANON_RUNTIME_DIR",
  "GIT_TRACE2_EVENT",
  "GIT_INDEX_FILE",
] as const;

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
});

function createLease(): PrReviewLease {
  return reducePrReviewLease(null, identity, {
    state: "created",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  });
}

function reviewedLease(): PrReviewLease {
  return reducePrReviewLease(createLease(), identity, {
    state: "reviewed",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:01:00Z",
    resultFile: ".ephemeral/pr-432-result.json",
    resultSha256: resultDigest,
  });
}

function gatedLease(): PrReviewLease {
  return reducePrReviewLease(reviewedLease(), identity, {
    state: "gated",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:02:00Z",
    presentedAt: "2026-06-11T00:02:00Z",
    presentationStatus: "preview-current",
    resultSha256: resultDigest,
  });
}

describe("pr-review lease reducer", () => {
  it("creates and advances created, reviewed, and gated leases", () => {
    expect(createLease()).toMatchObject({
      state: "created",
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
      github: { github_post_result: "not-attempted" },
    });

    expect(reviewedLease()).toMatchObject({
      state: "reviewed",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:01:00Z",
          sha256: resultDigest,
        },
      },
    });

    expect(gatedLease()).toMatchObject({
      state: "gated",
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultDigest,
        },
      },
    });
  });

  it("requires digest inputs for result-manifest reducer states", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "reviewed",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:01:00Z",
        resultFile: ".ephemeral/pr-432-result.json",
      }),
    ).toThrow("RESULT_SHA256 is required");

    expect(() =>
      reducePrReviewLease(reviewedLease(), identity, {
        state: "gated",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:02:00Z",
        presentedAt: "2026-06-11T00:02:00Z",
        presentationStatus: "preview-current",
      }),
    ).toThrow("RESULT_SHA256 is required");
  });

  it("records post success and derives GitHub metadata", () => {
    const posted = reducePrReviewLease(gatedLease(), identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:03:00Z",
      githubPostedAt: "2026-06-11T00:03:00Z",
    });

    expect(posted).toMatchObject({
      state: "posted",
      artifacts: {
        approved_review_file: ".ephemeral/topic-approved-review.json",
        validated_payload_file:
          ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
      failure: { phase: null },
    });
  });

  it("rejects posted leases without a validated payload pointer", () => {
    expect(() =>
      reducePrReviewLease(gatedLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:03:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:03:00Z",
        githubPostedAt: "2026-06-11T00:03:00Z",
      }),
    ).toThrow("VALIDATED_REVIEW_PAYLOAD_FILE is required");
  });

  it("preserves gated recovery evidence for GitHub post failures", () => {
    const failed = reducePrReviewLease(gatedLease(), identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });

    expect(failed).toMatchObject({
      state: "failed",
      artifacts: {
        result_file: ".ephemeral/pr-432-result.json",
        approved_review_file: ".ephemeral/topic-approved-review.json",
      },
      presentation: { status: "preview-current" },
      github: {
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      },
    });
  });

  it("covers documented lifecycle transition rows", () => {
    const created = createLease();
    const attached = reducePrReviewLease(created, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:30Z",
      handoffFile: ".ephemeral/pr-432-handoff.json",
    });
    expect(attached.artifacts.handoff_file).toBe(
      ".ephemeral/pr-432-handoff.json",
    );

    const reviewed = reviewedLease();
    const abortedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      finishedAt: "2026-06-11T00:02:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromReviewed).toMatchObject({
      state: "aborted",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
    });

    const gated = gatedLease();
    const refreshedGate = reducePrReviewLease(gated, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      presentedAt: "2026-06-11T00:02:30Z",
      presentationStatus: "edited",
      resultSha256: refreshedResultDigest,
    });
    expect(refreshedGate.presentation.status).toBe("edited");
    expect(refreshedGate.validation.result_manifest.sha256).toBe(
      refreshedResultDigest,
    );

    const abortedFromGated = reducePrReviewLease(gated, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:30Z",
      finishedAt: "2026-06-11T00:03:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromGated.presentation.status).toBe("preview-current");

    const failedFromCreated = reducePrReviewLease(created, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "handoff-validation",
      failureReason: "handoff rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedFromCreated.artifacts.result_file).toBeNull();

    const failedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:05:00Z",
      finishedAt: "2026-06-11T00:05:00Z",
      failurePhase: "preview-render",
      failureReason: "preview failed",
      failureRecoverability: "recoverable",
    });
    expect(failedFromReviewed.artifacts.result_file).toBe(
      ".ephemeral/pr-432-result.json",
    );

    const failedPreApproval = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:06:00Z",
      finishedAt: "2026-06-11T00:06:00Z",
      failurePhase: "stale-head",
      failureReason: "head moved",
      failureRecoverability: "recoverable",
    });
    expect(failedPreApproval.presentation.status).toBe("preview-current");

    const failedApprovalFreeze = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:07:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:07:00Z",
      failurePhase: "approval-freeze",
      failureReason: "approval artifact rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedApprovalFreeze.artifacts.approved_review_file).toBe(
      ".ephemeral/topic-approved-review.json",
    );

    const recoveredGate = reducePrReviewLease(failedPreApproval, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:08:00Z",
      presentedAt: "2026-06-11T00:08:00Z",
      presentationStatus: "preview-current",
      resultSha256: resultDigest,
    });
    expect(recoveredGate.state).toBe("gated");

    const abortedFromFailed = reducePrReviewLease(failedPreApproval, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:09:00Z",
      finishedAt: "2026-06-11T00:09:00Z",
      terminalReason: "not posting",
    });
    expect(abortedFromFailed.state).toBe("aborted");

    const repeatedFailure = reducePrReviewLease(failedPreApproval, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:10:00Z",
      finishedAt: "2026-06-11T00:10:00Z",
      failurePhase: "preview-render",
      failureReason: "preview still failed",
      failureRecoverability: "recoverable",
    });
    expect(repeatedFailure.failure.reason).toBe("preview still failed");

    const githubFailure = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:11:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:11:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });
    const retryPosted = reducePrReviewLease(githubFailure, identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:12:00Z",
      finishedAt: "2026-06-11T00:12:00Z",
      githubPostedAt: "2026-06-11T00:12:00Z",
    });
    expect(retryPosted.github.github_post_result).toBe("succeeded");

    const recreated = reducePrReviewLease(abortedFromFailed, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:13:00Z",
      updatedAt: "2026-06-11T00:13:00Z",
    });
    expect(recreated).toMatchObject({
      state: "created",
      artifacts: { result_file: null },
      validation: {
        result_manifest: { status: null, validated_at: null, sha256: null },
      },
    });
  });

  it("rejects invalid cross-state transitions", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:05:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:05:00Z",
        githubPostedAt: "2026-06-11T00:05:00Z",
      }),
    ).toThrow("invalid lease transition: created -> posted");
  });
});

describe("pr-review lease command validation", () => {
  it("writes result sha256 and same-cycle validation timestamps for every preview presentation", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const firstDigest = await sha256File(path.join(worktree, resultFile));

      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const firstGate = await readLease(primary, leaseFile);
      expect(firstGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: firstDigest,
      });
      expect(firstGate.validation.result_manifest.validated_at).toBe(
        firstGate.updated_at,
      );

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "edited",
      );
      const secondDigest = await sha256File(path.join(worktree, resultFile));
      expect(secondDigest).not.toBe(firstDigest);
      process.env.PRESENTED_AT = "2026-06-11T00:03:00Z";
      process.env.PRESENTATION_STATUS = "edited";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:03:00Z",
      });
      const secondGate = await readLease(primary, leaseFile);
      expect(secondGate.artifacts.result_file).toBe(resultFile);
      expect(secondGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:03:00Z",
        sha256: secondDigest,
      });
      expect(secondGate.validation.result_manifest.validated_at).toBe(
        secondGate.updated_at,
      );
      expect(secondGate.presentation.status).toBe("edited");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy validation shapes without rewriting or migrating them", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-legacy-validation-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const validLease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      const cases: Array<{
        name: string;
        lease: unknown;
        stderr: string;
      }> = [
        {
          name: "missing-validation",
          lease: omitKey(validLease, "validation"),
          stderr: "lease validation metadata missing",
        },
        {
          name: "missing-result-manifest",
          lease: {
            ...validLease,
            validation: {},
          },
          stderr: "lease result_manifest metadata missing",
        },
        {
          name: "missing-digest",
          lease: {
            ...validLease,
            validation: {
              result_manifest: {
                status: "valid",
                validated_at: "2026-06-11T00:01:00Z",
              },
            },
          },
          stderr: "result manifest digest missing",
        },
      ];

      for (const testCase of cases) {
        await writeFile(
          path.join(primary, leaseFile),
          `${JSON.stringify(testCase.lease, null, 2)}\n`,
        );
        const before = await readFile(path.join(primary, leaseFile), "utf8");

        process.env.LEASE_FILE = leaseFile;
        let result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        result = await runPrReviewLeasesCommand(["inspect-worktree"]);
        expect(result.exitCode, testCase.name).toBe(0);
        expect(result.stdout, testCase.name).toContain(
          "REFUSAL_REASON=invalid-lease",
        );
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
        process.env.PRESENTATION_STATUS = "preview-current";
        process.env.RESULT_FILE = resultFile;
        process.env.STATE = "gated";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
        result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid result paths before hashing lifecycle write inputs", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-result-path-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const before = await readFile(path.join(primary, leaseFile), "utf8");
      await writeFile(
        path.join(tempRoot, "outside-result.json"),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );

      process.env.RESULT_FILE = "../outside-result.json";
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("path traversal: ../outside-result.json");
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes a digest when advancing valid reviewed leases to gated", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-valid-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
            resultFile,
            await sha256File(path.join(worktree, resultFile)),
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const lease = await readLease(primary, leaseFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        await sha256File(path.join(worktree, resultFile)),
      );
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts initial not-presented results for reviewed leases without making them live status", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-not-presented-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      const resultSha256 = await sha256File(path.join(worktree, resultFile));
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      const reviewed = await readLease(primary, leaseFile);
      expect(reviewed).toMatchObject({
        state: "reviewed",
        artifacts: { result_file: resultFile },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:01:00Z",
            sha256: resultSha256,
          },
        },
        presentation: { presented_at: null, status: null },
      });

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);

      process.env.HEAD_SHA = reviewHead;
      result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("read-status requires gated lease");

      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.TERMINAL_REASON = "not posting";
      await writeLeaseCommandState({
        state: "aborted",
        updatedAt: "2026-06-11T00:02:00Z",
      });

      const aborted = await readLease(primary, leaseFile);
      expect(aborted).toMatchObject({
        state: "aborted",
        artifacts: { result_file: resultFile },
        presentation: { presented_at: null, status: null },
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before fresh reviewed and gated writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-fresh-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await rm(path.join(workspace.primary, leaseFile), { force: true });
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const createdBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );

      await mutateNestedFindingsWithoutUpdatingResult(workspace);
      process.env.RESULT_FILE = workspace.resultFile;
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      process.env.PR_REVIEW_DIR = workspace.prReviewDir;
      process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
        workspace.prReviewManifestHelperScript;
      process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
        workspace.prReviewLeaseHelperScript;
      process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(createdBefore);

      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            identityFromLeaseFile(leaseFile, workspace.physicalWorktree)
              .worktreeDigest,
            workspace.resultFile,
            workspace.resultSha256,
          ),
          null,
          2,
        )}\n`,
      );
      const reviewedBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      process.env.STATE = "gated";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(reviewedBefore);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed closed cleanup metadata", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-shape-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      for (const cleanup of [
        {
          last_outcome: "unknown",
          last_checked_at: null,
          removed_at: null,
        },
        {
          last_outcome: "removed",
          last_checked_at: "not-a-timestamp",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-02-30T00:00:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
          unexpected: true,
        },
      ]) {
        const lease = await readLease(workspace.primary, workspace.leaseFile);
        lease.cleanup = cleanup as PrReviewLease["cleanup"];
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(lease, null, 2)}\n`,
        );
        const result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode).toBe(1);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid strict failure evidence instead of rejecting failed writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      const beforeFailure = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failedAfterDrift = await readLease(
        workspace.primary,
        workspace.leaseFile,
      );
      expect(failedAfterDrift.state).toBe("failed");
      expect(failedAfterDrift.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failedAfterDrift.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failedAfterDrift.failure).toEqual({
        phase: "github-post",
        reason: "GitHub API rejected review",
        recoverability: "recoverable",
      });
      expect(failedAfterDrift.github).toEqual({
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      });

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(
          {
            ...JSON.parse(beforeFailure),
            state: "failed",
            updated_at: "2026-06-11T00:03:00Z",
            artifacts: {
              ...JSON.parse(beforeFailure).artifacts,
              approved_review_file: process.env.APPROVED_REVIEW_FILE,
              validated_payload_file: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
            },
            terminal: {
              finished_at: "2026-06-11T00:03:00Z",
              reason: null,
            },
            failure: {
              phase: "github-post",
              reason: "GitHub API rejected review",
              recoverability: "recoverable",
            },
            github: {
              github_post_attempted: true,
              github_post_result: "failed",
              github_posted_at: null,
            },
          },
          null,
          2,
        )}\n`,
      );
      const beforePosted = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:04:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(beforePosted);

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failedAfterDrift, null, 2)}\n`,
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:05:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:05:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:05:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "APPROVED_REVIEW_FILE must match existing failed approved-review",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid approval-freeze evidence while recording failed", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-approval-freeze-invalid-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "approval-freeze";
      process.env.FAILURE_REASON = "approved review validation failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        "2222222222222222222222222222222222222222",
      );

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.state).toBe("failed");
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: workspace.resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
      expect(failed.failure).toEqual({
        phase: "approval-freeze",
        reason: "approved review validation failed",
        recoverability: "recoverable",
      });
      expect(failed.github).toEqual({
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace("pr-review-handoff-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: handoffFile,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace(
      "pr-review-invalid-handoff-failure-",
    );
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const handoffPath = path.join(worktree, handoffFile);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
      await writeFile(
        handoffPath,
        `${JSON.stringify({ ...handoff, repository: "other/repo" }, null, 2)}\n`,
      );

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects stale or missing result digests during validate and cleanup classification", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-digest-",
    );

    try {
      setReadStatusEnv(workspace);
      await writeFile(
        path.join(workspace.worktree, workspace.resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: workspace.reviewHead,
          presentation: { status: "preview-current" },
          stale: true,
        })}\n`,
      );

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");

      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest missing");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects terminal stored presentation evidence that mismatches the result", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-presentation-mismatch-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      await mutateLease(workspace, (lease) => {
        expect(lease.state).toBe("failed");
        lease.presentation.status = "edited";
      });

      setReadStatusEnv(workspace);
      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("presentation status mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects lease ref mismatch against result handoff evidence during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.base_ref = "release";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff base ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting malformed existing leases", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "pr-review-lease-"));
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      await writeFile(path.join(primary, leaseFile), "{not json\n");

      process.env.LEASE_FILE = leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:00:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:00:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe("{not json\n");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy reviewed lease/v1 result pointers without validation metadata", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "pr-review-legacy-"));
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const resultFile = ".ephemeral/pr-432-result.json";
      await writeFile(
        path.join(worktree, resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "reviewed",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: resultFile,
            approved_review_file: null,
            validated_payload_file: null,
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("lease validation metadata missing");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown JSON lease states before state-invariant checks", async () => {
    const { tempRoot, primary, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-unknown-state-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "postd",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
          validation: {
            result_manifest: { status: null, validated_at: null, sha256: null },
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown lease state: postd");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects approved reviews from a different result manifest head", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-approved-head-");
    const resultHead = "1111111111111111111111111111111111111111";
    const approvedHead = "2222222222222222222222222222222222222222";
    const resultFile = `.ephemeral/pr-432-${resultHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${approvedHead}-approved-review.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        resultHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        approvedHead,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile: `.ephemeral/pr-432-${approvedHead}-validated-review-payload.json`,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("approved review result head mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-deterministic validated payload paths", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-payload-path-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${reviewHead}-approved-review.json`;
    const validatedPayloadFile =
      ".ephemeral/copied-validated-review-payload.json";

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        reviewHead,
      );
      await writeFile(
        path.join(worktree, validatedPayloadFile),
        `${JSON.stringify(reviewPayload(reviewHead))}\n`,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("validated payload path mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses posted leases missing the validated payload before cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-posted-missing-payload-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("CAN_REMOVE=yes");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a complete validated posted chain for cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-complete-posted-chain-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const validatedPayloadFile = await writeValidatedPayloadArtifact(
      workspace.worktree,
      workspace.reviewHead,
    );

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["validate"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease read-status", () => {
  it("emits the exact status envelope without cleanup fields or lease mutation", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      const result = await runPrReviewLeasesCommand(["read-status"]);
      const after = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(after).toBe(before);
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(Object.keys(status)).toEqual([
        "lease_state",
        "worktree_path",
        "worktree_digest",
        "worktree_exists",
        "worktree_registered",
        "worktree_dirty",
        "identity_match",
        "result_file",
        "result_sha256",
        "result_validated_at",
        "lease_updated_at",
        "presentation_status",
        "presented_at",
      ]);
      expect(status).toMatchObject({
        lease_state: "gated",
        worktree_path: workspace.physicalWorktree,
        worktree_digest: workspace.worktreeDigest,
        worktree_exists: true,
        worktree_registered: true,
        identity_match: true,
        result_file: workspace.resultFile,
        result_sha256: workspace.resultSha256,
        result_validated_at: "2026-06-11T00:02:00Z",
        lease_updated_at: "2026-06-11T00:02:00Z",
        presentation_status: "preview-current",
        presented_at: "2026-06-11T00:02:00Z",
      });
      expect(typeof status.worktree_dirty).toBe("boolean");
      for (const forbidden of [
        "can_remove",
        "force_remove_allowed",
        "refusal_reason",
        "requires_confirmation",
        "metadata_outcome",
      ]) {
        expect(status).not.toHaveProperty(forbidden);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("inspects worktree dirtiness with optional git locks disabled", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-locks-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const traceFile = path.join(workspace.tempRoot, "git-trace2.jsonl");
      const originalTrace = process.env.GIT_TRACE2_EVENT;
      process.env.GIT_TRACE2_EVENT = traceFile;
      try {
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, result.stderr).toBe(0);
      } finally {
        if (originalTrace === undefined) {
          unsetEnv("GIT_TRACE2_EVENT");
        } else {
          process.env.GIT_TRACE2_EVENT = originalTrace;
        }
      }

      const statusArgs = (await readFile(traceFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event?: unknown; argv?: unknown })
        .filter(
          (event): event is { event: "start"; argv: string[] } =>
            event.event === "start" &&
            Array.isArray(event.argv) &&
            event.argv.every((value) => typeof value === "string"),
        )
        .map((event) => event.argv)
        .find((argv) => argv.includes("status"));
      expect(statusArgs).toBeDefined();
      if (statusArgs === undefined) {
        throw new Error("missing git status trace2 start event");
      }
      expect(statusArgs).toEqual(
        expect.arrayContaining([
          "--no-optional-locks",
          "-C",
          workspace.physicalWorktree,
          "status",
          "--porcelain",
        ]),
      );
      expect(statusArgs.indexOf("--no-optional-locks")).toBeLessThan(
        statusArgs.indexOf("status"),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts dirty but valid registered worktrees as status", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-dirty-");

    try {
      await writeFile(path.join(workspace.worktree, "dirty.txt"), "dirty\n");
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        worktree_dirty: true,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when git status cannot inspect the worktree", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-git-failure-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const originalGitIndexFile = process.env.GIT_INDEX_FILE;
      process.env.GIT_INDEX_FILE = workspace.tempRoot;
      const result = await runPrReviewLeasesCommand(["read-status"]);
      if (originalGitIndexFile === undefined) {
        unsetEnv("GIT_INDEX_FILE");
      } else {
        process.env.GIT_INDEX_FILE = originalGitIndexFile;
      }
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("git status inspection failed");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, unregistered, unreadable where the platform enforces chmod permissions, and identity-mismatched worktrees", async () => {
    const missing = await makeGatedStatusWorkspace("pr-review-status-missing-");
    try {
      process.chdir(missing.physicalPrimary);
      setReadStatusEnv(missing);
      await rm(missing.worktree, { recursive: true, force: true });
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
    } finally {
      process.chdir(originalCwd);
      await rm(missing.tempRoot, { recursive: true, force: true });
    }

    const unregisteredBase = await makeRegisteredWorkspace(
      "pr-review-status-unregistered-",
    );
    try {
      const separate = path.join(unregisteredBase.tempRoot, "separate");
      await mkdir(path.join(separate, ".ephemeral"), { recursive: true });
      const physicalSeparate = await realpath(separate);
      process.chdir(unregisteredBase.physicalPrimary);
      setLeaseCommandEnv(unregisteredBase.physicalPrimary, physicalSeparate);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparate,
      );
      const resultFile =
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-result.json";
      await writeResultArtifact(
        separate,
        physicalSeparate,
        resultFile,
        "1111111111111111111111111111111111111111",
        "preview-current",
      );
      await writeFile(
        path.join(unregisteredBase.primary, leaseFile),
        `${JSON.stringify(
          gatedCommandLease({
            leaseFile,
            worktreePath: physicalSeparate,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(separate, resultFile)),
          }),
          null,
          2,
        )}\n`,
      );
      process.env.LEASE_FILE = leaseFile;
      process.env.RESULT_FILE = resultFile;
      process.env.HEAD_SHA = "1111111111111111111111111111111111111111";
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("not registered");
    } finally {
      process.chdir(originalCwd);
      await rm(unregisteredBase.tempRoot, { recursive: true, force: true });
    }

    if (process.platform !== "win32") {
      const unreadable = await makeGatedStatusWorkspace(
        "pr-review-status-unreadable-",
      );
      try {
        process.chdir(unreadable.physicalPrimary);
        setReadStatusEnv(unreadable);
        await chmod(unreadable.worktree, 0);
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      } finally {
        await chmod(unreadable.worktree, 0o755).catch(() => undefined);
        process.chdir(originalCwd);
        await rm(unreadable.tempRoot, { recursive: true, force: true });
      }
    }

    const mismatch = await makeGatedStatusWorkspace(
      "pr-review-status-mismatch-",
    );
    try {
      const lease = await readLease(mismatch.primary, mismatch.leaseFile);
      await writeFile(
        path.join(mismatch.primary, mismatch.leaseFile),
        `${JSON.stringify({ ...lease, repository: "other/repo" }, null, 2)}\n`,
      );
      process.chdir(mismatch.physicalPrimary);
      setReadStatusEnv(mismatch);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("lease repository mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(mismatch.tempRoot, { recursive: true, force: true });
    }
  });

  for (const testCase of [
    {
      name: "wrong-result-file",
      env: () => {
        process.env.RESULT_FILE = ".ephemeral/pr-432-other-result.json";
      },
      stderr: "RESULT_FILE must match",
    },
    {
      name: "stale-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = "0".repeat(64);
        }),
      stderr: "digest mismatch",
    },
    {
      name: "stale-timestamp",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.validated_at =
            "2026-06-11T00:01:00Z";
        }),
      stderr: "validation is stale",
    },
    {
      name: "presentation-mismatch",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.status = "edited";
        }),
      stderr: "presentation status mismatch",
    },
    {
      name: "null-presented-at",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.presented_at = null;
        }),
      stderr: "lease schema mismatch",
    },
    {
      name: "missing-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = null;
        }),
      stderr: "digest missing",
    },
    {
      name: "wrong-review-head",
      env: () => {
        process.env.HEAD_SHA = "2222222222222222222222222222222222222222";
      },
      stderr: "result review head mismatch",
    },
  ] as const) {
    it(`rejects stale or mismatched gated result evidence: ${testCase.name}`, async () => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-status-${testCase.name}-`,
      );
      try {
        await testCase.mutate?.(workspace);
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        testCase.env?.();
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    });
  }

  it("fails closed for nested result artifact drift before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for lease base/head mismatch before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.head_ref = "other-topic";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff head ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records post-gated preview-render failure without invalid recovery artifacts", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const gated = await readLease(primary, leaseFile);
      await rm(path.join(worktree, resultFile), { force: true });

      unsetEnv("RESULT_FILE");
      unsetEnv("PRESENTED_AT");
      unsetEnv("PRESENTATION_STATUS");
      process.env.EXPECTED_STATE = "gated";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "audit summary render failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      await writeLeaseCommandState({
        state: "failed",
        updatedAt: "2026-06-11T00:03:00Z",
      });

      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records reviewed failure after nested result drift by clearing invalid recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-reviewed-failure-nested-drift-",
    );

    try {
      const reviewed = reviewedCommandLease(
        workspace.leaseFile,
        workspace.physicalWorktree,
        workspace.worktreeDigest,
        workspace.resultFile,
        workspace.resultSha256,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(reviewed, null, 2)}\n`,
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:03:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects failed-to-failed writes that replace the result pointer", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-result-replacement-",
    );

    try {
      const failed: PrReviewLease = {
        ...(await readLease(workspace.primary, workspace.leaseFile)),
        state: "failed",
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: null,
        },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failed, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.RESULT_FILE = `.ephemeral/pr-432-${workspace.reviewHead}-replacement-result.json`;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview still failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "RESULT_FILE must match existing failed result",
      );
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves valid failed recovery evidence without requiring failure timestamp freshness", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-preserve-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = approvedReviewFile;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      let failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.updated_at).toBe("2026-06-11T00:03:00Z");
      expect(failed.validation.result_manifest.validated_at).toBe(
        "2026-06-11T00:02:00Z",
      );
      expect(failed.artifacts).toMatchObject({
        result_file: workspace.resultFile,
        approved_review_file: approvedReviewFile,
      });

      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected retry";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        updated_at: "2026-06-11T00:04:00Z",
        artifacts: {
          result_file: workspace.resultFile,
          approved_review_file: approvedReviewFile,
        },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:02:00Z",
            sha256: workspace.resultSha256,
          },
        },
        presentation: {
          presented_at: "2026-06-11T00:02:00Z",
          status: "preview-current",
        },
        failure: {
          phase: "github-post",
          reason: "GitHub API rejected retry",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure when the worktree is missing", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-audit-worktree-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        {
          cwd: workspace.primary,
        },
      );

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation timestamp after strict status rejection", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.presented_at = null;
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const validateBefore = await runPrReviewLeasesCommand(["validate"]);
      expect(validateBefore.exitCode).toBe(1);
      expect(validateBefore.stderr).toContain("lease schema mismatch");

      const statusBefore = await runPrReviewLeasesCommand(["read-status"]);
      expect(statusBefore).toMatchObject({ exitCode: 1, stdout: "" });
      expect(statusBefore.stderr).toContain("lease schema mismatch");

      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });

      process.env.WORKTREE_PATH = workspace.physicalWorktree;
      const validateAfter = await runPrReviewLeasesCommand(["validate"]);
      expect(validateAfter.exitCode, validateAfter.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation status by clearing recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-status-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts for Phase 5 audit failure when worktree directory is unregistered", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-audit-worktree-",
    );

    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        {
          cwd: workspace.primary,
        },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });
      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves current recovery artifacts for registered Phase 5 audit failures", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-current-audit-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBe(workspace.resultFile);
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-nested-digest-audit-evidence-",
    );

    try {
      await writeFile(
        path.join(workspace.worktree, workspace.findingsFile),
        `${JSON.stringify({ findings: [{ stale: true }], carry_forward: [] })}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears stale recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-stale-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.validated_at = "2026-06-11T00:01:00Z";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears missing-digest recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-digest-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears presentation-mismatched recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-presentation-mismatch-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = "edited";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects audit failure recovery when the prior lease is not gated", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-audit-not-gated-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.state = "reviewed";
        lease.presentation = { presented_at: null, status: null };
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "record-audit-failure requires gated preview-render failure",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease Git cleanup safety", () => {
  it("reports missing worktrees as skipped cleanup when lease identity matches", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-missing-worktree-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(worktree, { recursive: true, force: true });

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for missing terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await rm(workspace.worktree, { recursive: true, force: true });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before archive-on-recreate writes", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-nested-drift-`,
      );

      try {
        process.chdir(workspace.physicalPrimary);
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        await mutateNestedFindingsWithoutUpdatingResult(workspace);

        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
        process.env.PR_REVIEW_DIR = workspace.prReviewDir;
        process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
          workspace.prReviewManifestHelperScript;
        process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
          workspace.prReviewLeaseHelperScript;
        process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(1);
        expect(result.stderr, state).toContain("findings digest mismatch");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const archived = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          archived.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("archives helper-recorded removed terminal leases before fresh creation", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-after-cleanup-`,
      );

      try {
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        await writeFile(
          path.join(workspace.primary, ".git", "info", "exclude"),
          ".ephemeral/\n",
        );
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(cleanup.exitCode, state).toBe(0);
        expect(cleanup.stdout, state).toContain("OUTCOME=removed");
        const removedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(removedLease.cleanup).toMatchObject({ last_outcome: "removed" });
        expect(removedLease.cleanup?.removed_at).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
        );
        const removedAt = removedLease.cleanup?.removed_at;
        const retry = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(retry.exitCode, state).toBe(0);
        expect(retry.stdout, state).toContain("OUTCOME=skipped");
        const retriedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(retriedLease.cleanup).toMatchObject({
          last_outcome: "skipped",
          removed_at: removedAt,
        });
        await execFileAsync(
          "git",
          ["worktree", "add", workspace.worktree, "review-topic"],
          { cwd: workspace.primary },
        );

        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(0);
        const fresh = await readLease(workspace.primary, workspace.leaseFile);
        expect(fresh).toMatchObject({
          state: "created",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
        });
        expect("cleanup" in fresh).toBe(false);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) =>
            entry.includes(`-${state}-archived-lease.json`),
          ),
        ).toBe(true);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("keeps legacy removed cleanup observations under strict archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-legacy-cleanup-authority-",
    );

    try {
      const lease = await readLease(workspace.primary, workspace.leaseFile);
      const legacy = {
        ...lease,
        state: "aborted" as const,
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
        },
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "-f", workspace.worktree],
        { cwd: workspace.primary },
      );
      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result file missing");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
      const entries = await readdir(path.join(workspace.primary, ".ephemeral"));
      expect(
        entries.some((entry) => entry.includes("-archived-lease.json")),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps post-removal metadata writes outside git-removal failure handling", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/runtime/pr-review-leases.ts"),
      "utf8",
    );
    const cleanupStart = source.indexOf("async function cleanupWorktree()");
    const cleanupEnd = source.indexOf(
      "\nfunction shouldRecordCleanupMetadata",
      cleanupStart,
    );
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    const removalCall = cleanupSource.indexOf(
      'await execFileAsync("git", args);',
    );
    const removalCatch = cleanupSource.indexOf("  } catch {", removalCall);
    const postRemovalSuccessPath = cleanupSource.indexOf(
      "\n\n  if (shouldRecordCleanupMetadata(decision)) {",
      removalCatch,
    );
    const removedMetadata = cleanupSource.indexOf(
      '"removed",\n      false,',
      postRemovalSuccessPath,
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(removalCall).toBeGreaterThan(-1);
    expect(removalCatch).toBeGreaterThan(removalCall);
    expect(postRemovalSuccessPath).toBeGreaterThan(removalCatch);
    expect(removedMetadata).toBeGreaterThan(postRemovalSuccessPath);
  });

  it("skips cleanup targets that are clean separate clones, not registered worktrees", async () => {
    const { tempRoot, primary, physicalPrimary } =
      await makeRegisteredWorkspace("pr-review-separate-clone-");
    const separateClone = path.join(tempRoot, "separate-clone");

    try {
      await execFileAsync("git", ["clone", primary, separateClone]);
      const physicalSeparateClone = await realpath(separateClone);
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalSeparateClone);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparateClone,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalSeparateClone,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for unregistered terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("retains cleanup targets when git status inspection fails", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-status-cleanup-failure-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(path.join(worktree, ".git"), {
        recursive: true,
        force: true,
      });

      process.env.LEASE_FILE = leaseFile;
      let result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("OUTCOME=inspect");

      result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=retained");
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup metadata rewrites when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("treats provider scope evidence referenced by valid result chains as owned", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-owned-provider-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).not.toContain("provider-scope-evidence.json");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup when ignored worktree ephemeral artifacts are unmanaged", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-cleanup-");
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease: PrReviewLease = {
        schema: "pr-review/lease/v1",
        repository: "owner/repo",
        pr_number: 432,
        state: "aborted",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: physicalWorktree,
        worktree_digest: dynamicIdentity.worktreeDigest,
        lease_file: leaseFile,
        created_at: "2026-06-11T00:00:00Z",
        updated_at: "2026-06-11T00:01:00Z",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        terminal: {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "user-aborted",
        },
        failure: { phase: null, reason: null, recoverability: null },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      };
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).toContain(
        "MESSAGE=unmanaged .ephemeral artifacts: .ephemeral/unmanaged.txt",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats malformed result metadata as invalid before cleanup ownership", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-owned-");
    const resultFile = ".ephemeral/pr-432-result.json";
    const findingsFile = ".ephemeral/topic-findings.json";
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");
    await writeFile(path.join(worktree, findingsFile), "{}\n");
    await writeFile(
      path.join(worktree, resultFile),
      `${JSON.stringify({
        repository: "owner/repo",
        pr_number: 432,
        review_head_sha: "1111111111111111111111111111111111111111",
        findings_file: findingsFile,
        review_body_file: null,
        context_file: null,
        artifacts: {
          handoff_file: ".ephemeral/pr-432-handoff.json",
          scope_decision_file: ".ephemeral/pr-432-scope-decision.json",
          prior_threads_file: null,
          rendered_preview_file: null,
          extra: ".ephemeral/unmanaged.txt",
        },
      })}\n`,
    );

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function setLeaseCommandEnv(primary: string, worktree: string): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = primary;
  process.env.WORKTREE_PATH = worktree;
  unsetEnv("LEASE_FILE");
  unsetEnv("RESULT_FILE");
  unsetEnv("HEAD_SHA");
}

function unsetEnv(key: (typeof managedEnvKeys)[number]): void {
  delete process.env[key];
}

async function writeLeaseCommandState({
  state,
  updatedAt,
}: {
  state: PrReviewLease["state"];
  updatedAt: string;
}): Promise<void> {
  process.env.STATE = state;
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  const result = await runPrReviewLeasesCommand(["write"]);
  expect(result.exitCode, result.stderr).toBe(0);
}

async function readLease(
  primary: string,
  leaseFile: string,
): Promise<PrReviewLease> {
  return JSON.parse(await readFile(path.join(primary, leaseFile), "utf8"));
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

type GatedStatusWorkspace = Awaited<
  ReturnType<typeof makeRegisteredWorkspace>
> & {
  leaseFile: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  reviewHead: string;
  findingsFile: string;
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
};

async function makeGatedStatusWorkspace(
  prefix: string,
): Promise<GatedStatusWorkspace> {
  const workspace = await makeRegisteredWorkspace(prefix);
  const { stdout: reviewHeadOutput } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  const reviewHead = reviewHeadOutput.trim();
  const helpers = await writeReviewHelperScripts(workspace.tempRoot);
  const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
  const { findingsFile } = await writeResultArtifact(
    workspace.worktree,
    workspace.physicalWorktree,
    resultFile,
    reviewHead,
    "preview-current",
    true,
  );
  const resultSha256 = await sha256File(
    path.join(workspace.worktree, resultFile),
  );
  process.chdir(workspace.physicalPrimary);
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
  expect(pathResult.exitCode).toBe(0);
  const leaseFile = pathResult.stdout.trim();
  const dynamicIdentity = identityFromLeaseFile(
    leaseFile,
    workspace.physicalWorktree,
  );
  await writeFile(
    path.join(workspace.primary, leaseFile),
    `${JSON.stringify(
      gatedCommandLease({
        leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: dynamicIdentity.worktreeDigest,
        resultFile,
        resultSha256,
      }),
      null,
      2,
    )}\n`,
  );
  return {
    ...workspace,
    leaseFile,
    worktreeDigest: dynamicIdentity.worktreeDigest,
    resultFile,
    resultSha256,
    reviewHead,
    findingsFile,
    ...helpers,
  };
}

function setReadStatusEnv(workspace: GatedStatusWorkspace): void {
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  setHelperAuthorityEnv({
    prReviewDir: workspace.prReviewDir,
    prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
    prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
    playReviewHelper: workspace.playReviewHelper,
  });
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.HEAD_SHA = workspace.reviewHead;
}

function setAuditFailureEnv(
  workspace: GatedStatusWorkspace,
  updatedAt: string,
): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalPrimary;
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.STATE = "failed";
  process.env.EXPECTED_STATE = "gated";
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.FINISHED_AT = updatedAt;
  process.env.FAILURE_PHASE = "preview-render";
  process.env.FAILURE_REASON = "audit summary render failed";
  process.env.FAILURE_RECOVERABILITY = "recoverable";
  process.env.PR_REVIEW_DIR = workspace.prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
    workspace.prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
    workspace.prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;
}

function setHelperAuthorityEnv({
  prReviewDir,
  prReviewManifestHelperScript,
  prReviewLeaseHelperScript,
  playReviewHelper,
}: {
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}): void {
  process.env.PR_REVIEW_DIR = prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = playReviewHelper;
}

async function mutateLease(
  workspace: GatedStatusWorkspace,
  mutate: (lease: PrReviewLease) => void,
): Promise<void> {
  const lease = await readLease(workspace.primary, workspace.leaseFile);
  mutate(lease);
  await writeFile(
    path.join(workspace.primary, workspace.leaseFile),
    `${JSON.stringify(lease, null, 2)}\n`,
  );
}

async function mutateNestedFindingsWithoutUpdatingResult(
  workspace: GatedStatusWorkspace,
): Promise<void> {
  await writeFile(
    path.join(workspace.worktree, workspace.findingsFile),
    `${JSON.stringify(
      {
        schema: "play-review/findings/v2",
        findings: [{ stale: true }],
        carry_forward: [],
      },
      null,
      2,
    )}\n`,
  );
}

async function makeLeaseWorkspace(prefix: string): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const primary = path.join(tempRoot, "primary");
  const worktree = path.join(tempRoot, "worktree");
  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  return {
    tempRoot,
    primary,
    worktree,
    physicalPrimary: await realpath(primary),
    physicalWorktree: await realpath(worktree),
  };
}

async function makeResultAuthorityWorkspace(prefix: string): Promise<
  Awaited<ReturnType<typeof makeRegisteredWorkspace>> & {
    reviewHead: string;
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  }
> {
  const workspace = await makeRegisteredWorkspace(prefix);
  const { stdout } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  return {
    ...workspace,
    reviewHead: stdout.trim(),
    ...(await writeReviewHelperScripts(workspace.tempRoot)),
  };
}

async function makeRegisteredWorkspace(prefix: string): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const primary = path.join(tempRoot, "primary");
  const worktree = path.join(tempRoot, "worktree");
  await mkdir(primary, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: primary,
  });
  await writeFile(path.join(primary, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: primary });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
    cwd: primary,
  });
  await execFileAsync(
    "git",
    ["worktree", "add", "-b", "review-topic", worktree],
    { cwd: primary },
  );
  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  return {
    tempRoot,
    primary,
    worktree,
    physicalPrimary: await realpath(primary),
    physicalWorktree: await realpath(worktree),
  };
}

function identityFromLeaseFile(
  leaseFile: string,
  worktreePath: string,
): typeof identity {
  const match = /^\.ephemeral\/pr-432-([0-9a-f]{64})-lease\.json$/u.exec(
    leaseFile,
  );
  if (match === null) {
    throw new Error(`unexpected lease path: ${leaseFile}`);
  }
  return {
    ...identity,
    worktreePath,
    worktreeDigest: match[1],
    leaseFile,
  };
}

function abortedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "aborted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: null,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: { status: null, validated_at: null, sha256: null },
    },
    presentation: { presented_at: null, status: null },
    terminal: {
      finished_at: "2026-06-11T00:01:00Z",
      reason: "user-aborted",
    },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

const discoveryTempRoots: string[] = [];

beforeAll(async () => {
  if (process.platform !== "win32") return;
  discoveryGitWindowsBash = await resolveGitForWindowsBash();
  discoveryGitWindowsLauncherRoot = await mkdtemp(
    path.join(tmpdir(), "discovery-git-launcher-"),
  );
  discoveryGitWindowsLauncher = path.join(
    discoveryGitWindowsLauncherRoot,
    "git.exe",
  );
  const windowsPowerShell = await resolveInboxWindowsPowerShell();
  await execFileAsync(
    windowsPowerShell,
    [...discoveryGitWindowsPowerShellArguments],
    {
      env: {
        ...process.env,
        DEVCANON_TEST_LAUNCHER_OUTPUT: discoveryGitWindowsLauncher,
        DEVCANON_TEST_LAUNCHER_SOURCE: discoveryGitWindowsLauncherSource,
      },
    },
  );
  expect((await lstat(discoveryGitWindowsLauncher)).isFile()).toBe(true);
});

afterAll(async () => {
  if (discoveryGitWindowsLauncherRoot !== undefined) {
    await rm(discoveryGitWindowsLauncherRoot, {
      recursive: true,
      force: true,
    });
  }
});

async function makeDiscoveryGitWrapperExecutable(
  wrapper: string,
): Promise<void> {
  const implementation = `${wrapper}.impl`;
  await rename(wrapper, implementation);
  await chmod(implementation, 0o755);
  activeDiscoveryGitAdapterLog = path.join(
    path.dirname(wrapper),
    discoveryGitAdapterLogName,
  );
  if (process.platform === "win32") {
    if (
      discoveryGitWindowsLauncher === undefined ||
      discoveryGitWindowsBash === undefined
    ) {
      throw new Error("native discovery Git launcher is unavailable");
    }
    await copyFile(discoveryGitWindowsLauncher, `${wrapper}.exe`);
    await writeFile(
      path.join(path.dirname(wrapper), "git-bash.path"),
      discoveryGitWindowsBash,
    );
    return;
  }
  await writeFile(
    wrapper,
    [
      "#!/bin/sh",
      `log='${activeDiscoveryGitAdapterLog}'`,
      "{",
      "  printf 'ENTRY\\0'",
      "  for key in GIT_NO_LAZY_FETCH GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_ATTR_NOSYSTEM GIT_OPTIONAL_LOCKS GIT_TERMINAL_PROMPT LC_ALL LANG; do",
      '    eval "value=\\${$key-}"',
      '    printf \'ENV\\0%s\\0%s\\0\' "$key" "$value"',
      "  done",
      "  printf 'HOST\\0\\0'",
      "  printf 'ARGS\\0'",
      "  for argument do printf '%s\\0' \"$argument\"; done",
      "  printf 'END\\0'",
      `} >>"$log"`,
      `exec '${implementation}' "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(wrapper, 0o755);
}

function prependDiscoveryGitWrapper(
  wrapperDir: string,
  previousPath: string | undefined,
): string {
  return `${wrapperDir}${path.delimiter}${previousPath ?? ""}`;
}

interface DiscoveryGitAdapterEntry {
  args: string[];
  childExit: number;
  childStderr: string;
  environment: Record<string, string>;
  host: string;
}

async function readDiscoveryGitAdapterEntries(): Promise<
  DiscoveryGitAdapterEntry[]
> {
  if (activeDiscoveryGitAdapterLog === undefined) {
    throw new Error("discovery Git adapter log is not bound");
  }
  const fields = (await readFile(activeDiscoveryGitAdapterLog))
    .toString("utf8")
    .split("\0");
  if (fields.pop() !== "") {
    throw new Error("discovery Git adapter log is not NUL terminated");
  }
  const entries: DiscoveryGitAdapterEntry[] = [];
  let offset = 0;
  while (offset < fields.length) {
    if (fields[offset++] !== "ENTRY") {
      throw new Error("discovery Git adapter log entry is malformed");
    }
    const environment: Record<string, string> = {};
    while (fields[offset] === "ENV") {
      offset += 1;
      const key = fields[offset++];
      const value = fields[offset++];
      if (key === undefined || value === undefined) {
        throw new Error("discovery Git adapter environment is truncated");
      }
      environment[key] = value;
    }
    if (fields[offset++] !== "HOST") {
      throw new Error("discovery Git adapter host is missing");
    }
    const host = fields[offset++];
    if (host === undefined) {
      throw new Error("discovery Git adapter host is truncated");
    }
    if (fields[offset++] !== "ARGS") {
      throw new Error("discovery Git adapter arguments are missing");
    }
    const args: string[] = [];
    while (fields[offset] !== "CHILD_EXIT" && fields[offset] !== "END") {
      const argument = fields[offset++];
      if (argument === undefined) {
        throw new Error("discovery Git adapter arguments are truncated");
      }
      args.push(argument);
    }
    let childExit = 0;
    let childStderr = "";
    if (fields[offset] === "CHILD_EXIT") {
      offset += 1;
      const childExitText = fields[offset++];
      if (childExitText === undefined || !/^\d+$/u.test(childExitText)) {
        throw new Error("discovery Git adapter child exit is malformed");
      }
      childExit = Number(childExitText);
      if (fields[offset++] !== "CHILD_STDERR") {
        throw new Error("discovery Git adapter child stderr is missing");
      }
      const capturedStderr = fields[offset++];
      if (capturedStderr === undefined) {
        throw new Error(
          "discovery Git adapter child diagnostics are truncated",
        );
      }
      childStderr = capturedStderr;
    }
    if (fields[offset++] !== "END") {
      throw new Error("discovery Git adapter entry is unterminated");
    }
    entries.push({
      args,
      childExit,
      childStderr,
      environment,
      host,
    });
  }
  return entries;
}

async function discoveryGitAdapterEntryCount(): Promise<number> {
  if (activeDiscoveryGitAdapterLog === undefined) return 0;
  try {
    return (await readDiscoveryGitAdapterEntries()).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function expectDiscoveryGitAdapterEntry(
  root: string,
  expectedArguments: readonly string[],
  expectedChildExit = 0,
): Promise<DiscoveryGitAdapterEntry> {
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const completeExpectedArguments = [
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${nullDevice}`,
    "-c",
    `core.attributesFile=${nullDevice}`,
    "-c",
    `core.excludesFile=${nullDevice}`,
    "-c",
    "maintenance.auto=false",
    "-c",
    "gc.auto=0",
    "-C",
    root,
    ...expectedArguments,
  ];
  const entries = await readDiscoveryGitAdapterEntries();
  const entry = entries.find(
    ({ args }) =>
      args.length === completeExpectedArguments.length &&
      args.every(
        (argument, index) => argument === completeExpectedArguments[index],
      ),
  );
  expect(
    entry,
    `adapter entry matching ${completeExpectedArguments.join(" ")}`,
  ).toBeDefined();
  expect(entry?.args).toEqual(completeExpectedArguments);
  expect(entry?.environment).toEqual({
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  });
  expect(entry?.childExit).toBe(expectedChildExit);
  expect(entry?.childStderr).toBe("");
  if (process.platform === "win32") {
    expect(entry?.host).toBe(discoveryGitWindowsBash);
  } else {
    expect(entry?.host).toBe("");
  }
  return entry as DiscoveryGitAdapterEntry;
}

afterEach(async () => {
  await Promise.all(
    discoveryTempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
  Reflect.deleteProperty(process.env, "Git_Dir");
  Reflect.deleteProperty(process.env, "git_dir");
  Reflect.deleteProperty(process.env, "Git_Trace2_Event");
  activeDiscoveryGitAdapterLog = undefined;
});

async function createDiscoveryRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pr-review-discovery-"));
  discoveryTempRoots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Test"]);
  await execFileAsync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await execFileAsync("git", ["-C", root, "config", "core.autocrlf", "false"]);
  await execFileAsync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "https://github.com/owner/repo.git",
  ]);
  await writeFile(path.join(root, "README.md"), "fixture\n");
  await execFileAsync("git", ["-C", root, "add", "README.md"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  await mkdir(path.join(root, ".ephemeral"));
  return realpath(root);
}

async function createDiscoveryWorktree(
  root: string,
  leaf: string,
): Promise<string> {
  const worktree = path.join(root, ".worktrees", leaf);
  await mkdir(path.dirname(worktree), { recursive: true });
  await execFileAsync("git", [
    "-C",
    root,
    "worktree",
    "add",
    "-b",
    `test-${leaf}`,
    worktree,
  ]);
  return realpath(worktree);
}

async function addDiscoveryGitlink(
  worktree: string,
  sourceRepository: string,
  gitlinkPath: string,
): Promise<void> {
  const oid = (
    await execFileAsync("git", ["-C", sourceRepository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", worktree, "update-index", "-z", "--index-info"],
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
    if (child.stdin === null) {
      child.kill();
      reject(new Error("git update-index stdin is unavailable"));
      return;
    }
    child.stdin.end(`160000 ${oid}\t${gitlinkPath}\0`);
  });
}

function discoveryDigest(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  const comparable = /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
  return createHash("sha256").update(comparable).digest("hex");
}

function discoveryLease(worktreePath: string, prNumber = 432): PrReviewLease {
  const worktreeDigest = discoveryDigest(worktreePath);
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: prNumber,
    state: "created",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: `.ephemeral/pr-${prNumber}-${worktreeDigest}-lease.json`,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:00:00Z",
    artifacts: {
      handoff_file: null,
      result_file: null,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: null,
        validated_at: null,
        sha256: null,
      },
    },
    presentation: { presented_at: null, status: null },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

async function writeDiscoveryLease(
  root: string,
  lease: PrReviewLease,
): Promise<void> {
  await writeFile(
    path.join(root, lease.lease_file),
    `${JSON.stringify(lease, null, 2)}\n`,
  );
}

async function runDiscoveryCommand(root: string, prNumber = 432) {
  const before = process.cwd();
  const adapterEntryCountBefore = await discoveryGitAdapterEntryCount();
  process.chdir(root);
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = String(prNumber);
  process.env.PRIMARY_REPOSITORY_ROOT = root;
  try {
    const outcome = await runPrReviewLeasesCommand(["discover"]);
    if (activeDiscoveryGitAdapterLog !== undefined) {
      expect(await discoveryGitAdapterEntryCount()).toBeGreaterThan(
        adapterEntryCountBefore,
      );
    }
    return outcome;
  } finally {
    process.chdir(before);
  }
}

async function runDiscovery(root: string, prNumber = 432) {
  const outcome = await runDiscoveryCommand(root, prNumber);
  expect(outcome.exitCode).toBe(0);
  return JSON.parse(outcome.stdout) as {
    disposition: string;
    canonical_target: {
      worktree_path: string;
      status: string;
      registered: boolean;
      parent_status: string;
    };
    resume: { lease_file: string; worktree_path: string } | null;
    cleanup: {
      lease_file: string | null;
      worktree_path: string;
      reason: string;
    } | null;
    active: Array<{
      lease_file: string;
      classification: string;
      reason: string;
    }>;
    archived: string[];
    invalid: Array<{ path: string; reason: string }>;
    registrations: string[];
  };
}

describe("read-only PR review discovery planner", () => {
  it("constructs the exact inbox Windows PowerShell launcher build command", () => {
    expect(discoveryGitWindowsPowerShellArguments).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition $env:DEVCANON_TEST_LAUNCHER_SOURCE -Language CSharp -OutputType ConsoleApplication -OutputAssembly $env:DEVCANON_TEST_LAUNCHER_OUTPUT",
    ]);
    expect(discoveryGitWindowsLauncherSource).toContain(
      'start.EnvironmentVariables["DEVCANON_TEST_NATIVE_PATH"] = implementation;',
    );
    expect(discoveryGitWindowsLauncherSource).toContain(
      "start.Arguments = commandLine.ToString();",
    );
    expect(discoveryGitWindowsLauncherSource).not.toContain(
      "start.Environment[",
    );
    expect(discoveryGitWindowsLauncherSource).not.toContain("ArgumentList");
  });

  it.runIf(process.platform === "win32")(
    "round-trips adversarial native launcher arguments and environment exactly",
    async () => {
      if (discoveryGitWindowsLauncher === undefined) {
        throw new Error("native discovery Git launcher is unavailable");
      }
      if (discoveryGitWindowsBash === undefined) {
        throw new Error("Git-for-Windows Bash is unavailable");
      }
      const fixtureRoot = await mkdtemp(
        path.join(tmpdir(), "discovery-git-launcher-roundtrip-"),
      );
      discoveryTempRoots.push(fixtureRoot);
      const launcher = path.join(fixtureRoot, "git.exe");
      const implementation = path.join(fixtureRoot, "git.impl");
      const recording = `${implementation}.argv`;
      await copyFile(discoveryGitWindowsLauncher, launcher);
      await writeFile(
        path.join(fixtureRoot, "git-bash.path"),
        discoveryGitWindowsBash,
      );
      await writeFile(
        implementation,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          `recording='${await toGitBashPath(recording)}'`,
          "{",
          "  printf 'ENV\\0%s\\0ARGS\\0' \"$DEVCANON_TEST_NATIVE_PATH\"",
          "  for argument do printf '%s\\0' \"$argument\"; done",
          "  printf 'END\\0'",
          '} >"$recording"',
          "",
        ].join("\n"),
      );
      await chmod(implementation, 0o755);
      const argumentsToRoundTrip = [
        "",
        "space value",
        "tab\tvalue",
        'embedded"quote',
        `backslashes-before-${"\\".repeat(3)}"quote`,
        "space trailing-" + "\\",
        `space trailing-many-${"\\".repeat(3)}`,
        "--no-optional-locks",
        "-c",
        "core.excludesFile=NUL",
        "-C",
        "C:\\repository path",
        "status",
        "--porcelain=v1",
      ];

      await execFileAsync(launcher, argumentsToRoundTrip);

      const fields = (await readFile(recording, "utf8")).split("\0");
      expect(fields).toEqual([
        "ENV",
        implementation,
        "ARGS",
        ...argumentsToRoundTrip,
        "END",
        "",
      ]);
    },
  );

  it("accepts discover with no positional arguments", async () => {
    const root = await createDiscoveryRepository();
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("create");
    expect(result.resume).toBeNull();
  });

  it.each(["include.path", "includeIf.gitdir:/**.path"])(
    "rejects primary %s authority before a no-active create result",
    async (configKey) => {
      const root = await createDiscoveryRepository();
      const marker = path.join(root, "primary-include-executed");
      const included = path.join(root, "primary-included.gitconfig");
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", ["-C", root, "config", configKey, included]);

      const outcome = await runDiscoveryCommand(root);
      expect(outcome).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "primary repository config contains include authority\n",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "rejects primary includeIf authority containing %j before a no-active create result",
    async (separator) => {
      const root = await createDiscoveryRepository();
      const marker = path.join(root, "primary-separator-include-executed");
      const included = path.join(root, "primary-separator-included.gitconfig");
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        `includeIf.gitdir:**[!${separator}]**.path`,
        included,
      ]);

      const outcome = await runDiscoveryCommand(root);
      expect(outcome).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "primary repository config contains include authority\n",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(["include.path", "includeIf.gitdir:/**.path"])(
    "rejects primary worktree-config %s authority before a no-active create result",
    async (configKey) => {
      const root = await createDiscoveryRepository();
      const marker = path.join(root, "primary-worktree-include-executed");
      const included = path.join(root, "primary-worktree-included.gitconfig");
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "extensions.worktreeConfig",
        "true",
      ]);
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "--worktree",
        configKey,
        included,
      ]);

      const outcome = await runDiscoveryCommand(root);
      expect(outcome).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "primary repository config contains include authority\n",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "rejects primary worktree-config includeIf authority containing %j",
    async (separator) => {
      const root = await createDiscoveryRepository();
      const marker = path.join(
        root,
        "primary-worktree-separator-include-executed",
      );
      const included = path.join(
        root,
        "primary-worktree-separator-included.gitconfig",
      );
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "extensions.worktreeConfig",
        "true",
      ]);
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "--worktree",
        `includeIf.gitdir:**[!${separator}]**.path`,
        included,
      ]);

      const outcome = await runDiscoveryCommand(root);
      expect(outcome).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "primary repository config contains include authority\n",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("accepts stable include-free primary worktree config for create and resume", async () => {
    const root = await createDiscoveryRepository();
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "extensions.worktreeConfig",
      "true",
    ]);
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "--worktree",
      "core.filemode",
      "false",
    ]);
    expect((await runDiscovery(root)).disposition).toBe("create");

    const worktree = await createDiscoveryWorktree(
      root,
      "worktree-config-resume",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("resume");
    expect(result.resume?.worktree_path).toBe(worktree);
  });

  it.each(["appearance", "disappearance", "bytes"] as const)(
    "fails closed when primary config.worktree changes between complete collections: %s",
    async (fixture) => {
      const root = await createDiscoveryRepository();
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "extensions.worktreeConfig",
        "true",
      ]);
      const configWorktree = path.join(root, ".git", "config.worktree");
      if (fixture !== "appearance") {
        await execFileAsync("git", [
          "-C",
          root,
          "config",
          "--worktree",
          "core.filemode",
          "true",
        ]);
      }
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const marker = path.join(wrapperDir, "config-worktree-mutated");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      const mutation =
        fixture === "appearance"
          ? `'${realGit}' -C '${await toGitBashPath(root)}' config --worktree core.filemode false`
          : fixture === "disappearance"
            ? `rm -f '${await toGitBashPath(configWorktree)}'`
            : `'${realGit}' -C '${await toGitBashPath(root)}' config --worktree core.filemode false`;
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    '${realGit}' "$@"`,
          "    status=$?",
          `    if [ ! -f '${await toGitBashPath(marker)}' ]; then`,
          `      ${mutation}`,
          `      printf fired >'${await toGitBashPath(marker)}'`,
          "    fi",
          '    exit "$status"',
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(await readFile(marker, "utf8")).toBe("fired");
        expect(result.disposition).toBe("invalid");
        expect(result.invalid).toContainEqual({
          path: ".",
          reason: "discovery-snapshot-changed",
        });
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("fails closed when primary include authority appears between complete collections", async () => {
    const root = await createDiscoveryRepository();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const count = path.join(wrapperDir, "primary-config-count");
    const fired = path.join(wrapperDir, "primary-include-fired");
    const included = path.join(root, "late-primary-included.gitconfig");
    await writeFile(included, "[core]\n\tfilemode = false\n");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" config --null --name-only --list --no-includes --file "*)',
        `    '${realGit}' "$@"`,
        "    status=$?",
        `    current=$(cat '${await toGitBashPath(count)}' 2>/dev/null || printf 0)`,
        "    current=$((current + 1))",
        `    printf '%s' "$current" >'${await toGitBashPath(count)}'`,
        '    if [ "$current" -eq 2 ]; then',
        `      '${realGit}' -C '${await toGitBashPath(root)}' config include.path '${await toGitBashPath(included)}'`,
        `      printf fired >'${await toGitBashPath(fired)}'`,
        "    fi",
        '    exit "$status"',
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(await readFile(fired, "utf8")).toBe("fired");
      expect(result.disposition).toBe("invalid");
      expect(result.invalid).toContainEqual({
        path: ".",
        reason: "discovery-snapshot-changed",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([["unexpected"], ["unexpected", "second"]])(
    "rejects unexpected discover positional arguments before reading discovery identity: %j",
    async (...unexpectedArguments) => {
      const previousRepository = process.env.REPOSITORY;
      const previousPrNumber = process.env.PR_NUMBER;
      const previousPrimaryRoot = process.env.PRIMARY_REPOSITORY_ROOT;
      Reflect.deleteProperty(process.env, "REPOSITORY");
      Reflect.deleteProperty(process.env, "PR_NUMBER");
      Reflect.deleteProperty(process.env, "PRIMARY_REPOSITORY_ROOT");
      try {
        await expect(
          runPrReviewLeasesCommand(["discover", ...unexpectedArguments]),
        ).resolves.toEqual({
          exitCode: 1,
          stdout: "",
          stderr: "discover does not accept positional arguments\n",
        });
      } finally {
        if (previousRepository === undefined) {
          Reflect.deleteProperty(process.env, "REPOSITORY");
        } else {
          process.env.REPOSITORY = previousRepository;
        }
        if (previousPrNumber === undefined) {
          Reflect.deleteProperty(process.env, "PR_NUMBER");
        } else {
          process.env.PR_NUMBER = previousPrNumber;
        }
        if (previousPrimaryRoot === undefined) {
          Reflect.deleteProperty(process.env, "PRIMARY_REPOSITORY_ROOT");
        } else {
          process.env.PRIMARY_REPOSITORY_ROOT = previousPrimaryRoot;
        }
      }
    },
  );

  it.each(["pr-432-review", "alternate-432"])(
    "resumes one canonical or alternate clean artifact-free created lease: %s",
    async (leaf) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(root, leaf);
      const lease = discoveryLease(worktree);
      await writeDiscoveryLease(root, lease);
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.resume).toEqual({
        lease_file: lease.lease_file,
        worktree_path: worktree,
      });
    },
  );

  it("linearizes an unobserved post-collection change after discovery and requires owner revalidation", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "linearized-after");
    const lease = discoveryLease(worktree);
    await writeDiscoveryLease(root, lease);

    const observed = await runDiscovery(root);
    expect(observed.disposition).toBe("resume");

    await writeFile(
      path.join(worktree, "changed-after-observation.txt"),
      "x\n",
    );
    expect(observed.resume).toEqual({
      lease_file: lease.lease_file,
      worktree_path: worktree,
    });
    const revalidated = await runDiscovery(root);
    expect(revalidated.disposition).toBe("cleanup-required");
    expect(revalidated.active[0]).toMatchObject({
      classification: "dirty",
      reason: "worktree-dirty",
    });
  });

  describe("revalidates the exact resume tuple immediately before mutation ownership", () => {
    let root: string;
    let worktree: string;
    let lease: PrReviewLease;
    let args: string[];

    beforeEach(async () => {
      root = await createDiscoveryRepository();
      worktree = await createDiscoveryWorktree(root, "resume-acceptance");
      lease = discoveryLease(worktree);
      await writeDiscoveryLease(root, lease);
      args = [
        "validate-discovery",
        "--resume-acceptance",
        "--repository",
        "owner/repo",
        "--pr-number",
        "432",
        "--primary-root",
        root,
        "--lease-file",
        lease.lease_file,
        "--worktree-path",
        worktree,
      ];
    });

    it("accepts a stable exact tuple", async () => {
      await expect(runPrReviewLeasesCommand(args)).resolves.toEqual({
        exitCode: 0,
        stdout: `${JSON.stringify({
          schema: "pr-review/resume-acceptance/v1",
          repository: "owner/repo",
          pr_number: 432,
          primary_repository_root: root,
          lease_file: lease.lease_file,
          worktree_path: worktree,
        })}\n`,
        stderr: "",
      });
    });

    it("rejects normalized duplicate registrations before accepting a resume tuple", async () => {
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      const marker = path.join(wrapperDir, "duplicate-fired");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          `'${realGit}' "$@" || exit $?`,
          'case " $* " in',
          '  *"worktree list --porcelain -z"*)',
          `    printf fired >'${marker}'`,
          `    printf 'worktree %s\\0\\0' '${worktree}/.'`,
          "    ;;",
          "esac",
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const outcome = await runPrReviewLeasesCommand(args);
        await expectDiscoveryGitAdapterEntry(root, [
          "worktree",
          "list",
          "--porcelain",
          "-z",
        ]);
        expect(await readFile(marker, "utf8")).toBe("fired");
        expect(outcome).toMatchObject({
          exitCode: 1,
          stdout: "",
          stderr: expect.stringContaining(
            "discovery registration correlation mismatch",
          ),
        });
      } finally {
        process.env.PATH = oldPath;
      }
    });

    it.each([
      ["win32", "/C/Repo/.worktrees/pr-432-review"],
      ["linux", "/repo/.worktrees/./pr-432-review"],
      ["linux", ".worktrees/pr-432-review"],
    ] as const)(
      "rejects or correlates canonical registration aliases on %s: %s",
      (platform, registration) => {
        const primaryRoot = platform === "win32" ? "C:/Repo" : "/repo";
        const result = reducePrReviewDiscovery({
          repository: "owner/repo",
          pr_number: 432,
          primary_repository_root: primaryRoot,
          canonical_target: {
            worktree_path: `${primaryRoot}/.worktrees/pr-432-review`,
            status: "absent",
            registered: false,
            parent_status: "directory",
          },
          registrations: [registration],
          active: [],
          archived: [],
          invalid: [],
          comparison_platform: platform,
        });
        expect(() =>
          validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
            repository: "owner/repo",
            prNumber: 432,
            primaryRoot,
            platform,
          }),
        ).toThrow();
      },
    );

    it("rejects late dirt", async () => {
      await writeFile(path.join(worktree, "late-dirt.txt"), "changed\n");
      await expect(runPrReviewLeasesCommand(args)).resolves.toMatchObject({
        exitCode: 1,
        stdout: "",
      });
    });

    it("rejects artifact appearance", async () => {
      await writeDiscoveryLease(root, {
        ...lease,
        artifacts: {
          ...lease.artifacts,
          handoff_file: ".ephemeral/review-handoff.json",
        },
      });
      await expect(runPrReviewLeasesCommand(args)).resolves.toMatchObject({
        exitCode: 1,
        stdout: "",
      });
    });

    it("rejects lease-state progression", async () => {
      await writeDiscoveryLease(root, { ...lease, state: "reviewed" });
      await expect(runPrReviewLeasesCommand(args)).resolves.toMatchObject({
        exitCode: 1,
        stdout: "",
      });
    });

    it("rejects a wrong tuple", async () => {
      await expect(
        runPrReviewLeasesCommand([
          ...args.slice(0, -1),
          path.join(root, "other"),
        ]),
      ).resolves.toMatchObject({ exitCode: 1, stdout: "" });
    });

    it("rejects a removed worktree", async () => {
      await execFileAsync("git", [
        "-C",
        root,
        "worktree",
        "remove",
        "--force",
        worktree,
      ]);
      await expect(runPrReviewLeasesCommand(args)).resolves.toMatchObject({
        exitCode: 1,
        stdout: "",
      });
    });
  });

  it("rejects a self-consistent lease filename and digest that do not bind the physical worktree", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "forged-digest");
    const lease = discoveryLease(worktree);
    lease.worktree_digest = "a".repeat(64);
    lease.lease_file = `.ephemeral/pr-432-${lease.worktree_digest}-lease.json`;
    await writeDiscoveryLease(root, lease);

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "worktree-digest-mismatch",
    });
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: root,
        platform: process.platform,
      }),
    ).not.toThrow();
  });

  it("gives ambiguity precedence across clean and operationally blocked claims", async () => {
    const root = await createDiscoveryRepository();
    const clean = await createDiscoveryWorktree(root, "alternate-clean");
    const dirty = await createDiscoveryWorktree(root, "alternate-dirty");
    await writeDiscoveryLease(root, discoveryLease(clean));
    await writeDiscoveryLease(root, discoveryLease(dirty));
    await writeFile(path.join(dirty, "untracked.txt"), "dirty\n");
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("ambiguous");
    expect(result.active.map((entry) => entry.classification).sort()).toEqual([
      "dirty",
      "resumable",
    ]);
  });

  it("requires registrations for every active claim before validating ambiguity", () => {
    const worktrees = ["/repo/.worktrees/one", "/repo/.worktrees/two"];
    const active = worktrees.map((worktreePath) => ({
      lease_file: `.ephemeral/pr-432-${discoveryDigest(worktreePath)}-lease.json`,
      worktree_path: worktreePath,
      state: "created" as const,
      classification: "resumable" as const,
      reason: "resumable",
    }));
    const result = reducePrReviewDiscovery({
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: "/repo",
      canonical_target: {
        worktree_path: "/repo/.worktrees/pr-432-review",
        status: "absent",
        registered: false,
        parent_status: "directory",
      },
      registrations: [],
      active,
      archived: [],
      invalid: [],
      comparison_platform: "linux",
    });

    expect(result.disposition).toBe("ambiguous");
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: "/repo",
        platform: "linux",
      }),
    ).toThrow("discovery active registration correlation mismatch");

    expect(() =>
      validatePrReviewDiscoveryJson(
        Buffer.from(JSON.stringify({ ...result, registrations: worktrees })),
        {
          repository: "owner/repo",
          prNumber: 432,
          primaryRoot: "/repo",
          platform: "linux",
        },
      ),
    ).not.toThrow();
  });

  it.each([
    "./repo",
    "../repo",
    "-owner/repo",
    "owner/-repo",
    "owner/repo$",
    null,
    123,
    ["owner", "repo"],
    { owner: "owner", repo: "repo" },
  ])(
    "rejects unsafe repository identity %s at the exported discovery validator boundary",
    (repository) => {
      const result = reducePrReviewDiscovery({
        repository: repository as string,
        pr_number: 432,
        primary_repository_root: "/repo",
        canonical_target: {
          worktree_path: "/repo/.worktrees/pr-432-review",
          status: "absent",
          registered: false,
          parent_status: "directory",
        },
        registrations: [],
        active: [],
        archived: [],
        invalid: [],
        comparison_platform: "linux",
      });

      expect(() =>
        validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
          repository: repository as string,
          prNumber: 432,
          primaryRoot: "/repo",
          platform: "linux",
        }),
      ).toThrow("discovery result schema mismatch");
    },
  );

  describe.each(["artifact", "terminal", "unsupported"] as const)(
    "%s lease discovery",
    (kind) => {
      let root: string;
      let lease: PrReviewLease;

      beforeEach(async () => {
        root = await createDiscoveryRepository();
        const worktree = await createDiscoveryWorktree(root, `case-${kind}`);
        lease = discoveryLease(worktree);
        if (kind === "artifact") {
          lease.artifacts.handoff_file = ".ephemeral/missing-handoff.json";
        } else if (kind === "terminal") {
          lease.state = "aborted";
          lease.terminal = {
            finished_at: "2026-06-11T00:01:00Z",
            reason: "operator-aborted",
          };
        } else {
          lease.state = "failed";
          lease.terminal.finished_at = "2026-06-11T00:01:00Z";
          lease.failure = {
            phase: "review",
            reason: "review failed",
            recoverability: "recoverable",
          };
        }
        await writeDiscoveryLease(root, lease);
      });

      it("stops without reading artifacts", async () => {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("cleanup-required");
        expect(result.cleanup?.lease_file).toBe(lease.lease_file);
        expect(result.active[0].classification).toBe(
          kind === "artifact"
            ? "artifact-bearing"
            : kind === "terminal"
              ? "terminal"
              : "unsupported",
        );
      });
    },
  );

  describe.each(["missing", "unregistered", "dirty", "unmanaged"] as const)(
    "%s candidate classification",
    (classification) => {
      let root: string;

      beforeEach(async () => {
        root = await createDiscoveryRepository();
        let worktree: string;
        if (classification === "missing") {
          worktree = path.join(root, ".worktrees", "missing");
        } else if (classification === "unregistered") {
          worktree = path.join(root, "unregistered");
          await mkdir(worktree);
        } else {
          worktree = await createDiscoveryWorktree(root, classification);
          if (classification === "dirty") {
            await writeFile(path.join(worktree, "untracked.txt"), "dirty\n");
          } else {
            await mkdir(path.join(worktree, ".ephemeral"));
            await writeFile(
              path.join(worktree, ".ephemeral", "unowned.json"),
              "{}\n",
            );
          }
        }
        await writeDiscoveryLease(root, discoveryLease(worktree));
      });

      it("returns the matching cleanup-required classification", async () => {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("cleanup-required");
        expect(result.active[0].classification).toBe(classification);
      });
    },
  );

  it.each(
    (["alternate", "canonical"] as const).flatMap((placement) =>
      (["missing", "unregistered"] as const).map(
        (classification) => [placement, classification] as const,
      ),
    ),
  )(
    "keeps a pointer-bearing %s %s lease out of artifact-free ambiguity",
    async (placement, classification) => {
      const root = await createDiscoveryRepository();
      const resumable = await createDiscoveryWorktree(
        root,
        placement === "canonical" ? "clean-alternate" : "clean-claim",
      );
      await writeDiscoveryLease(root, discoveryLease(resumable));

      const blocked =
        placement === "canonical"
          ? path.join(root, ".worktrees", "pr-432-review")
          : classification === "missing"
            ? path.join(root, ".worktrees", "missing-artifact")
            : path.join(root, "unregistered-artifact");
      if (classification === "unregistered") {
        await mkdir(blocked);
      }
      const artifactLease = discoveryLease(blocked);
      artifactLease.artifacts.handoff_file = ".ephemeral/missing-handoff.json";
      await writeDiscoveryLease(root, artifactLease);

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("cleanup-required");
      expect(result.cleanup).toMatchObject({
        lease_file: artifactLease.lease_file,
        worktree_path: blocked,
        reason: "artifact-authority-required",
      });
      expect(result.active).toContainEqual(
        expect.objectContaining({
          lease_file: artifactLease.lease_file,
          worktree_path: blocked,
          classification: "artifact-bearing",
          reason: "artifact-authority-required",
        }),
      );
      expect(result.active).toContainEqual(
        expect.objectContaining({
          lease_file: discoveryLease(resumable).lease_file,
          worktree_path: resumable,
          classification: "resumable",
          reason: "resumable",
        }),
      );
      expect(() =>
        validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
          repository: "owner/repo",
          prNumber: 432,
          primaryRoot: root,
        }),
      ).not.toThrow();
    },
  );

  it("validates a pointer-bearing canonical lease with no worktree parent", async () => {
    const root = await createDiscoveryRepository();
    const worktree = path.join(root, ".worktrees", "pr-432-review");
    const artifactLease = discoveryLease(worktree);
    artifactLease.artifacts.handoff_file = ".ephemeral/missing-handoff.json";
    await writeDiscoveryLease(root, artifactLease);

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.canonical_target).toEqual({
      worktree_path: worktree,
      status: "absent",
      registered: false,
      parent_status: "absent",
    });
    expect(result.cleanup).toMatchObject({
      lease_file: artifactLease.lease_file,
      worktree_path: worktree,
      reason: "artifact-authority-required",
    });
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: root,
      }),
    ).not.toThrow();
  });

  it("rejects duplicate and contradictory artifact-bearing registrations", () => {
    const worktree = "/repo/alternate";
    const inventory = {
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: "/repo",
      canonical_target: {
        worktree_path: "/repo/.worktrees/pr-432-review",
        status: "absent" as const,
        registered: false,
        parent_status: "directory" as const,
      },
      registrations: [] as string[],
      active: [
        {
          lease_file: `.ephemeral/pr-432-${discoveryDigest(worktree)}-lease.json`,
          worktree_path: worktree,
          state: "created" as const,
          classification: "artifact-bearing" as const,
          reason: "artifact-authority-required",
        },
      ],
      archived: [],
      invalid: [],
      comparison_platform: "linux" as const,
    };
    const result = reducePrReviewDiscovery(inventory);
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: "/repo",
        platform: "linux",
      }),
    ).not.toThrow();

    for (const registrations of [
      [worktree, `${worktree}/.`],
      ["/repo/.worktrees/pr-432-review"],
    ]) {
      expect(() =>
        validatePrReviewDiscoveryJson(
          Buffer.from(JSON.stringify({ ...result, registrations })),
          {
            repository: "owner/repo",
            prNumber: 432,
            primaryRoot: "/repo",
            platform: "linux",
          },
        ),
      ).toThrow();
    }
  });

  it("honors untracked files even when repository config hides them", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "hidden-untracked");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    await execFileAsync("git", [
      "-C",
      worktree,
      "config",
      "status.showUntrackedFiles",
      "no",
    ]);
    await writeFile(path.join(worktree, "hidden.txt"), "dirty\n");
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.active[0].classification).toBe("dirty");
  });

  it("streams a valid non-gitlink inventory larger than one MiB", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "large-inventory");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const inventory = path.join(wrapperDir, "large-inventory");
    const records: Buffer[] = [];
    for (let index = 0; index < 18_000; index += 1) {
      records.push(
        Buffer.from(
          `100644 ${"a".repeat(40)} 0\tordinary-${index
            .toString()
            .padStart(5, "0")}\0`,
        ),
      );
    }
    const inventoryBytes = Buffer.concat(records);
    expect(inventoryBytes.length).toBeGreaterThan(1024 * 1024);
    await writeFile(inventory, inventoryBytes);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" ls-files --stage -z "*)',
        `    cat '${await toGitBashPath(inventory)}'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.resume?.worktree_path).toBe(worktree);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([
    [
      "one selected path",
      () =>
        discoveryGitlinkRecord(
          Buffer.alloc(discoveryGitlinkSelectedPathMaxBytes + 1, 0x61),
        ),
    ],
    [
      "selected record count",
      () =>
        Buffer.concat([
          ...Array.from(
            { length: discoveryGitlinkSelectedRecordMaxCount },
            () => discoveryGitlinkRecord("p"),
          ),
          Buffer.from(`160000 ${"a".repeat(40)} 0\t`, "ascii"),
          Buffer.alloc(256 * 1024, 0x78),
          Buffer.from([0]),
        ]),
    ],
    [
      "aggregate selected paths",
      () =>
        Buffer.concat([
          ...Array.from(
            {
              length:
                discoveryGitlinkSelectedAggregateMaxBytes /
                discoveryGitlinkSelectedPathMaxBytes,
            },
            () =>
              discoveryGitlinkRecord(
                Buffer.alloc(discoveryGitlinkSelectedPathMaxBytes, 0x61),
              ),
          ),
          Buffer.from(`160000 ${"a".repeat(40)} 0\t`, "ascii"),
          Buffer.alloc(256 * 1024, 0x78),
          Buffer.from([0]),
        ]),
    ],
  ])(
    "drains streamed gitlink overflow for %s before failing closed",
    async (_fixture, inventoryFactory) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        "bounded-gitlink-inventory",
      );
      await writeDiscoveryLease(root, discoveryLease(worktree));
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const inventory = path.join(wrapperDir, "overflow-inventory");
      const postTailMarker = path.join(wrapperDir, "post-tail-reached");
      const statusMarker = path.join(wrapperDir, "status-intercepted");
      let inventoryBytes = inventoryFactory();
      if (_fixture === "one selected path") {
        inventoryBytes = Buffer.concat([
          inventoryBytes.subarray(0, -1),
          Buffer.alloc(256 * 1024, 0x78),
          Buffer.from([0]),
        ]);
      }
      await writeFile(inventory, inventoryBytes);
      const inventoryPath = await toGitBashPath(inventory);
      const postTailMarkerPath = await toGitBashPath(postTailMarker);
      const statusMarkerPath = await toGitBashPath(statusMarker);
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" ls-files --stage -z "*)',
          `    cat '${inventoryPath}'`,
          `    printf reached >'${postTailMarkerPath}'`,
          "    exit 0",
          "    ;;",
          '  *" status --porcelain=v1 "*)',
          `    printf reached >'${statusMarkerPath}'`,
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.resume).toBeNull();
        expect(result.cleanup).toBeNull();
        expect(result.active[0]).toMatchObject({
          classification: "invalid",
          reason: "status-inspection-failed",
        });
        expect(await readFile(postTailMarker, "utf8")).toBe("reached");
        await expect(lstat(statusMarker)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("drains dirty status output larger than one MiB", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "large-status");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const statusOutput = path.join(wrapperDir, "large-status");
    const statusBytes = Buffer.alloc(1024 * 1024 + 1, 0x78);
    expect(statusBytes.length).toBeGreaterThan(1024 * 1024);
    await writeFile(statusOutput, statusBytes);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" status --porcelain=v1 --untracked-files=all --ignore-submodules=none "*)',
        `    cat '${await toGitBashPath(statusOutput)}'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("cleanup-required");
      expect(result.active[0]).toMatchObject({
        classification: "dirty",
        reason: "worktree-dirty",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("neutralizes user-global ignore files for discovery and resume acceptance", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "global-ignore");
    const lease = discoveryLease(worktree);
    await writeDiscoveryLease(root, lease);
    const poisonRoot = await mkdtemp(path.join(tmpdir(), "git-poison-ignore-"));
    discoveryTempRoots.push(poisonRoot);
    const xdgRoot = path.join(poisonRoot, ".config");
    await mkdir(path.join(xdgRoot, "git"), { recursive: true });
    await writeFile(
      path.join(xdgRoot, "git", "ignore"),
      "globally-hidden.txt\n",
    );
    await writeFile(path.join(worktree, "globally-hidden.txt"), "dirty\n");
    const oldHome = process.env.HOME;
    const oldXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.HOME = poisonRoot;
    process.env.XDG_CONFIG_HOME = xdgRoot;
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("cleanup-required");
      expect(result.active[0].classification).toBe("dirty");
      await expect(
        runPrReviewLeasesCommand([
          "validate-discovery",
          "--resume-acceptance",
          "--repository",
          "owner/repo",
          "--pr-number",
          "432",
          "--primary-root",
          root,
          "--lease-file",
          lease.lease_file,
          "--worktree-path",
          worktree,
        ]),
      ).resolves.toMatchObject({
        exitCode: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "resume acceptance changed; stop before lifecycle mutation",
        ),
      });
    } finally {
      if (oldHome === undefined) {
        Reflect.deleteProperty(process.env, "HOME");
      } else {
        process.env.HOME = oldHome;
      }
      if (oldXdgConfigHome === undefined) {
        Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME");
      } else {
        process.env.XDG_CONFIG_HOME = oldXdgConfigHome;
      }
    }
  });

  it.each(["repository .gitignore", "repository info/exclude"] as const)(
    "honors %s while neutralizing user-global ignore policy",
    async (ignoreAuthority) => {
      const root = await createDiscoveryRepository();
      if (ignoreAuthority === "repository .gitignore") {
        await writeFile(path.join(root, ".gitignore"), "owned-ignore.txt\n");
        await execFileAsync("git", ["-C", root, "add", ".gitignore"]);
        await execFileAsync("git", [
          "-C",
          root,
          "commit",
          "-m",
          "ignore policy",
        ]);
      } else {
        await writeFile(
          path.join(root, ".git", "info", "exclude"),
          "owned-ignore.txt\n",
        );
      }
      const worktree = await createDiscoveryWorktree(
        root,
        ignoreAuthority === "repository .gitignore"
          ? "repository-ignore"
          : "repository-info-exclude",
      );
      await writeDiscoveryLease(root, discoveryLease(worktree));
      await writeFile(path.join(worktree, "owned-ignore.txt"), "ignored\n");

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.active[0].classification).toBe("resumable");
    },
  );

  it("ignores hostile global and system filter policy without executing it", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "poisoned-config");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const configRoot = await mkdtemp(path.join(tmpdir(), "git-poison-config-"));
    discoveryTempRoots.push(configRoot);
    const marker = path.join(configRoot, "filter-executed");
    const poison = path.join(configRoot, "poison.gitconfig");
    await writeFile(
      poison,
      [
        '[filter "discovery"]',
        `\tprocess = printf executed >"${marker}"`,
        "[core]",
        "\tautocrlf = true",
        "",
      ].join("\n"),
    );
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = poison;
    process.env.GIT_CONFIG_SYSTEM = poison;
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.active[0].classification).toBe("resumable");
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousGlobal === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_GLOBAL");
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      }
      if (previousSystem === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_SYSTEM");
      } else {
        process.env.GIT_CONFIG_SYSTEM = previousSystem;
      }
    }
  });

  it("neutralizes user and system attribute sources for every Git inspection", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "poisoned-attributes");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const poisonRoot = await mkdtemp(
      path.join(tmpdir(), "git-poison-attributes-"),
    );
    discoveryTempRoots.push(poisonRoot);
    await mkdir(path.join(poisonRoot, ".config", "git"), { recursive: true });
    await writeFile(
      path.join(poisonRoot, ".config", "git", "attributes"),
      "README.md filter=discovery -text\n",
    );
    const marker = path.join(poisonRoot, "attribute-boundary-missing");
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        `[ "\${GIT_ATTR_NOSYSTEM:-}" = 1 ] || printf missing >'${marker}'`,
        'case " $* " in',
        `  *" -c core.attributesFile=${nullDevice} "*) ;;`,
        `  *) printf missing >'${marker}' ;;`,
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldHome = process.env.HOME;
    const oldPath = process.env.PATH;
    process.env.HOME = poisonRoot;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.active[0].classification).toBe("resumable");
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (oldHome === undefined) {
        Reflect.deleteProperty(process.env, "HOME");
      } else {
        process.env.HOME = oldHome;
      }
      process.env.PATH = oldPath;
    }
  });

  it("honors repository attributes while ignoring global line-ending policy", async () => {
    const root = await createDiscoveryRepository();
    await writeFile(path.join(root, ".gitattributes"), "* text eol=lf\n");
    await execFileAsync("git", ["-C", root, "add", ".gitattributes"]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "attributes"]);
    const worktree = await createDiscoveryWorktree(root, "attributes-policy");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const configRoot = await mkdtemp(path.join(tmpdir(), "git-eol-config-"));
    discoveryTempRoots.push(configRoot);
    const poison = path.join(configRoot, "global.gitconfig");
    await writeFile(poison, "[core]\n\tautocrlf = true\n");
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = poison;
    try {
      const tracked = path.join(worktree, "README.md");
      const trackedContents = await readFile(tracked, "utf8");
      let result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.active[0].classification).toBe("resumable");

      await writeFile(tracked, trackedContents.replace(/\n/gu, "\r\n"));
      result = await runDiscovery(root);
      expect(result.disposition).toBe("cleanup-required");
      expect(result.active[0].classification).toBe("dirty");
    } finally {
      if (previousGlobal === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_GLOBAL");
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      }
    }
  });

  it("does not let submodule ignore configuration hide tracked changes", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "dirty-submodule");
    const submodule = await createDiscoveryRepository();
    await execFileAsync("git", [
      "-C",
      worktree,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "nested",
    ]);
    await execFileAsync("git", [
      "-C",
      worktree,
      "commit",
      "-m",
      "add submodule",
    ]);
    await execFileAsync("git", [
      "-C",
      worktree,
      "config",
      "submodule.nested.ignore",
      "all",
    ]);
    await writeDiscoveryLease(root, discoveryLease(worktree));
    await writeFile(path.join(worktree, "nested", "README.md"), "changed\n");

    const hidden = await execFileAsync("git", [
      "-C",
      worktree,
      "status",
      "--porcelain",
    ]);
    expect(hidden.stdout).toBe("");
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.active[0]).toMatchObject({
      classification: "dirty",
      reason: "worktree-dirty",
    });
  });

  if (process.platform === "win32") {
    describe.each(["clean", "dirty"] as const)(
      "repository-local %s line-ending policy",
      (scenario) => {
        let globalConfig: string;
        let previousGlobalConfig: string | undefined;
        let root: string;
        let worktree: string;

        beforeEach(async () => {
          const configRoot = await mkdtemp(
            path.join(tmpdir(), "git-windows-config-"),
          );
          discoveryTempRoots.push(configRoot);
          globalConfig = path.join(configRoot, "global.gitconfig");
          await writeFile(globalConfig, "[core]\n\tautocrlf = false\n");
          previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
          process.env.GIT_CONFIG_GLOBAL = globalConfig;
          try {
            root = await createDiscoveryRepository();
            await execFileAsync("git", [
              "-C",
              root,
              "config",
              "core.autocrlf",
              scenario === "clean" ? "true" : "false",
            ]);
            worktree = await createDiscoveryWorktree(
              root,
              `windows-crlf-${scenario}`,
            );
          } finally {
            if (previousGlobalConfig === undefined) {
              Reflect.deleteProperty(process.env, "GIT_CONFIG_GLOBAL");
            } else {
              process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
            }
          }
          await writeDiscoveryLease(root, discoveryLease(worktree));

          if (scenario === "clean") {
            const normal = await execFileAsync(
              "git",
              ["-C", worktree, "status", "--porcelain"],
              { env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig } },
            );
            const mismatched = await execFileAsync("git", [
              "-c",
              "core.autocrlf=false",
              "-C",
              worktree,
              "status",
              "--porcelain",
            ]);
            expect(normal.stdout).toBe("");
            expect(mismatched.stdout).not.toBe("");
          }
        });

        it("ignores poisoned global config", async () => {
          if (scenario === "dirty") {
            const tracked = path.join(worktree, "README.md");
            const trackedContents = await readFile(tracked, "utf8");
            await writeFile(tracked, trackedContents.replace(/\n/gu, "\r\n"));
          }

          process.env.GIT_CONFIG_GLOBAL = globalConfig;
          try {
            const result = await runDiscovery(root);
            expect(result.disposition).toBe(
              scenario === "clean" ? "resume" : "cleanup-required",
            );
            expect(result.active[0].classification).toBe(
              scenario === "clean" ? "resumable" : "dirty",
            );
          } finally {
            if (previousGlobalConfig === undefined) {
              Reflect.deleteProperty(process.env, "GIT_CONFIG_GLOBAL");
            } else {
              process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
            }
          }
        });
      },
    );
  }

  it("reports status inspection failure as structured invalid", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "status-failure");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-status-fail-"));
    discoveryTempRoots.push(wrapperDir);
    const marker = path.join(wrapperDir, "status-intercepted");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        `  *" status "*) printf reached >'${marker}'; exit 2 ;;`,
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      await expectDiscoveryGitAdapterEntry(
        worktree,
        [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ],
        process.platform === "win32" ? 2 : 0,
      );
      expect(await readFile(marker, "utf8")).toBe("reached");
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("returns structured invalid results for malformed leases and unsafe ephemeral directories", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "malformed");
    const lease = discoveryLease(worktree);
    await writeFile(
      path.join(root, lease.lease_file),
      `${JSON.stringify({ ...lease, worktree_path: null })}\n`,
    );
    let result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0].classification).toBe("invalid");

    await rm(path.join(root, lease.lease_file));
    await rm(path.join(root, ".ephemeral"), { recursive: true });
    const external = await mkdtemp(path.join(tmpdir(), "outside-ephemeral-"));
    discoveryTempRoots.push(external);
    await symlink(external, path.join(root, ".ephemeral"), "dir");
    result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.invalid).toContainEqual({
      path: ".ephemeral",
      reason: "invalid-discovery-directory",
    });
  });

  it("rejects a candidate ephemeral symlink and leaves its target untouched", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "symlinked");
    const lease = discoveryLease(worktree);
    await writeDiscoveryLease(root, lease);
    const external = await mkdtemp(path.join(tmpdir(), "outside-candidate-"));
    discoveryTempRoots.push(external);
    await symlink(external, path.join(worktree, ".ephemeral"), "dir");
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0].classification).toBe("invalid");
    expect(await readdir(external)).toEqual([]);
  });

  it("fails closed when the candidate directory is replaced during status", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "replace-during-status",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const replacement = await createDiscoveryRepository();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" status "*)',
        `    mv '${worktree}' '${worktree}.original'`,
        `    ln -s '${replacement}' '${worktree}'`,
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-replaced",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when the validated lease file is replaced during status", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "replace-lease");
    const lease = discoveryLease(worktree);
    await writeDiscoveryLease(root, lease);
    const leasePath = path.join(root, lease.lease_file);
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" status "*)',
        `    cp '${leasePath}' '${leasePath}.replacement'`,
        `    mv '${leasePath}.replacement' '${leasePath}'`,
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "lease-replaced",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when the primary lease inventory changes during status", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "primary-entry-race");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const concurrentLease = path.join(
      root,
      `.ephemeral/pr-432-${"b".repeat(64)}-lease.json`,
    );
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        `  *" status "*) printf '%s\\n' '{}' >'${concurrentLease}' ;;`,
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.invalid).toContainEqual({
        path: ".ephemeral",
        reason: "invalid-discovery-directory",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when candidate ephemeral entries change during status", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "artifact-entry-race");
    await mkdir(path.join(worktree, ".ephemeral"));
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const racedArtifact = path.join(worktree, ".ephemeral", "concurrent.json");
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        `  *" status "*) printf '%s\\n' '{}' >'${racedArtifact}' ;;`,
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-replaced",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when the worktree registration snapshot changes", async () => {
    const root = await createDiscoveryRepository();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree list --porcelain -z "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' \"$next\" >'${counter}'`,
        `    '${realGit}' "$@" || exit $?`,
        '    [ "$next" -lt 2 ] || printf "worktree /concurrent\\0"',
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.invalid).toContainEqual({
        path: ".git/worktrees",
        reason: "worktree-registrations-changed",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when the primary origin binding changes between complete scans", async () => {
    const root = await createDiscoveryRepository();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const marker = path.join(wrapperDir, "changed");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" remote.origin.url "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        '    if [ "$next" -eq 3 ]; then',
        `      '${realGit}' -C '${root}' config --replace-all remote.origin.url https://github.com/owner/other.git`,
        `      printf changed >'${marker}'`,
        "    fi",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(await readFile(marker, "utf8")).toBe("changed");
      expect(result.disposition).toBe("invalid");
      expect(result.resume).toBeNull();
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when a lease is rewritten in place during the final registration snapshot", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "late-lease-rewrite");
    const lease = discoveryLease(worktree);
    await writeDiscoveryLease(root, lease);
    const leasePath = path.join(root, lease.lease_file);
    const rewritten = `${JSON.stringify(
      { ...lease, updated_at: "2026-06-11T00:00:01Z" },
      null,
      2,
    )}\n`;
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree list --porcelain -z "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        `    '${realGit}' "$@" || exit $?`,
        `    [ "$next" -lt 3 ] || printf '%s' '${rewritten}' >'${leasePath}'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "lease-replaced",
      });
      expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(3);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when a candidate is replaced during the final registration snapshot", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "late-candidate-replacement",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree list --porcelain -z "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        `    '${realGit}' "$@" || exit $?`,
        '    if [ "$next" -ge 3 ]; then',
        `      mv '${worktree}' '${worktree}.original'`,
        `      mkdir '${worktree}'`,
        "    fi",
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-replaced",
      });
      expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(3);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([
    ["tracked", "README.md"],
    ["untracked", "late-untracked.txt"],
  ])(
    "fails closed when a %s change lands during the final registration snapshot",
    async (_kind, relativeFile) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `late-${_kind}-dirty`,
      );
      await writeDiscoveryLease(root, discoveryLease(worktree));
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const counter = path.join(wrapperDir, "count");
      const fired = path.join(wrapperDir, "scan-two-fired");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const lateAction =
        _kind === "tracked"
          ? `printf 'late change\\n' >'${path.join(worktree, relativeFile)}'`
          : `printf reached >'${fired}'`;
      const wrapper = path.join(wrapperDir, "git");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
          `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
          `    '${realGit}' "$@" || exit $?`,
          `    [ "$next" -ne 4 ] || { ${lateAction}; }`,
          "    exit 0",
          "    ;;",
          '  *" status --porcelain=v1 --untracked-files=all "*)',
          `    '${realGit}' "$@" || exit $?`,
          ...(_kind === "untracked"
            ? [`    [ ! -f '${fired}' ] || printf '?? ${relativeFile}\\n'`]
            : []),
          "    exit 0",
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.active[0]).toMatchObject({
          classification: "invalid",
          reason: "worktree-dirty-after-snapshot",
        });
        expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(
          4,
        );
        if (_kind === "untracked") {
          expect(await readFile(fired, "utf8")).toBe("reached");
        }
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("fails closed when candidate ephemeral state changes during the second collection registration barrier", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "second-collection-ephemeral",
    );
    await mkdir(path.join(worktree, ".ephemeral"));
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const racedArtifact = path.join(worktree, ".ephemeral", "late.json");
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree list --porcelain -z "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        `    '${realGit}' "$@" || exit $?`,
        `    [ "$next" -lt 3 ] || printf '%s\\n' '{}' >'${racedArtifact}'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.resume).toBeNull();
      expect(result.cleanup).toBeNull();
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-replaced",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed when the final status resampling command fails", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "late-status-failure");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "status-count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" status "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        '    [ "$next" -lt 6 ] || exit 17',
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      expect(result.resume).toBeNull();
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each(["lease", "registration", "canonical"] as const)(
    "fails closed when a %s authority appears during the second global capture",
    async (authority) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `last-verification-${authority}`,
      );
      await writeDiscoveryLease(root, discoveryLease(worktree));
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const registrationCounter = path.join(wrapperDir, "registration-count");
      const concurrentLease = path.join(
        root,
        `.ephemeral/pr-432-${"b".repeat(64)}-lease.json`,
      );
      const canonicalPath = path.join(root, ".worktrees", "pr-432-review");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const lateAction =
        authority === "lease"
          ? `printf '%s\\n' '{}' >'${concurrentLease}'`
          : authority === "canonical"
            ? `mkdir '${canonicalPath}'`
            : ":";
      const wrapper = path.join(wrapperDir, "git");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    count=$(cat '${registrationCounter}' 2>/dev/null || printf 0)`,
          `    next=$((count + 1)); printf '%s' "$next" >'${registrationCounter}'`,
          `    '${realGit}' "$@" || exit $?`,
          `    [ "$next" -lt 3 ] || { ${lateAction}; }`,
          ...(authority === "registration"
            ? [
                `    [ "$next" -lt 3 ] || printf 'worktree /late-registration\\0\\0'`,
              ]
            : []),
          "    exit 0",
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.resume).toBeNull();
        if (authority === "lease") {
          expect(result.invalid).toContainEqual({
            path: ".ephemeral",
            reason: "invalid-discovery-directory",
          });
        } else if (authority === "registration") {
          expect(result.invalid).toContainEqual({
            path: ".git/worktrees",
            reason: "worktree-registrations-changed",
          });
        } else {
          expect(result.invalid).toContainEqual({
            path: canonicalPath,
            reason: "canonical-target-changed",
          });
        }
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("rejects a stale registration occupied by a clean foreign repository", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "foreign-repository");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    await rm(worktree, { recursive: true, force: true });
    await execFileAsync("git", ["init", "-b", "main", worktree]);
    await execFileAsync("git", [
      "-C",
      worktree,
      "config",
      "user.name",
      "Foreign",
    ]);
    await execFileAsync("git", [
      "-C",
      worktree,
      "config",
      "user.email",
      "foreign@example.com",
    ]);
    await writeFile(path.join(worktree, "README.md"), "foreign\n");
    await execFileAsync("git", ["-C", worktree, "add", "README.md"]);
    await execFileAsync("git", ["-C", worktree, "commit", "-m", "foreign"]);
    await mkdir(path.join(worktree, ".ephemeral"));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "worktree-repository-mismatch",
    });
    expect(result.resume).toBeNull();
  });

  it("distinguishes unregistered missing worktrees from stale registrations", async () => {
    const root = await createDiscoveryRepository();
    const unregistered = path.join(root, ".worktrees", "missing");
    await writeDiscoveryLease(root, discoveryLease(unregistered));
    let result = await runDiscovery(root);
    expect(result).toMatchObject({
      disposition: "cleanup-required",
      cleanup: {
        worktree_path: unregistered,
        reason: "worktree-missing",
      },
    });
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: root,
      }),
    ).not.toThrow();

    await rm(path.join(root, ".ephemeral"), { recursive: true, force: true });
    await mkdir(path.join(root, ".ephemeral"));
    const registered = await createDiscoveryWorktree(
      root,
      "stale-registration",
    );
    await writeDiscoveryLease(root, discoveryLease(registered));
    await rm(registered, { recursive: true, force: true });
    result = await runDiscovery(root);
    expect(result).toMatchObject({
      disposition: "invalid",
      cleanup: null,
      resume: null,
      active: [
        {
          worktree_path: registered,
          classification: "invalid",
          reason: "worktree-inspection-failed",
        },
      ],
    });
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: root,
      }),
    ).not.toThrow();
  });

  it.each([
    "artifact-bearing",
    "unmanaged",
    "dirty",
    "terminal",
    "unsupported",
  ] as const)(
    "validates repository membership before classifying a registered %s blocker",
    async (classification) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `foreign-${classification}`,
      );
      const lease = discoveryLease(worktree);
      if (classification === "artifact-bearing") {
        lease.artifacts.handoff_file = ".ephemeral/missing-handoff.json";
      } else if (classification === "terminal") {
        lease.state = "aborted";
        lease.terminal = {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "operator-aborted",
        };
      } else if (classification === "unsupported") {
        lease.state = "failed";
        lease.terminal.finished_at = "2026-06-11T00:01:00Z";
        lease.failure = {
          phase: "review",
          reason: "review failed",
          recoverability: "recoverable",
        };
      }
      await writeDiscoveryLease(root, lease);

      await rm(worktree, { recursive: true, force: true });
      await execFileAsync("git", ["init", "-b", "main", worktree]);
      await execFileAsync("git", [
        "-C",
        worktree,
        "config",
        "user.name",
        "Foreign",
      ]);
      await execFileAsync("git", [
        "-C",
        worktree,
        "config",
        "user.email",
        "foreign@example.com",
      ]);
      await writeFile(path.join(worktree, "README.md"), "foreign\n");
      await execFileAsync("git", ["-C", worktree, "add", "README.md"]);
      await execFileAsync("git", ["-C", worktree, "commit", "-m", "foreign"]);
      await mkdir(path.join(worktree, ".ephemeral"));
      if (classification === "unmanaged") {
        await writeFile(
          path.join(worktree, ".ephemeral", "unowned.json"),
          "{}\n",
        );
      } else if (classification === "dirty") {
        await writeFile(path.join(worktree, "dirty.txt"), "dirty\n");
      }

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.cleanup).toBeNull();
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-repository-mismatch",
      });
    },
  );

  it("fails closed when repository identity changes during the final registration snapshot", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "late-repository-identity",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const foreign = await createDiscoveryRepository();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const counter = path.join(wrapperDir, "count");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree list --porcelain -z "*)',
        `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
        `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
        `    '${realGit}' "$@" || exit $?`,
        `    [ "$next" -lt 3 ] || printf 'gitdir: %s/.git\\n' '${foreign}' >'${path.join(
          worktree,
          ".git",
        )}'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "repository-identity-changed",
      });
      expect(result.resume).toBeNull();
      expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(3);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([
    ["drifts", false],
    ["fails", true],
  ])(
    "fails closed when primary repository identity %s after the final registration snapshot",
    async (_scenario, failCommand) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `late-primary-${_scenario}`,
      );
      await writeDiscoveryLease(root, discoveryLease(worktree));
      const foreign = await createDiscoveryRepository();
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const counter = path.join(wrapperDir, "count");
      const fired = path.join(wrapperDir, "scan-two-fired");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      const lateIdentityAction = failCommand
        ? "exit 17"
        : `printf '%s\\n' '${foreign}'; exit 0`;
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
          `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
          `    '${realGit}' "$@" || exit $?`,
          `    [ "$next" -ne 3 ] || printf reached >'${fired}'`,
          "    exit 0",
          "    ;;",
          `  *" -C ${root} rev-parse --show-toplevel "*)`,
          `    [ ! -f '${fired}' ] || { ${lateIdentityAction}; }`,
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.active[0]).toMatchObject({
          classification: "invalid",
          reason: "repository-identity-changed",
        });
        expect(result.resume).toBeNull();
        expect(await readFile(fired, "utf8")).toBe("reached");
        expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(
          3,
        );
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("performs no Git authority command after the stable second collection", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "pure-reduction");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const commandLog = path.join(wrapperDir, "commands");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >>'${commandLog}'`,
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      const commands = (await readFile(commandLog, "utf8")).trim().split("\n");
      expect(commands.at(-1)).toContain("rev-parse --absolute-git-dir");
      expect(result.resume?.worktree_path).toBe(worktree);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([
    ["drifts", false],
    ["fails", true],
  ])(
    "fails closed when primary repository identity %s on the no-active create path",
    async (_scenario, failCommand) => {
      const root = await createDiscoveryRepository();
      const foreign = await createDiscoveryRepository();
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const counter = path.join(wrapperDir, "count");
      const fired = path.join(wrapperDir, "scan-two-fired");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      const lateIdentityAction = failCommand
        ? "exit 17"
        : `printf '%s\\n' '${foreign}'; exit 0`;
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    count=$(cat '${counter}' 2>/dev/null || printf 0)`,
          `    next=$((count + 1)); printf '%s' "$next" >'${counter}'`,
          `    '${realGit}' "$@" || exit $?`,
          `    [ "$next" -ne 3 ] || printf reached >'${fired}'`,
          "    exit 0",
          "    ;;",
          `  *" -C ${root} rev-parse --show-toplevel "*)`,
          `    [ ! -f '${fired}' ] || { ${lateIdentityAction}; }`,
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.invalid).toContainEqual({
          path: ".git",
          reason: "primary-repository-identity-changed",
        });
        expect(result.resume).toBeNull();
        expect(await readFile(fired, "utf8")).toBe("reached");
        expect(Number(await readFile(counter, "utf8"))).toBeGreaterThanOrEqual(
          3,
        );
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("reduces deterministically under an explicit comparison policy and selects active cleanup first", () => {
    const inventory = {
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: "/repo",
      canonical_target: {
        worktree_path: "/repo/.worktrees/pr-432-review",
        status: "directory" as const,
        registered: false,
        parent_status: "directory" as const,
      },
      registrations: [],
      active: [
        {
          lease_file: ".ephemeral/pr-432-a-lease.json",
          worktree_path: "/repo/alternate",
          state: "created" as const,
          classification: "dirty" as const,
          reason: "worktree-dirty",
        },
      ],
      archived: [],
      invalid: [],
      comparison_platform: "linux" as const,
    };
    const first = reducePrReviewDiscovery(inventory);
    const second = reducePrReviewDiscovery(structuredClone(inventory));
    expect(second).toEqual(first);
    expect(first.cleanup).toEqual({
      lease_file: ".ephemeral/pr-432-a-lease.json",
      worktree_path: "/repo/alternate",
      reason: "worktree-dirty",
    });
  });

  it("orders Unicode scalar values and prefixes consistently for cleanup selection", () => {
    const worktree = "/repo/alternate";
    const blocker = (leaseFile: string) => ({
      lease_file: leaseFile,
      worktree_path: worktree,
      state: "created" as const,
      classification: "artifact-bearing" as const,
      reason: "artifact-authority-required",
    });
    const privateUse = ".ephemeral/pr-432-\uE000-lease.json";
    const astral = ".ephemeral/pr-432-\u{10000}-lease.json";
    const prefix = ".ephemeral/pr-432-a-lease.json";
    const prefixed = ".ephemeral/pr-432-aa-lease.json";
    const result = reducePrReviewDiscovery({
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: "/repo",
      canonical_target: {
        worktree_path: "/repo/.worktrees/pr-432-review",
        status: "absent",
        registered: false,
        parent_status: "directory",
      },
      registrations: [worktree],
      active: [
        blocker(astral),
        blocker(privateUse),
        blocker(prefixed),
        blocker(prefix),
      ],
      archived: [],
      invalid: [],
      comparison_platform: "linux",
    });

    expect(result.active.map((entry) => entry.lease_file)).toEqual([
      prefix,
      prefixed,
      privateUse,
      astral,
    ]);
    expect(result.cleanup?.lease_file).toBe(prefix);
  });

  it("fails closed when reducer input marks a null worktree path resumable", () => {
    const result = reducePrReviewDiscovery({
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: "/repo",
      canonical_target: {
        worktree_path: "/repo/.worktrees/pr-432-review",
        status: "absent",
        registered: false,
        parent_status: "directory",
      },
      registrations: [],
      active: [
        {
          lease_file: ".ephemeral/pr-432-a-lease.json",
          worktree_path: null,
          state: "created",
          classification: "resumable",
          reason: "resumable",
        },
      ],
      archived: [],
      invalid: [],
      comparison_platform: "linux",
    });

    expect(result.disposition).toBe("invalid");
    expect(result.resume).toBeNull();
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "resumable-worktree-path-missing",
    });
  });

  it.each([
    ["resumable", "resumable", "created"],
    ["terminal", "terminal-lease", "aborted"],
    ["unsupported", "unsupported-lease-state", "reviewed"],
    ["artifact-bearing", "artifact-authority-required", "created"],
    ["missing", "worktree-missing", "created"],
    ["unregistered", "worktree-unregistered", "created"],
    ["dirty", "worktree-dirty", "created"],
    ["unmanaged", "unmanaged-ephemeral-artifacts", "created"],
  ] as const)(
    "requires a worktree path for non-invalid %s classifications",
    (classification, reason, state) => {
      const result = reducePrReviewDiscovery({
        repository: "owner/repo",
        pr_number: 432,
        primary_repository_root: "/repo",
        canonical_target: {
          worktree_path: "/repo/.worktrees/pr-432-review",
          status: "absent",
          registered: false,
          parent_status: "directory",
        },
        registrations: [],
        active: [
          {
            lease_file: ".ephemeral/pr-432-a-lease.json",
            worktree_path: null,
            state,
            classification,
            reason,
          },
        ],
        archived: [],
        invalid: [],
        comparison_platform: "linux",
      });

      expect(result.disposition).toBe("invalid");
      expect(result.resume).toBeNull();
      expect(result.cleanup).toBeNull();
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "resumable-worktree-path-missing",
      });
    },
  );

  it("reports only canonical archive names and invalidates malformed suffixes", async () => {
    const root = await createDiscoveryRepository();
    const valid =
      ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20260611T010203-posted-archived-lease.json";
    await writeFile(path.join(root, valid), "{}\n");
    let result = await runDiscovery(root);
    expect(result.disposition).toBe("create");
    expect(result.archived).toEqual([valid]);

    await writeFile(
      path.join(root, ".ephemeral/pr-432-A-archived-lease.json"),
      "{}\n",
    );
    await writeFile(
      path.join(
        root,
        `.ephemeral/pr-432-${"b".repeat(64)}-20261399T999999-posted-archived-lease.json`,
      ),
      "{}\n",
    );
    result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.invalid).toHaveLength(2);
    expect(
      result.invalid.every(
        (entry) => entry.reason === "invalid-archived-entry",
      ),
    ).toBe(true);
  });

  it("rejects non-file and symlink archive entries without following them", async () => {
    const root = await createDiscoveryRepository();
    const leaf = `pr-432-${"c".repeat(
      64,
    )}-20260611T010203-posted-archived-lease.json`;
    await mkdir(path.join(root, ".ephemeral", leaf));
    let result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.invalid).toContainEqual({
      path: `.ephemeral/${leaf}`,
      reason: "invalid-archived-entry",
    });

    await rm(path.join(root, ".ephemeral", leaf), { recursive: true });
    const external = path.join(root, "external-archive.json");
    await writeFile(external, "{}\n");
    await symlink(external, path.join(root, ".ephemeral", leaf));
    result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.invalid).toContainEqual({
      path: `.ephemeral/${leaf}`,
      reason: "invalid-archived-entry",
    });
  });

  it("uses a null-lease manual stop for an occupied unleased canonical target", async () => {
    const root = await createDiscoveryRepository();
    await mkdir(path.join(root, ".worktrees", "pr-432-review"), {
      recursive: true,
    });
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.cleanup).toMatchObject({
      lease_file: null,
      reason: "canonical-target-occupied",
    });
  });

  it("allows an absent canonical parent but invalidates a symlink parent", async () => {
    const root = await createDiscoveryRepository();
    let result = await runDiscovery(root);
    expect(result.disposition).toBe("create");

    const external = await mkdtemp(path.join(tmpdir(), "outside-worktrees-"));
    discoveryTempRoots.push(external);
    await symlink(external, path.join(root, ".worktrees"), "dir");
    result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.invalid[0].reason).toBe("invalid-canonical-target");
  });

  it("isolates other PR leases and orders output ordinally", async () => {
    const root = await createDiscoveryRepository();
    const other = discoveryLease(path.join(root, ".worktrees", "other"), 433);
    await writeDiscoveryLease(root, other);
    for (const suffix of ["_", "A", "ä"]) {
      await writeFile(
        path.join(
          root,
          `.ephemeral/pr-432-${"a".repeat(63)}${suffix}-lease.json`,
        ),
        "{}\n",
      );
    }
    const result = await runDiscovery(root);
    expect(result.invalid.map((entry) => entry.path)).toEqual([
      `.ephemeral/pr-432-${"a".repeat(63)}A-lease.json`,
      `.ephemeral/pr-432-${"a".repeat(63)}_-lease.json`,
      `.ephemeral/pr-432-${"a".repeat(63)}ä-lease.json`,
    ]);
    expect(
      result.active.some((entry) => entry.lease_file === other.lease_file),
    ).toBe(false);
  });

  it("uses a minimal Git environment and normalizes MSYS only at Windows I/O", () => {
    process.env.Git_Dir = "/tmp/poison";
    process.env.git_dir = "/tmp/poison-lower";
    process.env.Git_Trace2_Event = "/tmp/trace";
    const env = discoveryGitEnvironment();
    expect(
      Object.keys(env).some((key) => key.toUpperCase() === "GIT_DIR"),
    ).toBe(false);
    expect(
      Object.keys(env).some((key) => key.toUpperCase() === "GIT_TRACE2_EVENT"),
    ).toBe(false);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_NO_LAZY_FETCH).toBe("1");
    expect(discoveryFilesystemPath("/C/a/b", "win32")).toBe("c:/a/b");
    expect(discoveryFilesystemPath("/C/a/b", "linux")).toBe("/C/a/b");
    expect(discoveryFilesystemPath("\\\\server\\share\\a", "win32")).toBe(
      "\\\\server\\share\\a",
    );
  });

  it("propagates the no-lazy-fetch refusal guard to every discovery Git child", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "no-lazy-fetch-guard");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const missingGuardMarker = path.join(wrapperDir, "missing-guard");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        `if [ "\${GIT_NO_LAZY_FETCH:-}" != 1 ]; then printf missing >'${missingGuardMarker}'; exit 91; fi`,
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    const oldNoLazyFetch = process.env.GIT_NO_LAZY_FETCH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    process.env.GIT_NO_LAZY_FETCH = "0";
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.resume?.worktree_path).toBe(worktree);
      await expect(lstat(missingGuardMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      process.env.PATH = oldPath;
      if (oldNoLazyFetch === undefined) {
        Reflect.deleteProperty(process.env, "GIT_NO_LAZY_FETCH");
      } else {
        process.env.GIT_NO_LAZY_FETCH = oldNoLazyFetch;
      }
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves valid Unicode and newline bytes in path-bearing Git output",
    async () => {
      const root = await createDiscoveryRepository();
      const worktree = path.join(root, ".worktrees", "unicode-한글\nworktree");
      await mkdir(path.dirname(worktree), { recursive: true });
      await execFileAsync("git", [
        "-C",
        root,
        "worktree",
        "add",
        "-b",
        "test-unicode-newline-output",
        worktree,
      ]);
      const physicalWorktree = await realpath(worktree);
      const lease = discoveryLease(physicalWorktree);
      await writeDiscoveryLease(root, lease);

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("resume");
      expect(result.registrations).toContain(physicalWorktree);
      expect(result.resume).toEqual({
        lease_file: lease.lease_file,
        worktree_path: physicalWorktree,
      });
    },
  );

  it.each([
    ["invalid UTF-8", "printf 'worktree invalid-\\377\\000\\000'"],
    ["zero bytes", ":"],
    ["a lone leading separator", "printf '\\000'"],
    [
      "a missing block separator",
      "printf 'worktree /tmp/path\\000HEAD abc\\000'",
    ],
    ["a missing worktree field", "printf 'HEAD abc\\000\\000'"],
    [
      "a duplicate worktree field",
      "printf 'worktree /tmp/a\\000worktree /tmp/b\\000\\000'",
    ],
    [
      "an additional empty separator between blocks",
      "printf 'worktree /tmp/a\\000\\000\\000worktree /tmp/b\\000\\000'",
    ],
    ["an extra trailing NUL", "git \"$@\"; printf '\\000'"],
  ])(
    "fails closed when worktree registration output contains %s",
    async (_scenario, emitOutput) => {
      const root = await createDiscoveryRepository();
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const fired = path.join(wrapperDir, "registration-output-fired");
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" worktree list --porcelain -z "*)',
          `    printf fired >'${fired}'`,
          `    ${emitOutput.replace('git "$@"', `'${realGit}' "$@"`)}`,
          "    exit 0",
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        await expectDiscoveryGitAdapterEntry(root, [
          "worktree",
          "list",
          "--porcelain",
          "-z",
        ]);
        expect(await readFile(fired, "utf8")).toBe("fired");
        expect(result.disposition).toBe("invalid");
        expect(result.resume).toBeNull();
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("fails closed on invalid UTF-8 in a candidate rev-parse path identity", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "invalid-rev-parse-path",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const fired = path.join(wrapperDir, "rev-parse-output-fired");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        `  *" -C ${worktree} rev-parse --show-toplevel "*)`,
        `    printf fired >'${fired}'`,
        "    printf 'invalid-\\377\\n'",
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.resume).toBeNull();
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-repository-mismatch",
      });
      expect(await readFile(fired, "utf8")).toBe("fired");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("parses raw NUL-delimited gitlink records without changing path bytes", () => {
    const oid = "a".repeat(40);
    const singleRecord = Buffer.from(`160000 ${oid} 0\tascii\0`);
    expect(parseDiscoveryGitlinkRecords(singleRecord)).toEqual(["ascii"]);
    expect(
      parseDiscoveryGitlinkRecords(
        Buffer.from(
          `100644 ${oid} 0\tREADME.md\0` +
            `160000 ${oid} 0\tascii\0` +
            `160000 ${oid} 0\t한글\0` +
            `160000 ${oid} 0\tnested\nmodule\0` +
            `160000 ${oid} 0\ttab\tmodule\0`,
        ),
      ),
    ).toEqual(["ascii", "한글", "nested\nmodule", "tab\tmodule"]);
    expect(parseDiscoveryGitlinkRecords(Buffer.alloc(0))).toEqual([]);
    for (const malformed of [
      Buffer.from([0]),
      Buffer.concat([Buffer.from([0]), singleRecord]),
      Buffer.concat([singleRecord, Buffer.from([0]), singleRecord]),
      Buffer.concat([singleRecord, Buffer.from([0])]),
    ]) {
      expect(() => parseDiscoveryGitlinkRecords(malformed)).toThrow(
        "discovery gitlink inventory record is malformed",
      );
    }
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.from(`160000 ${oid} 0\tnested\nmodule`),
      ),
    ).toThrow("discovery gitlink inventory is not NUL-terminated");
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.from("160000 invalid 0\tnested\nmodule\0"),
      ),
    ).toThrow("discovery gitlink inventory record is malformed");
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.from(`160000 ${oid} 0 missing-tab\0`),
      ),
    ).toThrow("discovery gitlink inventory record is malformed");
    expect(() =>
      parseDiscoveryGitlinkRecords(Buffer.from(`160000 ${oid} 0\t\0`)),
    ).toThrow("discovery gitlink inventory record is malformed");
    expect(() =>
      parseDiscoveryGitlinkRecords(Buffer.from(`100644 ${oid} 0\t\0`)),
    ).toThrow("discovery gitlink inventory record is malformed");
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.concat([
          Buffer.from(`160000 ${oid} 0\tinvalid-`),
          Buffer.from([0xff, 0]),
        ]),
      ),
    ).toThrow("discovery gitlink inventory path is not valid UTF-8");
    for (const metadata of [
      Buffer.concat([
        Buffer.from([0xb1]),
        Buffer.from(`60000 ${oid} 0\tpath\0`),
      ]),
      Buffer.concat([
        Buffer.from("160000 "),
        Buffer.alloc(40, 0xe1),
        Buffer.from(" 0\tpath\0"),
      ]),
      Buffer.concat([
        Buffer.from(`160000 ${oid} `),
        Buffer.from([0xb0]),
        Buffer.from("\tpath\0"),
      ]),
    ]) {
      expect(() => parseDiscoveryGitlinkRecords(metadata)).toThrow(
        "discovery gitlink inventory record is malformed",
      );
    }
  });

  it("bounds retained gitlink paths, records, and aggregate bytes", () => {
    for (const pathBytes of [
      discoveryGitlinkSelectedPathMaxBytes - 1,
      discoveryGitlinkSelectedPathMaxBytes,
    ]) {
      const parsed = parseDiscoveryGitlinkRecords(
        discoveryGitlinkRecord(Buffer.alloc(pathBytes, 0x61)),
      );
      expect(parsed).toHaveLength(1);
      expect(Buffer.byteLength(parsed[0])).toBe(pathBytes);
    }
    expect(() =>
      parseDiscoveryGitlinkRecords(
        discoveryGitlinkRecord(
          Buffer.alloc(discoveryGitlinkSelectedPathMaxBytes + 1, 0x61),
        ),
      ),
    ).toThrow("discovery gitlink inventory exceeds retained limits");

    const exactMultibytePath = Buffer.concat([
      Buffer.alloc(discoveryGitlinkSelectedPathMaxBytes - 3, 0x61),
      Buffer.from("한"),
    ]);
    expect(
      Buffer.byteLength(
        parseDiscoveryGitlinkRecords(
          discoveryGitlinkRecord(exactMultibytePath),
        )[0],
      ),
    ).toBe(discoveryGitlinkSelectedPathMaxBytes);
    expect(() =>
      parseDiscoveryGitlinkRecords(
        discoveryGitlinkRecord(
          Buffer.concat([exactMultibytePath, Buffer.from("a")]),
        ),
      ),
    ).toThrow("discovery gitlink inventory exceeds retained limits");

    const selectedRecord = discoveryGitlinkRecord("p");
    expect(
      parseDiscoveryGitlinkRecords(
        Buffer.concat(
          Array.from(
            { length: discoveryGitlinkSelectedRecordMaxCount },
            () => selectedRecord,
          ),
        ),
      ),
    ).toHaveLength(discoveryGitlinkSelectedRecordMaxCount);
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.concat(
          Array.from(
            { length: discoveryGitlinkSelectedRecordMaxCount + 1 },
            () => selectedRecord,
          ),
        ),
      ),
    ).toThrow("discovery gitlink inventory exceeds retained limits");

    const aggregateRecord = discoveryGitlinkRecord(
      Buffer.alloc(discoveryGitlinkSelectedPathMaxBytes, 0x61),
    );
    const aggregateRecordCount =
      discoveryGitlinkSelectedAggregateMaxBytes /
      discoveryGitlinkSelectedPathMaxBytes;
    expect(
      parseDiscoveryGitlinkRecords(
        Buffer.concat(
          Array.from({ length: aggregateRecordCount }, () => aggregateRecord),
        ),
      ),
    ).toHaveLength(aggregateRecordCount);
    expect(() =>
      parseDiscoveryGitlinkRecords(
        Buffer.concat([
          ...Array.from(
            { length: aggregateRecordCount },
            () => aggregateRecord,
          ),
          discoveryGitlinkRecord("x"),
        ]),
      ),
    ).toThrow("discovery gitlink inventory exceeds retained limits");

    expect(
      parseDiscoveryGitlinkRecords(
        Buffer.concat([
          Buffer.from(`100644 ${"a".repeat(40)} 0\t`, "ascii"),
          Buffer.alloc(discoveryGitlinkSelectedAggregateMaxBytes + 1, 0x6f),
          Buffer.from([0]),
          discoveryGitlinkRecord("selected"),
        ]),
      ),
    ).toEqual(["selected"]);
  });

  it("accepts native Windows producer spellings in the closed lease parser", () => {
    for (const worktreePath of [
      "C:\\Repo\\Worktree",
      "\\\\Server\\Share\\Worktree",
    ]) {
      const lease = discoveryLease(worktreePath);
      expect(parseDiscoveryLease(lease).worktree_path).toBe(worktreePath);
    }
  });

  it("requires closed-schema fields to be own properties", () => {
    const lease = discoveryLease("/tmp/owned-fields");
    const inheritedRepository = Object.create({ repository: lease.repository });
    Object.assign(inheritedRepository, lease);
    Reflect.deleteProperty(inheritedRepository, "repository");

    expect(() => parseDiscoveryLease(inheritedRepository)).toThrow(
      "lease schema mismatch",
    );
  });

  it.each([
    [
      "presentation",
      (lease: PrReviewLease) => {
        lease.presentation = {
          presented_at: "2026-06-11T00:01:00Z",
          status: "preview-current",
        };
      },
    ],
    [
      "terminal",
      (lease: PrReviewLease) => {
        lease.terminal = {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "impossible-created-terminal",
        };
      },
    ],
    [
      "failure",
      (lease: PrReviewLease) => {
        lease.failure = {
          phase: "review",
          reason: "impossible-created-failure",
          recoverability: "recoverable",
        };
      },
    ],
    [
      "GitHub post",
      (lease: PrReviewLease) => {
        lease.github = {
          github_post_attempted: true,
          github_post_result: "succeeded",
          github_posted_at: "2026-06-11T00:01:00Z",
        };
      },
    ],
  ] as const)(
    "rejects impossible created-state %s metadata before resumable classification",
    async (label, mutate) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `invalid-created-${label.replaceAll(" ", "-")}`,
      );
      const lease = discoveryLease(worktree);
      mutate(lease);
      await writeDiscoveryLease(root, lease);

      const result = await runDiscovery(root);
      expect(result).toMatchObject({
        disposition: "invalid",
        resume: null,
        cleanup: null,
        active: [
          {
            lease_file: lease.lease_file,
            worktree_path: null,
            state: null,
            classification: "invalid",
            reason: "invalid-lease",
          },
        ],
      });
    },
  );

  it("keeps a created handoff pointer structurally valid but non-resumable", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "created-handoff-pointer",
    );
    const lease = discoveryLease(worktree);
    lease.artifacts.handoff_file = ".ephemeral/review-handoff.json";
    await writeDiscoveryLease(root, lease);

    const result = await runDiscovery(root);
    expect(result).toMatchObject({
      disposition: "cleanup-required",
      resume: null,
      active: [
        {
          lease_file: lease.lease_file,
          worktree_path: worktree,
          state: "created",
          classification: "artifact-bearing",
          reason: "artifact-authority-required",
        },
      ],
    });
    expect(() =>
      validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(result)), {
        repository: "owner/repo",
        prNumber: 432,
        primaryRoot: root,
      }),
    ).not.toThrow();
  });

  it("rejects unknown keys and malformed primitive fields without throwing from discover", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "closed-schema");
    const lease = discoveryLease(worktree) as PrReviewLease & {
      unexpected?: boolean;
    };
    lease.unexpected = true;
    await writeDiscoveryLease(root, lease);
    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0].reason).toBe("invalid-lease");
  });

  it("rejects fatal UTF-8 and duplicate keys at every lease object depth", async () => {
    for (const fixture of ["utf8", "top-level", "nested"] as const) {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(root, fixture);
      const lease = discoveryLease(worktree);
      const leasePath = path.join(root, lease.lease_file);
      const serialized = JSON.stringify(lease);
      if (fixture === "utf8") {
        await writeFile(
          leasePath,
          Buffer.concat([
            Buffer.from(serialized.slice(0, -1)),
            Buffer.from([0xff]),
          ]),
        );
      } else if (fixture === "top-level") {
        await writeFile(
          leasePath,
          serialized.replace(
            '"repository":"owner/repo"',
            '"repository":"owner/repo","repository":"owner/repo"',
          ),
        );
      } else {
        await writeFile(
          leasePath,
          serialized.replace(
            '"handoff_file":null',
            '"handoff_file":null,"handoff_file":null',
          ),
        );
      }
      const result = await runDiscovery(root);
      expect(result.disposition, fixture).toBe("invalid");
      expect(result.active[0], fixture).toMatchObject({
        classification: "invalid",
        reason: "invalid-lease",
      });
    }
  });

  it("fails closed on invalid UTF-8 gitlink bytes before status inspection", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "invalid-gitlink-utf8",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const inventoryMarker = path.join(wrapperDir, "inventory-intercepted");
    const statusMarker = path.join(wrapperDir, "status-intercepted");
    const recursiveMarker = path.join(wrapperDir, "recursive-intercepted");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        `if [ -f '${inventoryMarker}' ]; then`,
        '  case " $* " in',
        '    *" status --porcelain=v1 "*)',
        `      printf reached >'${statusMarker}'`,
        "      ;;",
        `    *" -C ${worktree}/invalid-"*)`,
        `      printf reached >'${recursiveMarker}'`,
        "      ;;",
        "  esac",
        "fi",
        'case " $* " in',
        '  *" ls-files --stage -z "*)',
        `    printf reached >'${inventoryMarker}'`,
        `    printf '160000 ${"a".repeat(40)} 0\\tinvalid-'`,
        "    printf '\\377\\0'",
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      expect(await readFile(inventoryMarker, "utf8")).toBe("reached");
      for (const marker of [statusMarker, recursiveMarker]) {
        await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("fails closed on an empty streamed non-gitlink path before status inspection", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(
      root,
      "empty-non-gitlink-path",
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const inventoryMarker = path.join(wrapperDir, "inventory-intercepted");
    const statusMarker = path.join(wrapperDir, "status-intercepted");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        `if [ -f '${inventoryMarker}' ]; then`,
        '  case " $* " in',
        '    *" status --porcelain=v1 "*)',
        `      printf reached >'${statusMarker}'`,
        "      ;;",
        "  esac",
        "fi",
        'case " $* " in',
        '  *" ls-files --stage -z "*)',
        `    printf reached >'${inventoryMarker}'`,
        `    printf '100644 ${"a".repeat(40)} 0\\t\\0'`,
        "    exit 0",
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      expect(await readFile(inventoryMarker, "utf8")).toBe("reached");
      await expect(lstat(statusMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it.each([
    "../outside",
    "/absolute",
    "C:/drive",
    "//server/share",
    ".",
    "nested//module",
    "nested\\module",
    "nested\u0001module",
    "nested\tmodule",
    "nested\u000bmodule",
    "nested\u007fmodule",
  ])(
    "rejects an unsafe streamed gitlink path before status inspection: %j",
    async (gitlinkPath) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(root, "unsafe-gitlink");
      await writeDiscoveryLease(root, discoveryLease(worktree));
      const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
      discoveryTempRoots.push(wrapperDir);
      const inventory = path.join(wrapperDir, "unsafe-inventory");
      const statusMarker = path.join(wrapperDir, "status-intercepted");
      await writeFile(
        inventory,
        Buffer.from(`160000 ${"a".repeat(40)} 0\t${gitlinkPath}\0`, "utf8"),
      );
      const realGit = (
        await execFileAsync("sh", ["-c", "command -v git"])
      ).stdout.trim();
      const wrapper = path.join(wrapperDir, "git");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" status --porcelain=v1 "*)',
          `    printf reached >'${await toGitBashPath(statusMarker)}'`,
          "    ;;",
          '  *" ls-files --stage -z "*)',
          `    cat '${await toGitBashPath(inventory)}'`,
          "    exit 0",
          "    ;;",
          "esac",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await makeDiscoveryGitWrapperExecutable(wrapper);
      const oldPath = process.env.PATH;
      process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
      try {
        const result = await runDiscovery(root);
        expect(result.disposition).toBe("invalid");
        expect(result.active[0]).toMatchObject({
          classification: "invalid",
          reason: "status-inspection-failed",
        });
        await expect(lstat(statusMarker)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        process.env.PATH = oldPath;
      }
    },
  );

  it("rejects a nested gitlink beneath a symlinked ancestor", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "symlink-ancestor");
    const submodule = await createDiscoveryRepository();
    const ancestorTarget = await mkdtemp(
      path.join(tmpdir(), "submodule-parent-"),
    );
    discoveryTempRoots.push(ancestorTarget);
    const externalModule = path.join(ancestorTarget, "module");
    await rename(submodule, externalModule);
    await symlink(
      ancestorTarget,
      path.join(worktree, "nested"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await addDiscoveryGitlink(worktree, externalModule, "nested/module");
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "status-inspection-failed",
    });
  });

  it("rejects a final gitlink symlink", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "symlink-final");
    const submodule = await createDiscoveryRepository();
    await symlink(
      submodule,
      path.join(worktree, "nested"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await addDiscoveryGitlink(worktree, submodule, "nested");
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "status-inspection-failed",
    });
  });

  it("accepts a valid nested initialized submodule authority", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "nested-submodule");
    const submodule = await createDiscoveryRepository();
    await execFileAsync("git", [
      "-C",
      worktree,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "nested/module",
    ]);
    await execFileAsync("git", ["-C", worktree, "commit", "-m", "submodule"]);
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("resume");
    expect(result.resume?.worktree_path).toBe(worktree);
  });

  it("allows an absent nested gitlink suffix after proving safe ancestors", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "absent-submodule");
    const submodule = await createDiscoveryRepository();
    await mkdir(path.join(worktree, "nested"));
    await addDiscoveryGitlink(worktree, submodule, "nested/module");
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.active[0]).toMatchObject({
      classification: "dirty",
      reason: "worktree-dirty",
    });
  });

  it("fails closed when a gitlink component is replaced after status", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "submodule-race");
    const submodule = await createDiscoveryRepository();
    await execFileAsync("git", [
      "-C",
      worktree,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "nested/module",
    ]);
    await execFileAsync("git", ["-C", worktree, "commit", "-m", "submodule"]);
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const replacement = await mkdtemp(path.join(tmpdir(), "replacement-"));
    discoveryTempRoots.push(replacement);
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "git-wrapper-"));
    discoveryTempRoots.push(wrapperDir);
    const marker = path.join(wrapperDir, "component-replaced");
    const realGit = (
      await execFileAsync("sh", ["-c", "command -v git"])
    ).stdout.trim();
    const wrapper = path.join(wrapperDir, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'case " $* " in',
        `  *" -C ${await toGitBashPath(worktree)} status --porcelain=v1 "*)`,
        `    '${realGit}' "$@"`,
        "    status=$?",
        `    if [ ! -f '${await toGitBashPath(marker)}' ]; then`,
        `      mv '${await toGitBashPath(path.join(worktree, "nested"))}' '${await toGitBashPath(path.join(worktree, "nested-original"))}'`,
        `      ln -s '${await toGitBashPath(replacement)}' '${await toGitBashPath(path.join(worktree, "nested"))}'`,
        `      printf fired >'${await toGitBashPath(marker)}'`,
        "    fi",
        '    exit "$status"',
        "    ;;",
        "esac",
        `exec '${realGit}' "$@"`,
        "",
      ].join("\n"),
    );
    await makeDiscoveryGitWrapperExecutable(wrapper);
    const oldPath = process.env.PATH;
    process.env.PATH = prependDiscoveryGitWrapper(wrapperDir, oldPath);
    try {
      const result = await runDiscovery(root);
      expect(await readFile(marker, "utf8")).toBe("fired");
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "worktree-replaced",
      });
    } finally {
      process.env.PATH = oldPath;
    }
  });

  describe.each(["clean", "process", "include", "attributes"] as const)(
    "executable %s authority",
    (fixture) => {
      let marker: string;
      let root: string;

      beforeEach(async () => {
        root = await createDiscoveryRepository();
        const worktree = await createDiscoveryWorktree(
          root,
          `authority-${fixture}`,
        );
        await writeDiscoveryLease(root, discoveryLease(worktree));
        marker = path.join(root, `${fixture}-executed`);
        if (fixture === "clean" || fixture === "process") {
          await execFileAsync("git", [
            "-C",
            worktree,
            "config",
            `filter.discovery.${fixture}`,
            `printf executed >"${marker}"`,
          ]);
        } else if (fixture === "include") {
          const included = path.join(root, "included.gitconfig");
          await writeFile(
            included,
            `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
          );
          await execFileAsync("git", [
            "-C",
            root,
            "config",
            "extensions.worktreeConfig",
            "true",
          ]);
          await execFileAsync("git", [
            "-C",
            worktree,
            "config",
            "--worktree",
            "include.path",
            included,
          ]);
        } else {
          const identity = (
            await execFileAsync("git", [
              "-C",
              worktree,
              "rev-parse",
              "--git-common-dir",
            ])
          ).stdout.trim();
          const commonDirectory = path.isAbsolute(identity)
            ? identity
            : path.resolve(worktree, identity);
          const external = path.join(root, "external-attributes");
          await writeFile(external, "* filter=discovery\n");
          await mkdir(path.join(commonDirectory, "info"), { recursive: true });
          await symlink(
            external,
            path.join(commonDirectory, "info", "attributes"),
          );
        }
      });

      it("fails closed before it can run", async () => {
        const result = await runDiscovery(root);
        expect(result.disposition, fixture).toBe("invalid");
        expect(result.active[0], fixture).toMatchObject({
          classification: "invalid",
          reason: "status-inspection-failed",
        });
        await expect(lstat(marker), fixture).rejects.toMatchObject({
          code: "ENOENT",
        });
      });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "rejects candidate includeIf authority containing %j before status",
    async (separator) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        "candidate-separator-include",
      );
      const marker = path.join(root, "candidate-separator-include-executed");
      const included = path.join(
        root,
        "candidate-separator-included.gitconfig",
      );
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "extensions.worktreeConfig",
        "true",
      ]);
      await execFileAsync("git", [
        "-C",
        worktree,
        "config",
        "--worktree",
        `includeIf.gitdir:**[!${separator}]**.path`,
        included,
      ]);
      await writeDiscoveryLease(root, discoveryLease(worktree));

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(["\u2028", "\u2029"])(
    "rejects initialized-submodule includeIf authority containing %j before status",
    async (separator) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        "submodule-separator-include",
      );
      const submodule = await createDiscoveryRepository();
      await execFileAsync("git", [
        "-C",
        worktree,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        submodule,
        "nested",
      ]);
      await execFileAsync("git", ["-C", worktree, "commit", "-m", "submodule"]);
      const marker = path.join(root, "submodule-separator-include-executed");
      const included = path.join(
        root,
        "submodule-separator-included.gitconfig",
      );
      await writeFile(
        included,
        `[filter "discovery"]\n\tprocess = printf executed >"${marker}"\n`,
      );
      await execFileAsync("git", [
        "-C",
        path.join(worktree, "nested"),
        "config",
        `includeIf.gitdir:**[!${separator}]**.path`,
        included,
      ]);
      await writeDiscoveryLease(root, discoveryLease(worktree));

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(
    ["\u2028", "\u2029"].flatMap((separator) =>
      (["clean", "process"] as const).map(
        (filterKind) => [separator, filterKind] as const,
      ),
    ),
  )(
    "rejects candidate filter authority containing %j for %s before status",
    async (separator, filterKind) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `candidate-separator-${filterKind}`,
      );
      const driver = `discovery${separator}driver`;
      await writeFile(
        path.join(worktree, ".gitattributes"),
        `README.md filter=${driver}\n`,
      );
      await execFileAsync("git", ["-C", worktree, "add", ".gitattributes"]);
      await execFileAsync("git", [
        "-C",
        worktree,
        "commit",
        "-m",
        "attributes",
      ]);
      const marker = path.join(
        root,
        `candidate-separator-${filterKind}-executed`,
      );
      await execFileAsync("git", [
        "-C",
        worktree,
        "config",
        `filter.${driver}.${filterKind}`,
        `printf executed >"${marker}"`,
      ]);
      await writeDiscoveryLease(root, discoveryLease(worktree));

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(
    ["\u2028", "\u2029"].flatMap((separator) =>
      (["clean", "process"] as const).map(
        (filterKind) => [separator, filterKind] as const,
      ),
    ),
  )(
    "rejects initialized-submodule filter authority containing %j for %s before status",
    async (separator, filterKind) => {
      const root = await createDiscoveryRepository();
      const worktree = await createDiscoveryWorktree(
        root,
        `submodule-separator-${filterKind}`,
      );
      const submodule = await createDiscoveryRepository();
      await execFileAsync("git", [
        "-C",
        worktree,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        submodule,
        "nested",
      ]);
      const initializedSubmodule = path.join(worktree, "nested");
      const driver = `discovery${separator}driver`;
      await writeFile(
        path.join(initializedSubmodule, ".gitattributes"),
        `README.md filter=${driver}\n`,
      );
      await execFileAsync("git", [
        "-C",
        initializedSubmodule,
        "add",
        ".gitattributes",
      ]);
      await execFileAsync("git", [
        "-C",
        initializedSubmodule,
        "commit",
        "-m",
        "attributes",
      ]);
      await execFileAsync("git", ["-C", worktree, "add", "nested"]);
      await execFileAsync("git", ["-C", worktree, "commit", "-m", "submodule"]);
      const marker = path.join(
        root,
        `submodule-separator-${filterKind}-executed`,
      );
      await execFileAsync("git", [
        "-C",
        initializedSubmodule,
        "config",
        `filter.${driver}.${filterKind}`,
        `printf executed >"${marker}"`,
      ]);
      await writeDiscoveryLease(root, discoveryLease(worktree));

      const result = await runDiscovery(root);
      expect(result.disposition).toBe("invalid");
      expect(result.active[0]).toMatchObject({
        classification: "invalid",
        reason: "status-inspection-failed",
      });
      await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("fails closed on executable filter authority in an initialized submodule", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "submodule-filter");
    const submodule = await createDiscoveryRepository();
    await execFileAsync("git", [
      "-C",
      worktree,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "nested",
    ]);
    await execFileAsync("git", ["-C", worktree, "commit", "-m", "submodule"]);
    const marker = path.join(root, "submodule-filter-executed");
    await execFileAsync("git", [
      "-C",
      path.join(worktree, "nested"),
      "config",
      "filter.discovery.process",
      `printf executed >"${marker}"`,
    ]);
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("invalid");
    expect(result.active[0]).toMatchObject({
      classification: "invalid",
      reason: "status-inspection-failed",
    });
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reaches production dirtiness with a platform-realizable unusual gitlink path", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "newline-submodule");
    const submodule = await createDiscoveryRepository();
    const gitlinkPath =
      process.platform === "win32" ? "nested-모듈" : "nested\nmodule";
    const submoduleHead = (
      await execFileAsync("git", ["-C", submodule, "rev-parse", "HEAD"])
    ).stdout.trim();
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        "git",
        ["-C", worktree, "update-index", "-z", "--index-info"],
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
      if (child.stdin === null) {
        child.kill();
        reject(new Error("git update-index stdin is unavailable"));
        return;
      }
      child.stdin.end(`160000 ${submoduleHead}\t${gitlinkPath}\0`);
    });
    const stagedGitlinks = (
      await execFileAsync("git", ["-C", worktree, "ls-files", "--stage", "-z"])
    ).stdout;
    expect(stagedGitlinks).toContain(
      `160000 ${submoduleHead} 0\t${gitlinkPath}\0`,
    );
    await writeDiscoveryLease(root, discoveryLease(worktree));

    const result = await runDiscovery(root);
    expect(result.disposition).toBe("cleanup-required");
    expect(result.active[0]).toMatchObject({
      classification: "dirty",
      reason: "worktree-dirty",
    });
  });

  it("does not mutate filesystem contents or Git registrations", async () => {
    const root = await createDiscoveryRepository();
    const worktree = await createDiscoveryWorktree(root, "readonly");
    await writeDiscoveryLease(root, discoveryLease(worktree));
    const beforeFiles = await readdir(path.join(root, ".ephemeral"));
    const beforeRegistrations = (
      await execFileAsync("git", [
        "-C",
        root,
        "worktree",
        "list",
        "--porcelain",
        "-z",
      ])
    ).stdout;
    const beforeStat = await lstat(path.join(root, ".ephemeral"));
    await runDiscovery(root);
    expect(await readdir(path.join(root, ".ephemeral"))).toEqual(beforeFiles);
    expect(
      (
        await execFileAsync("git", [
          "-C",
          root,
          "worktree",
          "list",
          "--porcelain",
          "-z",
        ])
      ).stdout,
    ).toBe(beforeRegistrations);
    expect((await lstat(path.join(root, ".ephemeral"))).ino).toBe(
      beforeStat.ino,
    );
  });
});

describe("pr-review discovery wrapper resolution", () => {
  async function writeSyntheticBootstrapRuntime(
    runtimeDir: string,
    mode: "arguments" | "transport",
  ): Promise<{
    resolverSentinel: string;
    typedSentinel: string;
  }> {
    const script = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const typedEntrypoint = path.join(
      runtimeDir,
      "scripts",
      "runtime",
      "cli.js",
    );
    const resolverSentinel = path.join(
      path.dirname(runtimeDir),
      "resolver-executed",
    );
    const typedSentinel = path.join(path.dirname(runtimeDir), "typed-executed");
    await mkdir(path.dirname(typedEntrypoint), { recursive: true });
    const shellTransport =
      mode === "transport"
        ? [
            'for argument in "$@"; do',
            "  printf '<%s>' \"$argument\"",
            "done",
            "printf '\\nstdin:'",
            "cat",
          ]
        : ['printf "%s\\n" "$*"'];
    await writeFile(
      script,
      [
        "#!/usr/bin/env bash",
        'if [ "${1:-}" = "resolve-entrypoint" ]; then',
        '  printf "%s\\n" "$0"',
        "  exit 0",
        "fi",
        'printf "executed\\n" >"$DEVCANON_TEST_RESOLVER_SENTINEL"',
        ...shellTransport,
        "",
      ].join("\n"),
    );
    await chmod(script, 0o755);
    const typedTransport =
      mode === "transport"
        ? [
            'for (const argument of ["runtime", ...process.argv.slice(2)]) {',
            "  process.stdout.write(`<${argument}>`);",
            "}",
            'process.stdout.write("\\nstdin:");',
            "process.stdin.pipe(process.stdout);",
          ]
        : [
            'process.stdout.write(`runtime ${process.argv.slice(2).join(" ")}\\n`);',
          ];
    await writeFile(
      typedEntrypoint,
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.DEVCANON_TEST_TYPED_SENTINEL, "executed\\n");',
        ...typedTransport,
        "",
      ].join("\n"),
    );
    await chmod(typedEntrypoint, 0o755);
    return { resolverSentinel, typedSentinel };
  }

  async function expectSyntheticBootstrapExecution(
    resolverSentinel: string,
    typedSentinel: string,
  ): Promise<void> {
    const executedSentinel =
      process.platform === "win32" ? typedSentinel : resolverSentinel;
    const idleSentinel =
      process.platform === "win32" ? resolverSentinel : typedSentinel;
    expect(await readFile(executedSentinel, "utf8")).toBe("executed\n");
    await expect(readFile(idleSentinel, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(executedSentinel);
  }

  it.each([["unexpected"], ["unexpected", "second"]])(
    "forwards and rejects unexpected discover positional arguments: %j",
    async (...unexpectedArguments) => {
      const outcome = await new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          "bash",
          [
            "skills/pr-review/scripts/review-leases.sh",
            "discover",
            ...unexpectedArguments,
          ],
          {
            cwd: originalCwd,
            env: {
              ...process.env,
              DEVCANON_RUNTIME_DIR: path.resolve("skills/devcanon-runtime"),
            },
          },
          (error, stdout, stderr) => {
            resolve({
              exitCode:
                error === null
                  ? 0
                  : typeof error.code === "number"
                    ? error.code
                    : 1,
              stdout,
              stderr,
            });
          },
        );
      });

      expect(outcome).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "discover does not accept positional arguments\n",
      });
    },
  );

  it("accepts only a contained packaged runtime directory override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lease-wrapper-runtime-"));
    discoveryTempRoots.push(root);
    const runtimeDir = path.join(root, "devcanon-runtime");
    const { resolverSentinel, typedSentinel } =
      await writeSyntheticBootstrapRuntime(runtimeDir, "arguments");

    for (const override of [runtimeDir, `${runtimeDir}/.`]) {
      const { stdout } = await execFileAsync(
        "bash",
        ["skills/pr-review/scripts/review-leases.sh", "discover"],
        {
          cwd: originalCwd,
          env: {
            ...process.env,
            DEVCANON_RUNTIME_DIR: override,
            DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
            DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
          },
        },
      );

      expect(stdout.trim()).toBe("runtime pr-review-leases discover");
      await expectSyntheticBootstrapExecution(resolverSentinel, typedSentinel);
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves a newline-terminated packaged runtime directory",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "lease-wrapper-newline-"));
      discoveryTempRoots.push(root);
      const runtimeDir = path.join(root, "devcanon-runtime\n");
      const { resolverSentinel, typedSentinel } =
        await writeSyntheticBootstrapRuntime(runtimeDir, "arguments");

      const { stdout } = await execFileAsync(
        "bash",
        ["skills/pr-review/scripts/review-leases.sh", "discover"],
        {
          cwd: originalCwd,
          env: {
            ...process.env,
            DEVCANON_RUNTIME_DIR: runtimeDir,
            DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
            DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
          },
        },
      );

      expect(stdout.trim()).toBe("runtime pr-review-leases discover");
      await expectSyntheticBootstrapExecution(resolverSentinel, typedSentinel);
    },
  );

  it("transports validate-discovery stdin and arguments without reconstruction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lease-wrapper-transport-"));
    discoveryTempRoots.push(root);
    const runtimeDir = path.join(root, "devcanon-runtime");
    const marker = path.join(root, "must-not-execute");
    const { resolverSentinel, typedSentinel } =
      await writeSyntheticBootstrapRuntime(runtimeDir, "transport");
    const primaryRoot = `C:\\repo with spaces\\$(touch ${marker})`;
    const input = '{"schema":"transport-only"}';
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "bash",
        [
          "skills/pr-review/scripts/review-leases.sh",
          "validate-discovery",
          "--repository",
          "owner/repo",
          "--pr-number",
          "432",
          "--primary-root",
          primaryRoot,
        ],
        {
          cwd: originalCwd,
          env: {
            ...process.env,
            DEVCANON_RUNTIME_DIR: runtimeDir,
            DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
            DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
          },
        },
        (error, output) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(output);
        },
      );
      child.stdin?.end(input);
    });
    expect(stdout).toBe(
      `<runtime><pr-review-leases><validate-discovery><--repository><owner/repo><--pr-number><432><--primary-root><${primaryRoot}>\nstdin:${input}`,
    );
    await expectSyntheticBootstrapExecution(resolverSentinel, typedSentinel);
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects direct-file and symlink runtime overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lease-wrapper-unsafe-"));
    discoveryTempRoots.push(root);
    const direct = path.join(root, "runtime.sh");
    await writeFile(direct, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(direct, 0o755);
    const linked = path.join(root, "linked-runtime");
    await symlink(path.resolve("skills/devcanon-runtime"), linked, "dir");

    for (const override of [
      direct,
      linked,
      `${linked}/`,
      `${linked}/.`,
      `${linked}/scripts/..`,
    ]) {
      await expect(
        execFileAsync(
          "bash",
          ["skills/pr-review/scripts/review-leases.sh", "discover"],
          {
            cwd: originalCwd,
            env: { ...process.env, DEVCANON_RUNTIME_DIR: override },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects newline-terminated symlink runtime overrides",
    async () => {
      const root = await mkdtemp(
        path.join(tmpdir(), "lease-wrapper-newline-link-"),
      );
      discoveryTempRoots.push(root);
      const linked = path.join(root, "linked-runtime\n");
      await symlink(path.resolve("skills/devcanon-runtime"), linked, "dir");

      for (const override of [linked, `${linked}/`, `${linked}/.`]) {
        await expect(
          execFileAsync(
            "bash",
            ["skills/pr-review/scripts/review-leases.sh", "discover"],
            {
              cwd: originalCwd,
              env: { ...process.env, DEVCANON_RUNTIME_DIR: override },
            },
          ),
        ).rejects.toMatchObject({ code: 1 });
      }
    },
  );

  describe("managed sibling symlink layout", () => {
    let bashInstalledWrapper: string;
    let environment: NodeJS.ProcessEnv;
    let fixture:
      | Awaited<ReturnType<typeof createRuntimeConformanceFixture>>
      | undefined;
    let repositoryRoot: string;
    let worktree: string;

    beforeAll(async () => {
      fixture = await createRuntimeConformanceFixture({
        consumerName: "pr-review",
        adapterRelPath: "scripts/review-leases.sh",
        adapterContent: await readFile(
          path.resolve("skills/pr-review/scripts/review-leases.sh"),
        ),
      });
      await renderRuntimeConformanceFixture(fixture);
      const syncResult = await syncRuntimeConformanceFixture(
        fixture,
        "symlink",
      );
      expect(syncResult.errors).toEqual([]);
      const installedWrapper = fixture.installedAdapterPath("codex");
      const installedConsumerDirectory = path.dirname(
        path.dirname(installedWrapper),
      );
      expect((await lstat(installedConsumerDirectory)).isSymbolicLink()).toBe(
        true,
      );
      const physicalWrapper = await realpath(installedWrapper);
      bashInstalledWrapper = await toGitBashPath(installedWrapper);
      expect(physicalWrapper).not.toBe(installedWrapper);
      expect(bashInstalledWrapper).not.toBe("");

      repositoryRoot = await createDiscoveryRepository();
      worktree = await createDiscoveryWorktree(
        repositoryRoot,
        "installed-wrapper",
      );
      environment = {
        ...process.env,
        DEVCANON_RUNTIME_DIR: undefined,
        REPOSITORY: "owner/repo",
        PR_NUMBER: "432",
        PRIMARY_REPOSITORY_ROOT: repositoryRoot,
        WORKTREE_PATH: worktree,
      };
    });

    afterAll(async () => {
      await fixture?.cleanup();
    });

    it("resolves discovery and existing commands", async () => {
      const discovery = await execFileAsync(
        "bash",
        [bashInstalledWrapper, "discover"],
        { cwd: repositoryRoot, env: environment },
      );
      expect(JSON.parse(discovery.stdout)).toMatchObject({
        schema: "pr-review/discovery/v1",
        disposition: "create",
      });
      const derived = await execFileAsync(
        "bash",
        [bashInstalledWrapper, "derive-path"],
        { cwd: repositoryRoot, env: environment },
      );
      expect(derived.stdout.trim()).toBe(discoveryLease(worktree).lease_file);
    });
  });

  it("does not select an ambient PATH runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lease-wrapper-path-"));
    discoveryTempRoots.push(root);
    const marker = path.join(root, "executed");
    const fake = path.join(root, "devcanon-runtime.sh");
    await writeFile(
      fake,
      `#!/usr/bin/env bash\nprintf used >"${marker}"\nexit 0\n`,
    );
    await chmod(fake, 0o755);

    await expect(
      execFileAsync(
        "bash",
        ["skills/pr-review/scripts/review-leases.sh", "discover"],
        {
          cwd: originalCwd,
          env: {
            ...process.env,
            PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
            REPOSITORY: "",
          },
        },
      ),
    ).rejects.toBeDefined();
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function postedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
  approvedReviewFile,
  validatedPayloadFile = null,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  approvedReviewFile: string;
  validatedPayloadFile?: string | null;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "posted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:03:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: approvedReviewFile,
      validated_payload_file: validatedPayloadFile,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: "2026-06-11T00:03:00Z", reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: true,
      github_post_result: "succeeded",
      github_posted_at: "2026-06-11T00:03:00Z",
    },
  };
}

async function writeReviewHelperScripts(tempRoot: string): Promise<{
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}> {
  const skillsRoot = path.join(tempRoot, "skills");
  const prReviewDir = path.join(skillsRoot, "pr-review");
  const prReviewScripts = path.join(prReviewDir, "scripts");
  const playReviewScripts = path.join(skillsRoot, "play-review", "scripts");
  await mkdir(prReviewScripts, { recursive: true });
  await mkdir(playReviewScripts, { recursive: true });
  const scopeHelper = path.join(prReviewScripts, "prior-thread-artifacts.sh");
  const prReviewManifestHelperScript = path.join(
    prReviewScripts,
    "review-manifests.sh",
  );
  const prReviewLeaseHelperScript = path.join(
    prReviewScripts,
    "review-leases.sh",
  );
  const playReviewHelper = path.join(playReviewScripts, "review-artifacts.sh");
  const passThrough = "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n";
  const approvedReviewHelper = path.join(
    prReviewScripts,
    "approved-review-artifacts.sh",
  );
  await writeFile(scopeHelper, passThrough);
  await writeFile(prReviewManifestHelperScript, passThrough);
  await writeFile(prReviewLeaseHelperScript, passThrough);
  await writeFile(
    approvedReviewHelper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'command_name="${1:-}"',
      'if [ "$command_name" = "inspect-approved-review-ownership" ]; then',
      '  jq -cn --arg review_body_file ".ephemeral/pr-${PR_NUMBER}-${HEAD_SHA}-review-body.md" --arg review_payload_file ".ephemeral/review-topic-${HEAD_SHA}-review-payload.json" \'{review_body_file: $review_body_file, review_payload_file: $review_payload_file}\'',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await writeFile(playReviewHelper, passThrough);
  await chmod(scopeHelper, 0o755);
  await chmod(prReviewManifestHelperScript, 0o755);
  await chmod(prReviewLeaseHelperScript, 0o755);
  await chmod(approvedReviewHelper, 0o755);
  await chmod(playReviewHelper, 0o755);
  return {
    prReviewDir,
    prReviewManifestHelperScript,
    prReviewLeaseHelperScript,
    playReviewHelper,
  };
}

async function writeResultArtifact(
  worktree: string,
  physicalWorktree: string,
  resultFile: string,
  reviewHead: string,
  presentationStatus:
    | "not-presented"
    | "preview-current"
    | "edited" = "preview-current",
  includeSharedContext = false,
): Promise<{ findingsFile: string }> {
  const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;
  const findingsFile = `.ephemeral/review-topic-${reviewHead}-findings.json`;
  const reviewBodyFile = `.ephemeral/pr-432-${reviewHead}-review-body.md`;
  const scopeDecisionFile = ".ephemeral/review-topic-scope-decision.json";
  const providerScopeEvidenceFile = `.ephemeral/review-topic-${reviewHead}-provider-scope-evidence.json`;
  const providerPrDiffRange = `${reviewHead}..${reviewHead}`;
  await writeFile(
    path.join(worktree, providerScopeEvidenceFile),
    `${JSON.stringify(
      {
        schema: "pr-review/provider-scope-evidence/v2",
        provider: "github",
        repository: "owner/repo",
        pr_number: 432,
        baseRefOid: reviewHead,
        headRefOid: reviewHead,
        provider_pr_diff_base_sha: reviewHead,
        local_review_head_sha: reviewHead,
        full_pr_diff_range: providerPrDiffRange,
        evidence_complete: true,
        digest_provenance: {
          schema: "pr-review/digest-provenance/v1",
          provider_diff: "canonical-git-diff/v1",
          local_diff: "canonical-git-diff/v1",
          provider_patches: "canonical-git-diff/v1",
          local_patches: "canonical-git-diff/v1",
        },
        provider_files: [],
        local_files: [],
        provider_diff_sha256: "0".repeat(64),
        local_diff_sha256: "0".repeat(64),
      },
      null,
      2,
    )}\n`,
  );
  const providerScopeEvidenceSha256 = await sha256File(
    path.join(worktree, providerScopeEvidenceFile),
  );
  const scopeDecision = {
    head_sha: reviewHead,
    selected_range: providerPrDiffRange,
    full_range: providerPrDiffRange,
    language_hints: [],
    mode: "initial",
    is_followup_narrow: false,
    last_reviewed_sha: null,
    selection_reason: "Initial review scope.",
    prior_context: { kind: "none", path: null },
    artifacts: {
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, scopeDecisionFile),
    `${JSON.stringify(scopeDecision, null, 2)}\n`,
  );
  await writeFile(
    path.join(worktree, findingsFile),
    `${JSON.stringify({ findings: [], carry_forward: [] }, null, 2)}\n`,
  );
  await writeFile(path.join(worktree, reviewBodyFile), "Review preview.\n");
  const sharedContext = includeSharedContext
    ? await writeSharedContextFamily(
        physicalWorktree,
        findingsFile,
        reviewHead,
        providerPrDiffRange,
      )
    : null;
  const handoff = {
    schema: "pr-review/handoff/v1",
    pr_number: 432,
    repository: "owner/repo",
    execution: {
      kind: "review-worktree",
      working_directory: physicalWorktree,
    },
    base_ref: "main",
    head_ref: "topic",
    review_scope_base_ref: reviewHead,
    active_diff_range: providerPrDiffRange,
    full_pr_diff_range: providerPrDiffRange,
    review_head_sha: reviewHead,
    mode: "github-post",
    language_hints: [],
    follow_up: {
      state: "initial",
      last_reviewed_sha: null,
      is_followup_narrow: false,
    },
    artifacts: {
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, handoffFile),
    `${JSON.stringify(handoff, null, 2)}\n`,
  );
  const result = {
    schema: "pr-review/result/v1",
    repository: "owner/repo",
    pr_number: 432,
    review_head_sha: reviewHead,
    findings_file: findingsFile,
    review_body_file: reviewBodyFile,
    context_file: sharedContext?.contextFile ?? null,
    artifacts: {
      handoff_file: handoffFile,
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      rendered_preview_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
    },
    digests: {
      handoff_sha256: await sha256File(path.join(worktree, handoffFile)),
      findings_sha256: await sha256File(path.join(worktree, findingsFile)),
      review_body_sha256: await sha256File(path.join(worktree, reviewBodyFile)),
      context_sha256: sharedContext?.contextSha256 ?? null,
      scope_decision_sha256: await sha256File(
        path.join(worktree, scopeDecisionFile),
      ),
      prior_threads_sha256: null,
      rendered_preview_sha256: null,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
    scope_decision: {
      summary: "Initial review scope.",
      selected_range: providerPrDiffRange,
      full_range: providerPrDiffRange,
      is_followup_narrow: false,
    },
    presentation: { status: presentationStatus, notes: null },
    validation: {
      status: "valid",
      findings_validated: true,
      scope_decision_validated: true,
    },
  };
  await writeFile(
    path.join(worktree, resultFile),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { findingsFile };
}

async function writeSharedContextFamily(
  physicalWorktree: string,
  findingsFile: string,
  reviewHead: string,
  diffRange: string,
): Promise<{ contextFile: string; contextSha256: string }> {
  const priorCwd = process.cwd();
  const contextEnv = [
    "HEAD_SHA",
    "FINDINGS_FILE",
    "REVIEW_CONTEXT_INPUT_FILE",
    "REVIEW_CONTEXT_INPUT_JSON",
  ] as const;
  const priorEnv = new Map(contextEnv.map((key) => [key, process.env[key]]));

  try {
    process.chdir(physicalWorktree);
    process.env.HEAD_SHA = reviewHead;
    process.env.FINDINGS_FILE = findingsFile;
    process.env.REVIEW_CONTEXT_INPUT_JSON = JSON.stringify({
      schema: "play-review/shared-context-input/v1",
      header: {
        working_directory: physicalWorktree,
        base_ref: "main",
        head_sha: reviewHead,
        active_diff_range: diffRange,
        full_pr_diff_range: diffRange,
        mode: "github-post",
        language_hints: [],
      },
      changed_files: {
        command: "fixture",
        total_count: 0,
        truncated: false,
        records: [],
      },
      doc_impact_summary: {
        arch_files: [],
        new_adrs: [],
        modified_adrs: [],
        architecture_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        spec_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        notes: "fixture",
      },
      adr_references: [],
      discovered_guidelines: { records: [] },
      output_format: { markdown: "fixture" },
      prior_review_context: null,
    });
    const input = await runPlayReviewSharedContextCommand([
      "write-review-context-input",
    ]);
    if (input.exitCode !== 0) {
      throw new Error(input.stderr);
    }
    process.env.REVIEW_CONTEXT_INPUT_FILE = input.stdout.trim();
    const output = await runPlayReviewSharedContextCommand([
      "build-review-context",
    ]);
    if (output.exitCode !== 0) {
      throw new Error(output.stderr);
    }
    const contextFile = output.stdout.trim();
    return {
      contextFile,
      contextSha256: await sha256File(path.join(physicalWorktree, contextFile)),
    };
  } finally {
    process.chdir(priorCwd);
    for (const [key, value] of priorEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function writeApprovedReviewArtifact(
  worktree: string,
  approvedReviewFile: string,
  reviewHead: string,
): Promise<void> {
  await writeFile(
    path.join(worktree, approvedReviewFile),
    `${JSON.stringify({
      schema: "pr-review/approved-review/v1",
      review_head_sha: reviewHead,
      review_body_file: `.ephemeral/pr-432-${reviewHead}-review-body.md`,
      payload: reviewPayload(reviewHead),
    })}\n`,
  );
}

async function writeValidatedPayloadArtifact(
  worktree: string,
  reviewHead: string,
): Promise<string> {
  const validatedPayloadFile = `.ephemeral/pr-432-${reviewHead}-validated-review-payload.json`;
  await writeFile(
    path.join(worktree, validatedPayloadFile),
    `${JSON.stringify(reviewPayload(reviewHead))}\n`,
  );
  return validatedPayloadFile;
}

function reviewPayload(reviewHead: string): Record<string, unknown> {
  return {
    commit_id: reviewHead,
    event: "COMMENT",
    body: "Review body\n",
    comments: [],
  };
}

function omitKey<T extends object, K extends keyof T>(
  object: T,
  key: K,
): Omit<T, K> {
  const { [key]: _omitted, ...rest } = object;
  return rest;
}

function reviewedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
  resultFile: string,
  resultSha256: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "reviewed",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:01:00Z",
        sha256: resultSha256,
      },
    },
    presentation: { presented_at: null, status: null },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function gatedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "gated",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:02:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

describe("pr-review lease wrapper trusted runtime bootstrap", () => {
  const wrapper = path.resolve("skills/pr-review/scripts/review-leases.sh");

  async function writeRuntime(
    root: string,
    directoryName: string,
  ): Promise<{
    runtimeDir: string;
    resolverSentinel: string;
    typedSentinel: string;
  }> {
    const runtimeDir = path.join(root, directoryName);
    const scriptsDir = path.join(runtimeDir, "scripts");
    const typedRuntimeDir = path.join(scriptsDir, "runtime");
    const resolverSentinel = path.join(
      root,
      `${directoryName.length}-resolver-executed`,
    );
    const typedSentinel = path.join(
      root,
      `${directoryName.length}-typed-executed`,
    );
    await mkdir(typedRuntimeDir, { recursive: true });
    const resolver = path.join(scriptsDir, "devcanon-runtime.sh");
    await writeFile(
      resolver,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'case "${1:-}" in',
        "  runtime)",
        "    printf 'executed\\n' >\"$DEVCANON_TEST_RESOLVER_SENTINEL\"",
        "    printf 'runtime-ok\\n'",
        "    ;;",
        "  *) exit 64 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(resolver, 0o755);
    await writeFile(
      path.join(typedRuntimeDir, "cli.js"),
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.DEVCANON_TEST_TYPED_SENTINEL, "executed\\n");',
        'process.stdout.write("runtime-ok\\n");',
        "",
      ].join("\n"),
    );
    return { runtimeDir, resolverSentinel, typedSentinel };
  }

  async function runWrapper(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
      execFile(
        bashExecutable,
        [wrapper, "derive-path"],
        {
          env: {
            ...process.env,
            DEVCANON_RUNTIME_DIR: runtimeDir,
            DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
            DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
          },
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              error === null
                ? 0
                : typeof error.code === "number"
                  ? error.code
                  : 1,
            stdout,
            stderr,
          });
        },
      );
    });
  }

  async function expectAccepted(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: "runtime-ok\n",
      stderr: "",
    });
    const executedSentinel =
      process.platform === "win32" ? typedSentinel : resolverSentinel;
    const idleSentinel =
      process.platform === "win32" ? resolverSentinel : typedSentinel;
    expect(await readFile(executedSentinel, "utf8")).toBe("executed\n");
    await expect(readFile(idleSentinel, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(executedSentinel);
  }

  async function expectRejected(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    expectedStderr: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${expectedStderr}\n`,
    });
    for (const sentinel of [resolverSentinel, typedSentinel]) {
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  }

  it.runIf(process.platform !== "win32")(
    "preserves POSIX backslashes, line feeds, and valid dot aliases despite a poisoned OSTYPE",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "review-leases-posix-"));
      try {
        const ordinary = await writeRuntime(root, "ordinary-runtime");
        await expectAccepted(
          ordinary.runtimeDir,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );
        await expectAccepted(
          `${ordinary.runtimeDir}/.`,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );

        const literalBackslashes = await writeRuntime(
          root,
          "literal\\..\\runtime",
        );
        await expectAccepted(
          literalBackslashes.runtimeDir,
          literalBackslashes.resolverSentinel,
          literalBackslashes.typedSentinel,
        );

        const lineFeed = await writeRuntime(root, "line-feed-runtime\n");
        await expectAccepted(
          lineFeed.runtimeDir,
          lineFeed.resolverSentinel,
          lineFeed.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects POSIX traversal and final symlink aliases before resolver execution",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "review-leases-link-"));
      try {
        const target = await writeRuntime(root, "target-runtime");
        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(target.runtimeDir, linkedRuntime);
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          linkedRuntime,
          `${linkedRuntime}/`,
          `${linkedRuntime}/.`,
        ]) {
          await expectRejected(
            spelling,
            target.resolverSentinel,
            target.typedSentinel,
            containmentError,
          );
        }
        await expectRejected(
          `${linkedRuntime}/scripts/..`,
          target.resolverSentinel,
          target.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "preserves the logical macOS /var ancestor alias",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "review-leases-alias-"));
      try {
        const fixture = await writeRuntime(root, "runtime");
        const logicalRoot = root.startsWith("/private/var/")
          ? root.replace(/^\/private\/var\//u, "/var/")
          : root;
        const logicalRuntime = path.join(logicalRoot, "runtime");
        await expectAccepted(
          logicalRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "uses Git-for-Windows Bash capability for native and mixed-separator containment",
    async () => {
      const bashExecutable = await resolveGitForWindowsBash();
      const { stdout: windowsPwd } = await execFileAsync(bashExecutable, [
        "-lc",
        "builtin pwd -W",
      ]);
      expect(Buffer.byteLength(windowsPwd, "utf8")).toBeLessThanOrEqual(65_536);
      const windowsPwdRecord = /^([^\r\n]+)\r?\n$/u.exec(windowsPwd);
      expect(windowsPwdRecord).not.toBeNull();
      const reportedWindowsCwd = windowsPwdRecord?.[1] ?? "";
      expect(path.win32.isAbsolute(reportedWindowsCwd)).toBe(true);
      expect(path.win32.normalize(reportedWindowsCwd).toLowerCase()).toBe(
        path.win32.normalize(process.cwd()).toLowerCase(),
      );

      const root = await mkdtemp(path.join(tmpdir(), "review-leases-windows-"));
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        await expectAccepted(
          native,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
        await expectAccepted(
          `${native}\\.`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );

        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(fixture.runtimeDir, linkedRuntime, "junction");
        const { stdout: nativeLinkOutput } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: linkedRuntime,
            },
          },
        );
        const nativeLink = nativeLinkOutput.trim();
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          nativeLink,
          `${nativeLink}\\`,
          `${nativeLink}\\.`,
          `${nativeLink.replace(/\\/gu, "/")}\\`,
        ]) {
          await expectRejected(
            spelling,
            fixture.resolverSentinel,
            fixture.typedSentinel,
            containmentError,
            bashExecutable,
          );
        }
        await expectRejected(
          `${nativeLink}\\scripts/..`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
        await expectRejected(
          "\\\\?\\UNC\\localhost\\unavailable\\linked\\scripts\\..",
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "runs URL-representable real UNC runtime containment or reports the unavailable capability",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await mkdtemp(
        path.join(tmpdir(), "review-leases-windows-unc-"),
      );
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const computerName = process.env.COMPUTERNAME?.trim() ?? "";
        if (
          computerName.length === 0 ||
          computerName.toLowerCase() === "localhost"
        ) {
          skip(
            "UNC runtime integration unavailable: COMPUTERNAME does not provide a non-special host",
          );
        }
        const uncRuntime = `\\\\${computerName}\\${drive}$${native.slice(2)}`;
        try {
          await realpath(uncRuntime);
        } catch {
          skip(
            "UNC runtime integration unavailable: machine-name administrative drive share is not accessible",
          );
        }
        const physicalTypedEntrypoint = await realpath(
          path.win32.join(uncRuntime, "scripts", "runtime", "cli.js"),
        );
        const typedEntrypointUrl = pathToFileURL(physicalTypedEntrypoint);
        expect(typedEntrypointUrl.hostname.toLowerCase()).toBe(
          computerName.toLowerCase(),
        );
        expect(
          path.win32.normalize(fileURLToPath(typedEntrypointUrl)).toLowerCase(),
        ).toBe(path.win32.normalize(physicalTypedEntrypoint).toLowerCase());
        await expectAccepted(
          uncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects an accessible localhost UNC runtime before resolver or typed entrypoint execution",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await mkdtemp(
        path.join(tmpdir(), "review-leases-windows-localhost-unc-"),
      );
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const localhostUncRuntime = `\\\\localhost\\${drive}$${native.slice(2)}`;
        try {
          await realpath(localhostUncRuntime);
        } catch {
          skip(
            "localhost UNC rejection unavailable: localhost administrative drive share is not accessible",
          );
        }
        await expectRejected(
          localhostUncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "devcanon-runtime typed entrypoint is not representable as a Windows file URL",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
