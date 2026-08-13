import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/prior-thread-artifacts.sh",
);
const jqAvailable = await commandAvailable("jq");
const PROVIDER_EVIDENCE_SCHEMA = "pr-review/provider-scope-evidence/v2";
const DIGEST_PROVENANCE_SCHEMA = "pr-review/digest-provenance/v1";
const CANONICAL_GIT_DIFF_DIALECT = "canonical-git-diff/v1";
const CAPTURE_CLEANUP_SEQUENCE = String.raw`
capture_tmp="$1"
finish_capture_materialization() {
  trap 'rm -rf "$capture_tmp"' RETURN
  if ! rm -rf "$capture_tmp"; then
    return 1
  fi
  trap - RETURN
  : > "$PRODUCER_DISPATCH_MARKER"
}
status=0
finish_capture_materialization || status=$?
exit "$status"
`;

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-prior-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function gitRaw(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function writeRawGithubCaptureInputs(
  scratch: string,
  baseSha: string,
  headSha: string,
) {
  const prPath = path.join(scratch, "pr.json");
  const filesPath = path.join(scratch, "files.json");
  const diffPath = path.join(scratch, "full.diff");
  await writeFile(
    prPath,
    JSON.stringify({ number: 390, baseRefOid: baseSha, headRefOid: headSha }),
  );
  await writeFile(
    filesPath,
    JSON.stringify([
      [
        {
          filename: "src/app.ts",
          status: "added",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ],
    ]),
  );
  await writeFile(diffPath, "diff --git a/src/app.ts b/src/app.ts\n");
  return { prPath, filesPath, diffPath };
}

async function materializeRawGithubCapture(
  cwd: string,
  capturePath: string,
  scratch: string,
  baseSha: string,
  headSha: string,
  interrupted = false,
) {
  const { prPath, filesPath, diffPath } = await writeRawGithubCaptureInputs(
    scratch,
    baseSha,
    headSha,
  );
  return runHelper(cwd, helperScript, "materialize-provider-scope-capture", {
    HEAD_SHA: headSha,
    PROVIDER_SCOPE_CAPTURE_FILE: path.relative(cwd, capturePath),
    PROVIDER_SCOPE_CAPTURE_TMP_FILE: path.join(scratch, "capture.json"),
    PROVIDER_SCOPE_CAPTURE_PR_FILE: prPath,
    PROVIDER_SCOPE_CAPTURE_FILES_FILE: filesPath,
    PROVIDER_SCOPE_CAPTURE_DIFF_FILE: diffPath,
    PR_REPOSITORY: "owner/repo",
    ...(interrupted ? { CAPTURE_MATERIALIZER_STOP_BEFORE_PUBLISH: "1" } : {}),
  });
}

async function canonicalGitDiffRaw(
  cwd: string,
  range: string,
  pathspecs: readonly string[] = [],
) {
  return gitRaw(
    cwd,
    "-c",
    "diff.noprefix=false",
    "-c",
    "diff.mnemonicPrefix=false",
    "-c",
    "diff.srcPrefix=a/",
    "-c",
    "diff.dstPrefix=b/",
    "-c",
    "diff.relative=false",
    "-c",
    "core.abbrev=40",
    "-c",
    "diff.abbrev=40",
    "-c",
    "diff.context=3",
    "-c",
    "diff.interHunkContext=0",
    "-c",
    "diff.algorithm=myers",
    "-c",
    "diff.renames=true",
    "-c",
    "diff.renameLimit=0",
    "-c",
    "diff.color=false",
    "-c",
    "color.ui=false",
    "-c",
    "core.quotePath=true",
    "-c",
    "diff.suppressBlankEmpty=false",
    "-c",
    "diff.indentHeuristic=false",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--find-renames",
    "--diff-algorithm=myers",
    "--unified=3",
    "--inter-hunk-context=0",
    range,
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  );
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function providerScopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
}

function priorThreadsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-prior-threads.json`;
}

function initialScope(baseSha: string, headSha: string, overrides = {}) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}..${headSha}`,
    selected_range: `${baseSha}..${headSha}`,
    candidate_narrow_range: `${baseSha}..${headSha}`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial review uses the full review range.",
    changed_files: ["src/app.ts"],
    language_hints: ["ts"],
    escalation_reasons: ["not-followup"],
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: { checked: true, ambiguous: false, notes: "" },
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function providerScopeEvidence(
  cwd: string,
  baseSha: string,
  headSha: string,
) {
  const patch = await canonicalGitDiffRaw(cwd, `${baseSha}..${headSha}`, [
    "src/app.ts",
  ]);
  const fullDiff = await canonicalGitDiffRaw(cwd, `${baseSha}..${headSha}`);
  const entry = {
    path: "src/app.ts",
    status: "added",
    previous_path: null,
    additions: 1,
    deletions: 0,
    changes: 1,
    patch_sha256: sha256(patch),
    patch_available: true,
  };
  return {
    schema: PROVIDER_EVIDENCE_SCHEMA,
    provider: "github",
    repository: "owner/repo",
    pr_number: 390,
    baseRefOid: baseSha,
    headRefOid: headSha,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headSha,
    full_pr_diff_range: `${baseSha}..${headSha}`,
    evidence_complete: true,
    digest_provenance: {
      schema: DIGEST_PROVENANCE_SCHEMA,
      provider_diff: CANONICAL_GIT_DIFF_DIALECT,
      local_diff: CANONICAL_GIT_DIFF_DIALECT,
      provider_patches: CANONICAL_GIT_DIFF_DIALECT,
      local_patches: CANONICAL_GIT_DIFF_DIALECT,
    },
    provider_files: [entry],
    local_files: [entry],
    provider_diff_sha256: sha256(fullDiff),
    local_diff_sha256: sha256(fullDiff),
  };
}

async function providerScopeCapture(
  cwd: string,
  baseSha: string,
  headSha: string,
) {
  const patch = await canonicalGitDiffRaw(cwd, `${baseSha}..${headSha}`, [
    "src/app.ts",
  ]);
  const fullDiff = await canonicalGitDiffRaw(cwd, `${baseSha}..${headSha}`);
  return {
    schema: "pr-review/provider-scope-capture/v1",
    provider: "github",
    repository: "owner/repo",
    pr_number: 390,
    baseRefOid: baseSha,
    headRefOid: headSha,
    evidence_complete: true,
    provider_files: [
      {
        path: "src/app.ts",
        status: "added",
        previous_path: null,
        additions: 1,
        deletions: 0,
        changes: 1,
        patch_base64: Buffer.from(patch).toString("base64"),
      },
    ],
    provider_diff: {
      dialect: CANONICAL_GIT_DIFF_DIALECT,
      content_base64: Buffer.from(fullDiff).toString("base64"),
    },
  };
}

async function writeInitialScope(
  cwd: string,
  baseSha: string,
  headSha: string,
  overrides = {},
) {
  const evidencePath = providerScopePath(headSha);
  const evidenceText = JSON.stringify(
    await providerScopeEvidence(cwd, baseSha, headSha),
    null,
    2,
  );
  await writeFile(path.join(cwd, evidencePath), evidenceText);
  await writeJson(cwd, scopePath(headSha), {
    ...initialScope(baseSha, headSha, overrides),
    artifacts: {
      provider_scope_evidence_file: evidencePath,
      provider_scope_evidence_sha256: sha256(evidenceText),
    },
  });
}

function priorThreadsEnvelope(headSha: string, overrides = {}) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: 390,
    head_sha: headSha,
    threads: [
      {
        thread_id: "PRRT_kwDOExample",
        is_resolved: false,
        is_outdated: false,
        path: "src/app.ts",
        line: 1,
        original_line: 1,
        start_line: null,
        original_start_line: null,
        classification: "actionable",
        model_context: "include",
        staleness_reason: "",
        comments: [
          {
            author: "reviewer",
            author_association: "MEMBER",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:01Z",
            body: "Please check this.",
            is_bot: false,
            minimized_reason: null,
          },
        ],
        summary: "",
      },
    ],
    dropped: [
      {
        thread_id: "PRRT_kwDODropped",
        classification: "resolved",
        reason: "Thread is resolved.",
      },
    ],
    ...overrides,
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function runHelper(
  cwd: string,
  script: string,
  command: string,
  env: Record<string, string> = {},
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function writeMarkerValidator(root: string, marker: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      '[ -z "${MARKER_ARGS_FILE:-}" ] || printf "%s\\n" "$@" > "$MARKER_ARGS_FILE"',
      `printf '%s\\n' ${JSON.stringify(marker)}`,
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

async function writeMarkerRuntime(root: string) {
  const script = path.join(root, "scripts/devcanon-runtime.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "${3:-}" = "contract" ]; then',
      '  printf "%b" "${RUNTIME_CONTRACT_OUTPUT:-}"',
      '  exit "${RUNTIME_CONTRACT_EXIT:-0}"',
      "fi",
      '[ -z "${RUNTIME_DISPATCH_MARKER:-}" ] || : > "$RUNTIME_DISPATCH_MARKER"',
      'printf "%s\\n" ".ephemeral/runtime-provider-scope-evidence.json"',
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return root;
}

async function documentedBindScopeDecisionArtifact(): Promise<string> {
  const skill = await readFile(
    path.join(process.cwd(), "skills/pr-review/SKILL.md"),
    "utf8",
  );
  const start = skill.indexOf("bind_scope_decision_artifact() {");
  const end = skill.indexOf("\n}\n\nSCOPE_DECISION_STATUS=0", start);
  if (start < 0 || end < 0) {
    throw new Error("documented bind_scope_decision_artifact block missing");
  }
  return skill.slice(start, end + 2);
}

async function writeProviderFetchHarness(root: string) {
  const bin = path.join(root, "bin");
  const gh = path.join(bin, "gh");
  const helper = path.join(root, "artifact-helper");
  const runner = path.join(root, "run-documented-bind");
  await mkdir(bin, { recursive: true });
  await writeFile(
    gh,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case " $* " in',
      '  *" --jq "*)',
      '    count=0; [ ! -f "$GH_BINDING_COUNT" ] || count="$(cat "$GH_BINDING_COUNT")"',
      '    count="$((count + 1))"; printf "%s\\n" "$count" > "$GH_BINDING_COUNT"',
      '    sed -n "${count}p" "$GH_BINDINGS_FILE"',
      "    ;;",
      '  *" --paginate "*)',
      '    printf \'[[{"filename":"src/app.ts","status":"added","additions":1,"deletions":0,"changes":1}]]\\n\'',
      "    ;;",
      "  *)",
      "    printf 'diff --git a/src/app.ts b/src/app.ts\\n'",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  await writeFile(
    helper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1" in',
      "  materialize-provider-scope-capture)",
      '    printf "%s\\n" "$PROVIDER_SCOPE_CAPTURE_TMP_FILE" >> "$MATERIALIZE_CALLS"',
      '    [ "${MATERIALIZE_MODE:-real}" = "real" ] || exit 91',
      '    exec bash "$REAL_ARTIFACT_HELPER" "$@"',
      "    ;;",
      "  write-provider-scope-evidence)",
      '    evidence="${PROVIDER_SCOPE_CAPTURE_FILE%-capture.json}-evidence.json"',
      '    printf \'{"provider_pr_diff_base_sha":"%s","full_pr_diff_range":"%s..%s"}\\n\' "$PR_BASE_OID" "$PR_BASE_OID" "$HEAD_SHA" > "$evidence"',
      '    printf "%s\\n" "$evidence"',
      "    ;;",
      "  prepare-scope-decision-write)",
      "    printf '.ephemeral/stub-scope-decision.json\\n'",
      "    ;;",
      "  validate-scope-decision)",
      "    ;;",
      "  *)",
      '    printf "unexpected helper command: %s\\n" "$1" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  await writeFile(
    runner,
    [
      "#!/usr/bin/env bash",
      "set -uo pipefail",
      await documentedBindScopeDecisionArtifact(),
      "bind_scope_decision_artifact",
      "",
    ].join("\n"),
  );
  await Promise.all([
    chmod(gh, 0o755),
    chmod(helper, 0o755),
    chmod(runner, 0o755),
  ]);
  return { bin, runner };
}

async function runDocumentedProviderFetch(
  cwd: string,
  baseSha: string,
  root: string,
  bindings: readonly string[],
  materializer = "real",
  failClassifierRead = false,
) {
  const { bin, runner } = await writeProviderFetchHarness(root);
  const bindingFile = path.join(root, "bindings.jsonl");
  const bindingCount = path.join(root, "binding-count");
  const materializeCalls = path.join(root, "materialize-calls");
  await writeFile(bindingFile, `${bindings.join("\n")}\n`);
  if (failClassifierRead) {
    const node = path.join(bin, "node");
    await writeFile(node, "#!/usr/bin/env bash\nexit 3\n");
    await chmod(node, 0o755);
  }
  return {
    result: execFileAsync("bash", [runner], {
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        WORKING_DIRECTORY: cwd,
        PR_REVIEW_ARTIFACT_HELPER: path.join(root, "artifact-helper"),
        REAL_ARTIFACT_HELPER: helperScript,
        PR_REPOSITORY: "owner/repo",
        PR_NUMBER: "390",
        PR_BASE_OID: baseSha,
        GH_BINDINGS_FILE: bindingFile,
        GH_BINDING_COUNT: bindingCount,
        MATERIALIZE_CALLS: materializeCalls,
        MATERIALIZE_MODE: materializer,
      },
      maxBuffer: 1024 * 1024,
    }),
    bindingCount,
    materializeCalls,
  };
}

describe("documented provider-scope capture materialization", () => {
  it("refuses a historical reviewed HEAD before materialization", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const scratch = path.join(
      cwd,
      ".ephemeral",
      "provider-scope-capture.fixture",
    );
    await mkdir(scratch);
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${baseSha}-provider-scope-capture.json`,
    );
    try {
      await expect(
        materializeRawGithubCapture(
          cwd,
          capturePath,
          scratch,
          baseSha,
          baseSha,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("current repository HEAD"),
      });
      await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("publishes a complete closed canonical capture without direct target writes", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const scratch = path.join(
      cwd,
      ".ephemeral",
      "provider-scope-capture.fixture",
    );
    await mkdir(scratch);
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
    );
    try {
      await materializeRawGithubCapture(
        cwd,
        capturePath,
        scratch,
        baseSha,
        headSha,
      );

      const captureText = await readFile(capturePath, "utf8");
      await expect(
        readFile(path.join(scratch, "capture.json"), "utf8"),
      ).resolves.toBe(captureText);
      expect(captureText).toMatch(/\n$/);
      expect(captureText).not.toContain("\\\\n");
      const capture = JSON.parse(captureText);
      expect(Object.keys(capture).sort()).toEqual([
        "baseRefOid",
        "evidence_complete",
        "headRefOid",
        "pr_number",
        "provider",
        "provider_diff",
        "provider_files",
        "repository",
        "schema",
      ]);
      expect(Object.keys(capture.provider_files[0]).sort()).toEqual([
        "additions",
        "changes",
        "deletions",
        "patch_base64",
        "path",
        "previous_path",
        "status",
      ]);
      expect(Object.keys(capture.provider_diff).sort()).toEqual([
        "content_base64",
        "dialect",
      ]);
      expect(capture.provider_files[0].patch_base64).toBeNull();
      expect(capture.provider_diff.content_base64).toBe(
        Buffer.from("diff --git a/src/app.ts b/src/app.ts\n").toString(
          "base64",
        ),
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("leaves no canonical capture when materialization stops before publication", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const scratch = path.join(
      cwd,
      ".ephemeral",
      "provider-scope-capture.fixture",
    );
    await mkdir(scratch);
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
    );
    try {
      await expect(
        materializeRawGithubCapture(
          cwd,
          capturePath,
          scratch,
          baseSha,
          headSha,
          true,
        ),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(path.join(scratch, "capture.json"), "utf8"),
      ).resolves.toContain("provider-scope-capture/v1");
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});

describe.skipIf(!jqAvailable)("documented provider capture retries", () => {
  it("discards an unstable private attempt and publishes only the second stable capture", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const binding = (baseRefOid: string, headRefOid: string) =>
      JSON.stringify({ number: 390, baseRefOid, headRefOid });
    try {
      const run = await runDocumentedProviderFetch(cwd, baseSha, root, [
        binding(baseSha, headSha),
        binding(baseSha, "a".repeat(40)),
        binding(baseSha, headSha),
        binding(baseSha, headSha),
      ]);

      await expect(run.result).resolves.toMatchObject({ stderr: "" });
      await expect(readFile(run.bindingCount, "utf8")).resolves.toBe("4\n");
      const materialized = await readFile(run.materializeCalls, "utf8");
      expect(materialized.trim().split("\n")).toHaveLength(1);
      await expect(
        readFile(
          path.join(
            cwd,
            `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
          ),
          "utf8",
        ),
      ).resolves.toContain(`"headRefOid":"${headSha}"`);
      expect(
        (await readdir(path.join(cwd, ".ephemeral"))).filter((entry) =>
          entry.startsWith("provider-scope-capture."),
        ),
      ).toEqual([]);
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("refuses when both provider snapshots are unstable without canonical publication", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const binding = (headRefOid: string) =>
      JSON.stringify({ number: 390, baseRefOid: baseSha, headRefOid });
    try {
      const run = await runDocumentedProviderFetch(cwd, baseSha, root, [
        binding(headSha),
        binding("a".repeat(40)),
        binding(headSha),
        binding("b".repeat(40)),
      ]);

      await expect(run.result).rejects.toMatchObject({ code: 1 });
      await expect(
        readFile(run.materializeCalls, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(
          path.join(
            cwd,
            `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(path.join(cwd, ".ephemeral"))).toEqual([]);
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it.each([
    {
      name: "baseRefOid",
      capture: (baseSha: string, headSha: string) => ({
        provider: "github",
        repository: "owner/repo",
        pr_number: 390,
        baseRefOid: "a".repeat(40),
        headRefOid: headSha,
      }),
    },
    {
      name: "headRefOid",
      capture: (baseSha: string, _headSha: string) => ({
        provider: "github",
        repository: "owner/repo",
        pr_number: 390,
        baseRefOid: baseSha,
        headRefOid: "a".repeat(40),
      }),
    },
    {
      name: "provider",
      capture: (baseSha: string, headSha: string) => ({
        provider: "other",
        repository: "owner/repo",
        pr_number: 390,
        baseRefOid: baseSha,
        headRefOid: headSha,
      }),
    },
    {
      name: "repository",
      capture: (baseSha: string, headSha: string) => ({
        provider: "github",
        repository: "other/repo",
        pr_number: 390,
        baseRefOid: baseSha,
        headRefOid: headSha,
      }),
    },
    {
      name: "pr_number",
      capture: (baseSha: string, headSha: string) => ({
        provider: "github",
        repository: "owner/repo",
        pr_number: 391,
        baseRefOid: baseSha,
        headRefOid: headSha,
      }),
    },
  ])(
    "deletes only a stale canonical $name before recapturing",
    async ({ capture }) => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const root = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-pr-provider-"),
      );
      const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
      const unrelatedPath = ".ephemeral/keep.txt";
      try {
        await writeJson(cwd, capturePath, capture(baseSha, headSha));
        await writeFile(path.join(cwd, unrelatedPath), "preserve\n");
        const stable = JSON.stringify({
          number: 390,
          baseRefOid: baseSha,
          headRefOid: headSha,
        });
        const run = await runDocumentedProviderFetch(cwd, baseSha, root, [
          stable,
          stable,
        ]);

        await expect(run.result).resolves.toMatchObject({ stderr: "" });
        await expect(readFile(run.materializeCalls, "utf8")).resolves.toContain(
          "capture.json",
        );
        await expect(
          readFile(path.join(cwd, unrelatedPath), "utf8"),
        ).resolves.toBe("preserve\n");
        await expect(
          readFile(path.join(cwd, capturePath), "utf8"),
        ).resolves.toContain(`"baseRefOid":"${baseSha}"`);
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(root);
      }
    },
  );

  it("preserves malformed canonical JSON without refetching or deleting it", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
    const malformed = "{ not JSON\n";
    try {
      await writeFile(path.join(cwd, capturePath), malformed);
      const run = await runDocumentedProviderFetch(cwd, baseSha, root, []);

      await expect(run.result).rejects.toMatchObject({ code: 1 });
      await expect(readFile(path.join(cwd, capturePath), "utf8")).resolves.toBe(
        malformed,
      );
      await expect(readFile(run.bindingCount, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(run.materializeCalls, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("preserves a canonical capture when its classifier read fails without refetching", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
    try {
      await writeJson(cwd, capturePath, {
        provider: "github",
        repository: "owner/repo",
        pr_number: 390,
        baseRefOid: baseSha,
        headRefOid: headSha,
      });
      const run = await runDocumentedProviderFetch(
        cwd,
        baseSha,
        root,
        [],
        "real",
        true,
      );

      await expect(run.result).rejects.toMatchObject({ code: 1 });
      await expect(readFile(path.join(cwd, capturePath), "utf8")).resolves.toBe(
        JSON.stringify(
          {
            provider: "github",
            repository: "owner/repo",
            pr_number: 390,
            baseRefOid: baseSha,
            headRefOid: headSha,
          },
          null,
          2,
        ),
      );
      await expect(readFile(run.bindingCount, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(run.materializeCalls, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("reuses a valid canonical capture without invoking the materializer", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
    try {
      await writeJson(cwd, capturePath, {
        provider: "github",
        repository: "owner/repo",
        pr_number: 390,
        baseRefOid: baseSha,
        headRefOid: headSha,
      });
      const original = await readFile(path.join(cwd, capturePath), "utf8");
      const run = await runDocumentedProviderFetch(
        cwd,
        baseSha,
        root,
        [],
        "fail",
      );

      await expect(run.result).resolves.toMatchObject({ stderr: "" });
      await expect(readFile(path.join(cwd, capturePath), "utf8")).resolves.toBe(
        original,
      );
      await expect(
        readFile(run.materializeCalls, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });
});

describe("provider-scope capture materializer guards", () => {
  it.each([
    { name: "wrong scratch leaf", temp: "wrong.json", mutate: async () => {} },
    {
      name: "pre-existing temp",
      temp: "capture.json",
      mutate: async (scratch: string) =>
        writeFile(path.join(scratch, "capture.json"), "old\n"),
    },
  ])("refuses $name before canonical publication", async ({ temp, mutate }) => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const scratch = path.join(
      cwd,
      ".ephemeral",
      "provider-scope-capture.fixture",
    );
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
    );
    try {
      await mkdir(scratch);
      const inputs = await writeRawGithubCaptureInputs(
        scratch,
        baseSha,
        headSha,
      );
      await mutate(scratch);
      await expect(
        runHelper(cwd, helperScript, "materialize-provider-scope-capture", {
          HEAD_SHA: headSha,
          PROVIDER_SCOPE_CAPTURE_FILE: path.relative(cwd, capturePath),
          PROVIDER_SCOPE_CAPTURE_TMP_FILE: path.join(scratch, temp),
          PROVIDER_SCOPE_CAPTURE_PR_FILE: inputs.prPath,
          PROVIDER_SCOPE_CAPTURE_FILES_FILE: inputs.filesPath,
          PROVIDER_SCOPE_CAPTURE_DIFF_FILE: inputs.diffPath,
          PR_REPOSITORY: "owner/repo",
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("refuses a symlinked .ephemeral directory without publication", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-provider-"));
    const scratch = path.join(root, "scratch");
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
    );
    try {
      await rm(path.join(cwd, ".ephemeral"), { recursive: true });
      await symlink(root, path.join(cwd, ".ephemeral"));
      await mkdir(scratch);
      await expect(
        materializeRawGithubCapture(
          cwd,
          capturePath,
          scratch,
          baseSha,
          headSha,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          ".ephemeral must be a directory, not a symlink",
        ),
      });
      await expect(
        readFile(path.join(root, path.basename(capturePath)), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("refuses an existing canonical capture target without overwriting it", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const scratch = path.join(
      cwd,
      ".ephemeral",
      "provider-scope-capture.fixture",
    );
    const capturePath = path.join(
      cwd,
      `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
    );
    const original = "retain this exact capture\n";
    try {
      await mkdir(scratch);
      await writeFile(capturePath, original);
      await expect(
        materializeRawGithubCapture(
          cwd,
          capturePath,
          scratch,
          baseSha,
          headSha,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "provider scope capture target already exists",
        ),
      });
      await expect(readFile(capturePath, "utf8")).resolves.toBe(original);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.each([
    {
      name: "PR JSON",
      corrupt: async ({ prPath }: { prPath: string }) =>
        writeFile(prPath, "not JSON\n"),
      stderr: "provider capture PR JSON validation failed",
    },
    {
      name: "files JSON",
      corrupt: async ({ filesPath }: { filesPath: string }) =>
        writeFile(filesPath, '{"not":"pages"}\n'),
      stderr: "provider capture files JSON validation failed",
    },
    {
      name: "diff input",
      corrupt: async ({ diffPath }: { diffPath: string }) => {
        await rm(diffPath);
        await mkdir(diffPath);
      },
      stderr: "provider capture diff file is invalid",
    },
  ])(
    "rejects malformed raw $name before canonical publication",
    async ({ corrupt, stderr }) => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const scratch = path.join(
        cwd,
        ".ephemeral",
        "provider-scope-capture.fixture",
      );
      const capturePath = path.join(
        cwd,
        `.ephemeral/topic-${headSha}-provider-scope-capture.json`,
      );
      try {
        await mkdir(scratch);
        const inputs = await writeRawGithubCaptureInputs(
          scratch,
          baseSha,
          headSha,
        );
        await corrupt(inputs);
        await expect(
          runHelper(cwd, helperScript, "materialize-provider-scope-capture", {
            HEAD_SHA: headSha,
            PROVIDER_SCOPE_CAPTURE_FILE: path.relative(cwd, capturePath),
            PROVIDER_SCOPE_CAPTURE_TMP_FILE: path.join(scratch, "capture.json"),
            PROVIDER_SCOPE_CAPTURE_PR_FILE: inputs.prPath,
            PROVIDER_SCOPE_CAPTURE_FILES_FILE: inputs.filesPath,
            PROVIDER_SCOPE_CAPTURE_DIFF_FILE: inputs.diffPath,
            PR_REPOSITORY: "owner/repo",
          }),
        ).rejects.toMatchObject({ stderr: expect.stringContaining(stderr) });
        await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});

describe("documented provider-scope capture cleanup", () => {
  it("fails closed and retains its RETURN cleanup trap when exact cleanup fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-cleanup-"));
    const stubBin = path.join(root, "bin");
    const captureTmp = path.join(root, "provider-scope-capture.fixture");
    const cleanupCount = path.join(root, "cleanup-count");
    const cleanupCalls = path.join(root, "cleanup-calls");
    const dispatchMarker = path.join(root, "producer-dispatched");
    try {
      await mkdir(stubBin);
      await mkdir(captureTmp);
      await writeFile(path.join(captureTmp, "capture.json"), "complete");
      const stubRm = path.join(stubBin, "rm");
      await writeFile(
        stubRm,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          'count=0; [ ! -f "$CLEANUP_COUNT" ] || count="$(cat "$CLEANUP_COUNT")"',
          'count="$((count + 1))"; printf "%s\\n" "$count" > "$CLEANUP_COUNT"',
          'printf "%s\\n" "$*" >> "$CLEANUP_CALLS"',
          '[ "$count" -eq 1 ] && exit 1',
          'exec /bin/rm "$@"',
          "",
        ].join("\n"),
      );
      await chmod(stubRm, 0o755);

      await expect(
        execFileAsync(
          "bash",
          ["-c", CAPTURE_CLEANUP_SEQUENCE, "bash", captureTmp],
          {
            env: {
              ...process.env,
              PATH: `${stubBin}:${process.env.PATH}`,
              CAPTURE_TMP: captureTmp,
              CLEANUP_COUNT: cleanupCount,
              CLEANUP_CALLS: cleanupCalls,
              PRODUCER_DISPATCH_MARKER: dispatchMarker,
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(cleanupCount, "utf8")).resolves.toBe("2\n");
      await expect(readFile(cleanupCalls, "utf8")).resolves.toBe(
        `-rf ${captureTmp}\n-rf ${captureTmp}\n`,
      );
      await expect(readFile(captureTmp, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(dispatchMarker, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(root);
    }
  });
});

async function copyInstalledPrAdapter(root: string) {
  const script = path.join(root, "pr-review/scripts/prior-thread-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

describe.skipIf(!jqAvailable)("pr-review prior-thread adapter", () => {
  it.each([
    { name: "empty output", output: "" },
    {
      name: "missing required newline",
      output:
        '{"command_group":"pr-review-provider-scope-evidence","major_version":1}',
    },
    {
      name: "extra blank output",
      output:
        '{"command_group":"pr-review-provider-scope-evidence","major_version":1}\\n\\n',
    },
    {
      name: "extra text output",
      output:
        '{"command_group":"pr-review-provider-scope-evidence","major_version":1}\\nextra\\n',
    },
    {
      name: "wrong descriptor",
      output: '{"command_group":"wrong","major_version":1}\\n',
    },
    { name: "malformed output", output: "not JSON\\n" },
    {
      name: "unknown major",
      output:
        '{"command_group":"pr-review-provider-scope-evidence","major_version":2}\\n',
    },
    {
      name: "nonzero output",
      output: "",
      exit: "7",
      stderr: "runtime contract check failed",
    },
  ])(
    "rejects runtime compatibility $name before producer dispatch",
    async ({ output, exit, stderr }) => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const root = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-pr-runtime-"),
      );
      const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
      const marker = path.join(root, "dispatch");
      try {
        await writeJson(
          cwd,
          capturePath,
          await providerScopeCapture(cwd, baseSha, headSha),
        );
        await writeMarkerRuntime(root);
        await expect(
          runHelper(cwd, helperScript, "write-provider-scope-evidence", {
            HEAD_SHA: headSha,
            PROVIDER_SCOPE_CAPTURE_FILE: capturePath,
            DEVCANON_RUNTIME_DIR: root,
            RUNTIME_CONTRACT_OUTPUT: output,
            RUNTIME_CONTRACT_EXIT: exit ?? "0",
            RUNTIME_DISPATCH_MARKER: marker,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            stderr ?? "runtime contract is incompatible",
          ),
        });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          readFile(path.join(cwd, capturePath), "utf8"),
        ).resolves.toContain("provider-scope-capture/v1");
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(root);
      }
    },
  );

  it("produces provider scope evidence through the compatible distinct runtime route", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
    try {
      await writeJson(
        cwd,
        capturePath,
        await providerScopeCapture(cwd, baseSha, headSha),
      );
      await expect(
        runHelper(cwd, helperScript, "write-provider-scope-evidence", {
          HEAD_SHA: headSha,
          PROVIDER_SCOPE_CAPTURE_FILE: capturePath,
        }),
      ).resolves.toMatchObject({
        stdout: `${providerScopePath(headSha)}\n`,
        stderr: "",
      });
      await expect(
        readFile(path.join(cwd, capturePath), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses the runtime ASCII branch slug for a Unicode provider capture path", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const capturePath = `.ephemeral/feat--${headSha}-provider-scope-capture.json`;
    const evidencePath = `.ephemeral/feat--${headSha}-provider-scope-evidence.json`;
    try {
      await execFileAsync("git", ["switch", "-C", "feat/한글"], { cwd });
      await expect(
        readFile(path.join(process.cwd(), "skills/pr-review/SKILL.md"), "utf8"),
      ).resolves.toContain("LC_ALL=C tr -cd '[:alnum:]._-'");
      const { stdout: documentedSlug } = await execFileAsync("bash", [
        "-c",
        'LC_ALL=C printf "%s" "$1" | LC_ALL=C tr "/" "-" | LC_ALL=C tr -cd "[:alnum:]._-"',
        "bash",
        "feat/한글",
      ]);
      expect(documentedSlug).toBe("feat-");
      await writeJson(
        cwd,
        capturePath,
        await providerScopeCapture(cwd, baseSha, headSha),
      );
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n` });
      await expect(
        runHelper(cwd, helperScript, "write-provider-scope-evidence", {
          HEAD_SHA: headSha,
          PROVIDER_SCOPE_CAPTURE_FILE: capturePath,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n`, stderr: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.each([{ name: "copied" }, { name: "symlinked" }])(
    "resolves a $name installed sibling runtime for provider production",
    async ({ name }) => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const root = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-pr-installed-"),
      );
      const capturePath = `.ephemeral/topic-${headSha}-provider-scope-capture.json`;
      const marker = path.join(root, "dispatch");
      try {
        const script = await copyInstalledPrAdapter(root);
        const runtimeSource = await mkdtemp(
          path.join(os.tmpdir(), "devcanon-runtime-source-"),
        );
        await writeMarkerRuntime(runtimeSource);
        if (name === "symlinked") {
          await symlink(runtimeSource, path.join(root, "devcanon-runtime"));
        } else {
          await writeMarkerRuntime(path.join(root, "devcanon-runtime"));
        }
        await writeJson(
          cwd,
          capturePath,
          await providerScopeCapture(cwd, baseSha, headSha),
        );
        await expect(
          runHelper(cwd, script, "write-provider-scope-evidence", {
            HEAD_SHA: headSha,
            PROVIDER_SCOPE_CAPTURE_FILE: capturePath,
            RUNTIME_CONTRACT_OUTPUT:
              '{"command_group":"pr-review-provider-scope-evidence","major_version":1}\\n',
            RUNTIME_DISPATCH_MARKER: marker,
          }),
        ).resolves.toMatchObject({
          stdout: ".ephemeral/runtime-provider-scope-evidence.json\n",
        });
        await expect(readFile(marker, "utf8")).resolves.toBe("");
        await cleanupTempDir(runtimeSource);
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(root);
      }
    },
  );

  it("preserves prepare and validate commands in the source skill layout", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const threadsPath = priorThreadsPath(headSha);
      await writeInitialScope(cwd, baseSha, headSha);

      await expect(
        runHelper(cwd, helperScript, "prepare-prior-threads-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${threadsPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "prepare-scope-decision-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${decisionPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({
        stdout: `${providerScopePath(headSha)}\n`,
      });
      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: decisionPath,
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });
      await writeJson(cwd, threadsPath, priorThreadsEnvelope(headSha));
      await expect(
        runHelper(cwd, helperScript, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: threadsPath,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("guards provider evidence write targets before producer output", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const evidencePath = providerScopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n` });

      await writeFile(path.join(cwd, evidencePath), "existing\n");
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n` });

      await rm(path.join(cwd, evidencePath));
      await mkdir(path.join(cwd, evidencePath), { recursive: true });
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "provider scope evidence path is a directory",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses an explicit support-validator override and forwards PR scope policy flags", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-marker-"));
    try {
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).resolves.toMatchObject({ stdout: "override-validator\n" });
      const args = await readFile(markerArgs, "utf8");
      expect(args).toContain("validate-scope-decision");
      expect(args).toContain("pr-review/scope-decision/v1");
      expect(args).toContain("--base-ref");
      expect(args).toContain(baseSha);
      expect(args).toContain("--provider-scope-evidence-file");
      expect(args).toContain(providerScopePath(headSha));
      expect(args).toContain("--governed-path-pattern");
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("resolves an installed-style sibling support validator", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-installed-"),
    );
    try {
      const script = await copyInstalledPrAdapter(root);
      await writeMarkerValidator(root, "installed-validator");

      await expect(
        runHelper(cwd, script, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: priorThreadsPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "installed-validator\n" });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("fails before invoking an override validator when BASE_REF is missing", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-marker-"));
    try {
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("BASE_REF is required"),
      });
      await expect(readFile(markerArgs, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("rejects a self-consistent scope artifact with the wrong full-range base", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const baseTree = await git(cwd, "rev-parse", `${baseSha}^{tree}`);
      const wrongBaseSha = await git(
        cwd,
        "commit-tree",
        baseTree,
        "-p",
        baseSha,
        "-m",
        "wrong base",
      );
      const decisionPath = scopePath(headSha);
      await writeInitialScope(cwd, baseSha, headSha, {
        full_range: `${wrongBaseSha}..${headSha}`,
        selected_range: `${wrongBaseSha}..${headSha}`,
        candidate_narrow_range: `${wrongBaseSha}..${headSha}`,
      });

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: decisionPath,
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "full range must use provider PR diff base",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails loud when the support validator is unavailable", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-missing-"));
    try {
      const script = await copyInstalledPrAdapter(root);
      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: "HEAD^",
          SCOPE_DECISION_FILE: scopePath(headSha),
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "play-validate-review-artifacts validator missing",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("surfaces delegated support-validator failures", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const threadsPath = priorThreadsPath(headSha);
      await writeJson(
        cwd,
        threadsPath,
        priorThreadsEnvelope(headSha, {
          threads: [
            {
              ...priorThreadsEnvelope(headSha).threads[0],
              comments: [
                {
                  author: "reviewer",
                  created_at: "2026-13-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:01Z",
                  body: "Bad timestamp.",
                  is_bot: false,
                  minimized_reason: null,
                },
              ],
            },
          ],
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: threadsPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "prior-thread timestamp validation failed",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
