import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();
const jqAvailable = await commandAvailable("jq");
const mkfifoAvailable = await commandAvailable("mkfifo");
const helperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/review-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const nitsFile = `.ephemeral/topic-${headSha}-nits-pending.json`;

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-review-artifacts-"),
  );
  await mkdir(path.join(dir, ".ephemeral"));
  return dir;
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await makeWorkspace();
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  return cwd;
}

async function makeTopicGitWorkspace(): Promise<string> {
  const cwd = await makeGitWorkspace();
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  return cwd;
}

async function writeEnvelope(cwd: string, relPath: string): Promise<void> {
  await writeFile(
    path.join(cwd, relPath),
    JSON.stringify({
      schema: "play-review/findings/v1",
      findings: [],
      carry_forward: [],
    }),
  );
}

async function writeRawEnvelope(
  cwd: string,
  relPath: string,
  envelope: unknown,
): Promise<void> {
  await writeFile(path.join(cwd, relPath), JSON.stringify(envelope));
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    path: "skills/play-review/SKILL.md",
    line: 42,
    start_line: null,
    severity: "Blocking",
    category: "Contracts",
    critic: "VALID",
    anchor: "natural",
    why: "The contract would otherwise be ambiguous.",
    recommendation: "Keep the helper contract explicit.",
    body: "**Blocking | Contracts** - The contract would otherwise be ambiguous.\n\n**Recommendation:** Keep the helper contract explicit.",
    ...overrides,
  };
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: { ...process.env, HEAD_SHA: headSha, ...env },
  });
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!jqAvailable)("play-review review artifact helper", () => {
  it("validates findings and nits envelopes", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const nonEmptyEnvelope = {
        schema: "play-review/findings/v1",
        findings: [
          finding(),
          finding({
            line: 43,
            critic: null,
            why: "The critic phase failed before verdicts were available.",
            recommendation: "Preserve the unverified blocking finding.",
            body: "**Blocking | Contracts** - The critic phase failed before verdicts were available.\n\n**Recommendation:** Preserve the unverified blocking finding.",
          }),
        ],
        carry_forward: [
          finding({
            line: 44,
            start_line: 40,
            severity: "Nit",
            category: "Tests",
            critic: null,
            why: "The coverage should prove non-empty carry-forward entries.",
            recommendation: "Keep this positive fixture.",
            body: "**Nit | Tests** - The coverage should prove non-empty carry-forward entries.\n\n**Recommendation:** Keep this positive fixture.",
          }),
        ],
      };
      await writeRawEnvelope(cwd, findingsFile, nonEmptyEnvelope);
      await writeRawEnvelope(cwd, nitsFile, nonEmptyEnvelope);

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("derives and prepares the nits-pending write path", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      const { stdout } = await runHelper(cwd, "derive-nits-pending", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(nitsFile);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("computes and prepares the findings write path from the checked-out git branch", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const branchSlugCases = [
        ["topic", "topic"],
        ["Feature/ABC.1_2", "Feature-ABC.1_2"],
      ] as const;
      for (const [branchName, slug] of branchSlugCases) {
        await execFileAsync("git", ["switch", "-C", branchName], { cwd });
        await expect(
          runHelper(cwd, "prepare-findings-write", {
            BRANCH_NAME: "caller-override-must-not-apply",
          }),
        ).resolves.toMatchObject({
          stdout: `.ephemeral/${slug}-${headSha}-findings.json\n`,
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses the detached slug when HEAD is detached", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await execFileAsync("git", ["checkout", "--detach", "HEAD"], { cwd });

      await expect(
        runHelper(cwd, "prepare-findings-write", {
          BRANCH_NAME: "caller-override-must-not-apply",
        }),
      ).resolves.toMatchObject({
        stdout: `.ephemeral/detached-${headSha}-findings.json\n`,
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails loudly when preparing a findings write path outside a git repository", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, "prepare-findings-write"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "failed to determine git repository root",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects execution from a repository subdirectory before preparing paths", async () => {
    const cwd = await makeTopicGitWorkspace();
    const subdir = path.join(cwd, "subdir");
    try {
      await mkdir(subdir);

      await expect(
        runHelper(subdir, "prepare-findings-write"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "review-artifacts.sh must run from the repository root",
        ),
      });
      await expect(
        lstat(path.join(subdir, ".ephemeral")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("validates findings against the full current branch-derived path", async () => {
    const cwd = await makeTopicGitWorkspace();
    const wrongBranchFindingsFile = `.ephemeral/wrong-${headSha}-findings.json`;
    try {
      await writeEnvelope(cwd, findingsFile);
      await writeEnvelope(cwd, wrongBranchFindingsFile);

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: wrongBranchFindingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("prepares an explicit findings write path and removes a symlinked leaf", async () => {
    const cwd = await makeTopicGitWorkspace();
    const outside = path.join(cwd, "outside-target");
    try {
      if (symlinkAvailable) {
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, path.join(cwd, findingsFile));
      }

      const { stdout } = await runHelper(cwd, "prepare-findings-write", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(findingsFile);
      if (symlinkAvailable) {
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");
        await expect(lstat(path.join(cwd, findingsFile))).rejects.toMatchObject(
          {
            code: "ENOENT",
          },
        );
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed paths, nesting, traversal, schema mismatch, and head mismatch", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      await mkdir(path.join(cwd, ".ephemeral/nested"));
      await writeFile(
        path.join(cwd, ".ephemeral/bad-findings.json"),
        JSON.stringify({
          schema: "wrong/v1",
          findings: [],
          carry_forward: [],
        }),
      );

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: "findings.json" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path validation failed"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/nested/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/topic/.ephemeral/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/../bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE:
            ".ephemeral/topic-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-nits-file", {
          NITS_FILE: ".ephemeral/bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed envelope shapes before consumers read them", async () => {
    const cwd = await makeTopicGitWorkspace();
    const malformedEnvelopes = [
      {
        schema: "play-review/findings/v1",
        findings: "not-array",
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [],
        carry_forward: {},
      },
      {
        schema: "play-review/findings/v1",
        findings: [
          {
            ...finding(),
            body: undefined,
          },
        ],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ path: "../../outside" })],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ severity: "Nit", critic: "VALID" })],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ path: "/absolute/path" })],
        carry_forward: [],
      },
    ];

    try {
      for (const envelope of malformedEnvelopes) {
        await writeRawEnvelope(cwd, findingsFile, envelope);
        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("envelope shape mismatch"),
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked .ephemeral directory",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      const outside = path.join(cwd, "outside-ephemeral");
      try {
        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await mkdir(outside);
        await symlink(outside, path.join(cwd, ".ephemeral"));

        await expect(
          runHelper(cwd, "prepare-findings-write", {
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            ".ephemeral must be a directory, not a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked leaf files when reading",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      const outside = path.join(cwd, "outside-findings.json");
      try {
        await writeEnvelope(cwd, findingsFile);
        await writeEnvelope(cwd, "outside-findings.json");
        await rm(path.join(cwd, findingsFile));
        await symlink(outside, path.join(cwd, findingsFile));

        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file must not be a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects missing files and directory targets", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });

      await mkdir(path.join(cwd, findingsFile));
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });
      await expect(
        runHelper(cwd, "prepare-findings-write", {
          FINDINGS_FILE: findingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path is a directory"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unreadable files where the platform enforces chmod permissions", async () => {
    const cwd = await makeTopicGitWorkspace();
    const absoluteFindingsFile = path.join(cwd, findingsFile);
    try {
      await writeEnvelope(cwd, findingsFile);
      await chmod(absoluteFindingsFile, 0o000);
      try {
        await readFile(absoluteFindingsFile);
        return;
      } catch {
        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file missing or unreadable",
          ),
        });
      }
    } finally {
      await chmod(absoluteFindingsFile, 0o600).catch(() => undefined);
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!mkfifoAvailable)(
    "rejects non-regular findings write targets when mkfifo is available",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      try {
        await execFileAsync("mkfifo", [path.join(cwd, findingsFile)]);

        await expect(
          runHelper(cwd, "prepare-findings-write", {
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings path exists but is not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(!mkfifoAvailable)(
    "rejects non-regular derived nits-pending targets when mkfifo is available",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      try {
        await writeEnvelope(cwd, findingsFile);
        await execFileAsync("mkfifo", [path.join(cwd, nitsFile)]);

        await expect(
          runHelper(cwd, "derive-nits-pending", {
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "nits pending path exists but is not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});
