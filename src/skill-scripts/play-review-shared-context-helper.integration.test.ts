import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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
const helperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/shared-review-context.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const inputFile = `.ephemeral/topic-${headSha}-review-context-input.json`;
const outputFile = `.ephemeral/topic-${headSha}-review-context.md`;

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-shared-context-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: "play-review/shared-context-input/v1",
    header: {
      working_directory: "__WORKSPACE__",
      base_ref: "main",
      head_sha: headSha,
      active_diff_range: "main...HEAD",
      full_pr_diff_range: "main...HEAD",
      mode: "branch-review",
      language_hints: ["typescript", "shell"],
    },
    changed_files: {
      command: "git diff --name-status main...HEAD",
      total_count: 2,
      truncated: false,
      records: [
        { status: "M", path: "src/feature.ts" },
        { status: "A", path: "docs/specs/review.md" },
      ],
    },
    doc_impact_summary: {
      arch_files: ["docs/arch/overview.md"],
      new_adrs: [],
      modified_adrs: [
        "docs/adr/adr-0019-script-authority-for-deterministic-skill-mechanics.md",
      ],
      architecture_routing_risks: ["Script authority changed."],
      spec_routing_risks: ["Shared context affects reviewer dispatch."],
      notes: "No oversized lists.",
    },
    adr_references: [
      {
        path: "docs/adr/adr-0019-script-authority-for-deterministic-skill-mechanics.md",
        reason: "Script owns deterministic helper mechanics.",
      },
    ],
    discovered_guidelines: {
      records: [
        {
          path: "docs/guidelines/documentation-standard.md",
          bytes: 1200,
          summary:
            "Documentation changes must keep durable navigation current.",
          priority: "required",
          exact_excerpts: ["Keep MAP.md as the canonical navigation index."],
        },
      ],
    },
    output_format: {
      markdown: "Findings must use the established severity/category envelope.",
    },
    prior_review_context: {
      records: [
        {
          source: {
            kind: "github-review-thread",
            reference: "PR #12 review thread R1",
          },
          bytes: 800,
          summary:
            "Earlier reviewer asked to preserve direct-child .ephemeral writes.",
          exact_excerpt: "Do not let nested ephemeral paths through.",
          untrusted: true,
        },
      ],
    },
    ...overrides,
  };
}

async function writeManifest(
  cwd: string,
  relPath = inputFile,
  value: Record<string, unknown> = manifest(),
): Promise<void> {
  const next = structuredClone(value);
  if (
    next.header &&
    typeof next.header === "object" &&
    "working_directory" in next.header &&
    next.header.working_directory === "__WORKSPACE__"
  ) {
    next.header.working_directory = await realpath(cwd);
  }
  await writeFile(path.join(cwd, relPath), JSON.stringify(next, null, 2));
}

async function runHelper(
  cwd: string,
  command = "build-review-context",
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: {
      ...process.env,
      HEAD_SHA: headSha,
      FINDINGS_FILE: findingsFile,
      REVIEW_CONTEXT_INPUT_FILE: inputFile,
      ...env,
    },
  });
}

async function expectFailure(
  cwd: string,
  expectedStderr: string,
  env: NodeJS.ProcessEnv = {},
  command = "build-review-context",
  outputMustBeAbsent = true,
) {
  await expect(runHelper(cwd, command, env)).rejects.toMatchObject({
    stdout: "",
    stderr: expect.stringContaining(expectedStderr),
  });
  if (outputMustBeAbsent) {
    await expect(lstat(path.join(cwd, outputFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
}

describe.skipIf(!jqAvailable)("play-review shared context helper", () => {
  it("builds one bounded direct-child context file from a valid manifest and replaces existing content", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeManifest(cwd);
      await writeFile(path.join(cwd, outputFile), "stale content\n");

      const { stdout, stderr } = await runHelper(cwd);
      const content = await readFile(path.join(cwd, outputFile), "utf8");

      expect(stderr).toBe("");
      expect(stdout).toBe(`${outputFile}\n`);
      expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(0);
      expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(64000);
      expect(content).toContain("# Shared Review Context");
      expect(content).toContain(`Review head: ${headSha}`);
      expect(content).toContain("docs/guidelines/documentation-standard.md");
      expect(content).toContain("Source reference: PR #12 review thread R1");
      expect(content).toContain("Untrusted prior-review evidence: true");
      expect(content).not.toContain("stale content");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unknown commands before writing", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeManifest(cwd);
      await expectFailure(cwd, "usage:", {}, "nope");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects path and manifest trust-boundary violations before writing", async () => {
    const cases: Array<{
      name: string;
      env?: NodeJS.ProcessEnv;
      relPath?: string;
      value?: Record<string, unknown>;
      stderr: string;
    }> = [
      {
        name: "wrong-head findings path",
        env: {
          FINDINGS_FILE:
            ".ephemeral/topic-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-findings.json",
        },
        stderr: "findings path must include HEAD_SHA",
      },
      {
        name: "input not derived from findings",
        env: {
          REVIEW_CONTEXT_INPUT_FILE:
            ".ephemeral/other-review-context-input.json",
        },
        stderr: "review context input path mismatch",
      },
      {
        name: "manifest head mismatch",
        value: manifest({
          header: {
            ...manifest().header,
            working_directory: "__WORKSPACE__",
            head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        }),
        stderr: "manifest head_sha mismatch",
      },
      {
        name: "manifest working directory mismatch",
        value: manifest({
          header: {
            ...manifest().header,
            working_directory: "/tmp/elsewhere",
          },
        }),
        stderr: "manifest working_directory mismatch",
      },
      {
        name: "unsafe input path",
        env: {
          REVIEW_CONTEXT_INPUT_FILE:
            ".ephemeral/../topic-review-context-input.json",
        },
        stderr: "path traversal",
      },
      {
        name: "unsafe output path from findings",
        env: { FINDINGS_FILE: `.ephemeral/../topic-${headSha}-findings.json` },
        stderr: "path traversal",
      },
    ];

    for (const testCase of cases) {
      const cwd = await makeGitWorkspace();
      try {
        await writeManifest(cwd, testCase.relPath ?? inputFile, testCase.value);
        await expectFailure(cwd, testCase.stderr, testCase.env);
      } finally {
        await cleanupTempDir(cwd);
      }
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked .ephemeral, input, and output paths",
    async () => {
      const workspaceWithEphemeralLink = await makeGitWorkspace();
      try {
        await rm(path.join(workspaceWithEphemeralLink, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        const target = path.join(workspaceWithEphemeralLink, "outside");
        await mkdir(target);
        await symlink(
          target,
          path.join(workspaceWithEphemeralLink, ".ephemeral"),
          "dir",
        );
        await expectFailure(
          workspaceWithEphemeralLink,
          ".ephemeral must be a directory, not a symlink",
        );
      } finally {
        await cleanupTempDir(workspaceWithEphemeralLink);
      }

      const workspaceWithInputLink = await makeGitWorkspace();
      try {
        await writeManifest(
          workspaceWithInputLink,
          ".ephemeral/real-input.json",
        );
        await symlink(
          "real-input.json",
          path.join(workspaceWithInputLink, inputFile),
          "file",
        );
        await expectFailure(
          workspaceWithInputLink,
          "review context input must not be a symlink",
        );
      } finally {
        await cleanupTempDir(workspaceWithInputLink);
      }

      const workspaceWithOutputLink = await makeGitWorkspace();
      try {
        await writeManifest(workspaceWithOutputLink);
        await writeFile(
          path.join(workspaceWithOutputLink, ".ephemeral/target.md"),
          "target",
        );
        await symlink(
          "target.md",
          path.join(workspaceWithOutputLink, outputFile),
          "file",
        );
        await expectFailure(
          workspaceWithOutputLink,
          "review context output must not be a symlink",
          {},
          "build-review-context",
          false,
        );
      } finally {
        await cleanupTempDir(workspaceWithOutputLink);
      }
    },
  );

  it("rejects malformed JSON and missing required manifest fields", async () => {
    const malformed = await makeGitWorkspace();
    try {
      await writeFile(path.join(malformed, inputFile), "{");
      await expectFailure(malformed, "manifest JSON is malformed");
    } finally {
      await cleanupTempDir(malformed);
    }

    const missingSummary = await makeGitWorkspace();
    try {
      const value = manifest();
      value.discovered_guidelines.records[0].summary = "";
      await writeManifest(missingSummary, inputFile, value);
      await expectFailure(missingSummary, "guideline summary is required");
    } finally {
      await cleanupTempDir(missingSummary);
    }

    const missingUntrustedLabel = await makeGitWorkspace();
    try {
      const value = manifest();
      value.prior_review_context.records[0].untrusted = false;
      await writeManifest(missingUntrustedLabel, inputFile, value);
      await expectFailure(
        missingUntrustedLabel,
        "prior review untrusted flag must be true",
      );
    } finally {
      await cleanupTempDir(missingUntrustedLabel);
    }
  });

  it("renders item-count overflow entries for guidelines and prior reviews", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const value = manifest({
        discovered_guidelines: {
          records: Array.from({ length: 14 }, (_, index) => ({
            path: `docs/guidelines/guideline-${index + 1}.md`,
            bytes: 100 + index,
            summary: `Guideline summary ${index + 1}`,
            exact_excerpts: [`Guideline excerpt ${index + 1}`],
          })),
        },
        prior_review_context: {
          records: Array.from({ length: 22 }, (_, index) => ({
            source: {
              kind: "github-review-thread",
              reference: `PR #12 thread ${index + 1}`,
            },
            bytes: 200 + index,
            summary: `Prior review summary ${index + 1}`,
            exact_excerpt: `Prior review excerpt ${index + 1}`,
            untrusted: true,
          })),
        },
      });
      await writeManifest(cwd, inputFile, value);

      await runHelper(cwd);
      const content = await readFile(path.join(cwd, outputFile), "utf8");

      expect(content).toContain("Guideline overflow record 13");
      expect(content).toContain("Guideline summary 14");
      expect(content).toContain(
        "Targeted reread: open docs/guidelines/guideline-13.md",
      );
      expect(content).toContain("Prior review overflow record 21");
      expect(content).toContain("Prior review summary 22");
      expect(content).toContain("Targeted reread: inspect PR #12 thread 21");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses UTF-8 byte accounting for multibyte content and fails closed when section summaries cannot fit", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const multibyte = "界".repeat(2000);
      await writeManifest(
        cwd,
        inputFile,
        manifest({
          discovered_guidelines: {
            records: [
              {
                path: "docs/guidelines/multibyte.md",
                bytes: Buffer.byteLength(multibyte, "utf8"),
                summary: "Multibyte guideline summary",
                exact_excerpts: [multibyte],
              },
            ],
          },
        }),
      );

      await runHelper(cwd);
      const content = await readFile(path.join(cwd, outputFile), "utf8");

      expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(64000);
      expect(content).toContain("Exact excerpt omitted due to byte budget.");
      expect(content).toContain(
        "Targeted reread: open docs/guidelines/multibyte.md",
      );
    } finally {
      await cleanupTempDir(cwd);
    }

    const overBudget = await makeGitWorkspace();
    try {
      await writeManifest(
        overBudget,
        inputFile,
        manifest({
          discovered_guidelines: {
            records: [
              {
                path: "docs/guidelines/too-large.md",
                bytes: 30000,
                summary: "界".repeat(9000),
              },
            ],
          },
        }),
      );
      await expectFailure(overBudget, "guideline section byte budget exceeded");
    } finally {
      await cleanupTempDir(overBudget);
    }
  });
});
