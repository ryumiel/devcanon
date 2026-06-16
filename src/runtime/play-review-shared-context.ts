import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type RuntimeCommandOutcome =
  | { exitCode: 0; stdout: string; stderr: string }
  | { exitCode: 1; stdout: string; stderr: string };

type JsonObject = Record<string, unknown>;

interface SharedContextInput {
  schema: "play-review/shared-context-input/v1";
  header: {
    working_directory: string;
    base_ref: string;
    head_sha: string;
    active_diff_range: string;
    full_pr_diff_range: string;
    mode: "present" | "fix" | "github-post";
    language_hints: string[];
  };
  changed_files: {
    command: string;
    total_count: number;
    truncated: boolean;
    records: Array<{ status: string; path: string }>;
  };
  doc_impact_summary: {
    arch_files: string[];
    new_adrs: string[];
    modified_adrs: string[];
    architecture_routing_risks: RoutingRisk;
    spec_routing_risks: RoutingRisk;
    notes?: string | null;
  };
  adr_references: Array<{ path: string; reason: string }>;
  discovered_guidelines: {
    records: GuidelineRecord[];
  };
  output_format: {
    markdown: string;
  };
  prior_review_context?: {
    records: PriorReviewRecord[];
  } | null;
}

interface RoutingRisk {
  mechanical_path_signals: string[];
  semantic_classification_notes: string[];
}

interface GuidelineRecord {
  path: string;
  bytes: number;
  summary: string;
  priority?: string | null;
  exact_excerpts?: string[] | null;
}

interface PriorReviewRecord {
  source: {
    kind: string;
    reference: string;
  };
  bytes: number;
  summary: string;
  exact_excerpt?: string | null;
  untrusted: true;
}

const TOTAL_BUDGET = 64_000;
const CORE_BUDGET = 20_000;
const GUIDELINE_BUDGET = 24_000;
const PRIOR_BUDGET = 16_000;
const GUIDELINE_ITEM_LIMIT = 12;
const PRIOR_ITEM_LIMIT = 20;
const GUIDELINE_EXCERPT_LIMIT = 4_000;
const PRIOR_EXCERPT_LIMIT = 2_000;

export async function runPlayReviewSharedContextCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  try {
    const [commandName] = args;
    switch (commandName) {
      case "build-review-context":
        return ok(`${await buildReviewContext()}\n`);
      default:
        throw new SharedContextError(
          "usage: shared-review-context.sh build-review-context",
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function buildReviewContext(): Promise<string> {
  const repoRoot = await requireRepoRoot();
  const headSha = requiredEnv("HEAD_SHA");
  validateHeadSha(headSha);
  const findingsFile = requiredEnv("FINDINGS_FILE");
  const reviewContextInputFile = requiredEnv("REVIEW_CONTEXT_INPUT_FILE");
  validateFindingsPath(findingsFile, headSha);
  const reviewContextOutputFile = deriveOutputPath(
    findingsFile,
    reviewContextInputFile,
  );
  await guardReadInputAndOutput(
    reviewContextInputFile,
    reviewContextOutputFile,
  );
  const manifest = await readManifest(reviewContextInputFile);
  validateManifestBindings(manifest, headSha, repoRoot);

  const coreSection = buildCoreSection(
    manifest,
    headSha,
    findingsFile,
    reviewContextInputFile,
    repoRoot,
  );
  if (byteCount(coreSection) > CORE_BUDGET) {
    throw new SharedContextError("core section byte budget exceeded");
  }

  const guidelineSection = buildGuidelineSection(manifest);
  const priorSection = buildPriorSection(manifest);
  const content = `${coreSection}${guidelineSection}${priorSection}`;
  if (content.length === 0) {
    throw new SharedContextError("review context output is empty");
  }
  if (byteCount(content) > TOTAL_BUDGET) {
    throw new SharedContextError("review context byte budget exceeded");
  }

  await writeReviewContext(reviewContextOutputFile, content);
  const written = await readFile(reviewContextOutputFile, "utf8");
  if (written.length === 0) {
    throw new SharedContextError("review context output is empty");
  }
  if (byteCount(written) > TOTAL_BUDGET) {
    throw new SharedContextError("review context byte budget exceeded");
  }
  return reviewContextOutputFile;
}

async function requireRepoRoot(): Promise<string> {
  let gitToplevel: string;
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
    gitToplevel = result.stdout.trim();
  } catch {
    throw new SharedContextError("failed to determine git repository root");
  }

  let physicalToplevel: string;
  try {
    physicalToplevel = await realpath(gitToplevel);
  } catch {
    throw new SharedContextError("failed to resolve git repository root");
  }

  const physicalCwd = await realpath(process.cwd());
  if (physicalToplevel !== physicalCwd) {
    throw new SharedContextError(
      "shared-review-context.sh must run from the repository root",
    );
  }
  return physicalToplevel;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new SharedContextError(`${name} is required`);
  }
  return value;
}

function validateHeadSha(headSha: string): void {
  if (!/^[0-9a-f]{40}$/u.test(headSha)) {
    throw new SharedContextError(
      "HEAD_SHA must be a 40-character lowercase hex SHA",
    );
  }
}

function validateDirectEphemeralPath(
  label: string,
  file: string,
  suffix: string,
): void {
  if (file.includes("..")) {
    throw new SharedContextError(`path traversal: ${file}`);
  }
  if (file.startsWith("/")) {
    throw new SharedContextError(
      `${label} path must be repo-relative: ${file}`,
    );
  }
  if (!file.startsWith(".ephemeral/") || !file.endsWith(suffix)) {
    throw new SharedContextError(`${label} path validation failed: ${file}`);
  }
  const rest = file.slice(".ephemeral/".length);
  if (rest.includes("/")) {
    throw new SharedContextError(`nested ${label} path rejected: ${file}`);
  }
}

function validateFindingsPath(findingsFile: string, headSha: string): void {
  validateDirectEphemeralPath("findings", findingsFile, "-findings.json");
  if (!findingsFile.endsWith(`-${headSha}-findings.json`)) {
    throw new SharedContextError(
      `findings path must include HEAD_SHA: ${findingsFile}`,
    );
  }
}

function deriveOutputPath(
  findingsFile: string,
  reviewContextInputFile: string,
): string {
  const expectedInputFile = findingsFile.replace(
    /-findings\.json$/u,
    "-review-context-input.json",
  );
  const reviewContextOutputFile = findingsFile.replace(
    /-findings\.json$/u,
    "-review-context.md",
  );
  validateDirectEphemeralPath(
    "review context input",
    expectedInputFile,
    "-review-context-input.json",
  );
  validateDirectEphemeralPath(
    "review context output",
    reviewContextOutputFile,
    "-review-context.md",
  );
  validateDirectEphemeralPath(
    "review context input",
    reviewContextInputFile,
    "-review-context-input.json",
  );
  if (reviewContextInputFile !== expectedInputFile) {
    throw new SharedContextError(
      `review context input path mismatch: ${reviewContextInputFile}`,
    );
  }
  return reviewContextOutputFile;
}

async function guardReadInputAndOutput(
  reviewContextInputFile: string,
  reviewContextOutputFile: string,
): Promise<void> {
  const ephemeralStat = await lstat(".ephemeral").catch(() => null);
  if (ephemeralStat?.isSymbolicLink()) {
    throw new SharedContextError(
      ".ephemeral must be a directory, not a symlink",
    );
  }

  const inputStat = await lstat(reviewContextInputFile).catch(() => null);
  if (inputStat?.isSymbolicLink()) {
    throw new SharedContextError(
      `review context input must not be a symlink: ${reviewContextInputFile}`,
    );
  }
  if (inputStat === null || !inputStat.isFile()) {
    throw new SharedContextError(
      `review context input missing or not a regular file: ${reviewContextInputFile}`,
    );
  }
  await access(reviewContextInputFile, constants.R_OK).catch(() => {
    throw new SharedContextError(
      `review context input missing or unreadable: ${reviewContextInputFile}`,
    );
  });

  const outputStat = await lstat(reviewContextOutputFile).catch(() => null);
  if (outputStat?.isSymbolicLink()) {
    throw new SharedContextError(
      `review context output must not be a symlink: ${reviewContextOutputFile}`,
    );
  }
  if (outputStat?.isDirectory()) {
    throw new SharedContextError(
      `review context output path is a directory: ${reviewContextOutputFile}`,
    );
  }
  if (outputStat !== null && !outputStat.isFile()) {
    throw new SharedContextError(
      `review context output exists but is not a regular file: ${reviewContextOutputFile}`,
    );
  }
}

async function readManifest(file: string): Promise<SharedContextInput> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new SharedContextError(
      `review context input missing or unreadable: ${file}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SharedContextError(`manifest JSON is malformed: ${file}`);
  }

  if (!isSharedContextInput(parsed)) {
    if (hasInvalidMode(parsed)) {
      throw new SharedContextError(
        "manifest mode must be present, fix, or github-post",
      );
    }
    if (hasInvalidGuidelineSummary(parsed)) {
      throw new SharedContextError("guideline summary is required");
    }
    if (hasInvalidPriorUntrustedFlag(parsed)) {
      throw new SharedContextError("prior review untrusted flag must be true");
    }
    if (hasInvalidPriorSummary(parsed)) {
      throw new SharedContextError("prior review summary is required");
    }
    throw new SharedContextError(`manifest schema mismatch: ${file}`);
  }

  return parsed;
}

function validateManifestBindings(
  manifest: SharedContextInput,
  headSha: string,
  repoRoot: string,
): void {
  if (manifest.header.head_sha !== headSha) {
    throw new SharedContextError(
      `manifest head_sha mismatch: ${manifest.header.head_sha}`,
    );
  }
  if (manifest.header.working_directory !== repoRoot) {
    throw new SharedContextError(
      `manifest working_directory mismatch: ${manifest.header.working_directory}`,
    );
  }
}

function buildCoreSection(
  manifest: SharedContextInput,
  headSha: string,
  findingsFile: string,
  reviewContextInputFile: string,
  repoRoot: string,
): string {
  const lines = new Lines();
  lines.add("# Shared Review Context");
  lines.add("");
  lines.add(`Review head: ${headSha}`);
  lines.add(`Findings file: ${findingsFile}`);
  lines.add(`Input manifest: ${reviewContextInputFile}`);
  lines.add(`Working directory: ${repoRoot}`);
  lines.add("");
  lines.add("## Core Review Surface");
  lines.add(`- **Base ref:** ${manifest.header.base_ref}`);
  lines.add(`- **Active diff range:** ${manifest.header.active_diff_range}`);
  lines.add(`- **Full PR diff range:** ${manifest.header.full_pr_diff_range}`);
  lines.add(`- **Mode:** ${manifest.header.mode}`);
  lines.add(
    `- **Language hints:** ${manifest.header.language_hints.join(", ")}`,
  );
  lines.add(`- **Changed-files command:** ${manifest.changed_files.command}`);
  lines.add(`- **Changed-files total:** ${manifest.changed_files.total_count}`);
  lines.add(
    `- **Changed-files truncated:** ${manifest.changed_files.truncated}`,
  );
  lines.add("");
  lines.add("### Changed Files");
  if (manifest.changed_files.records.length === 0) {
    lines.add("(none)");
  } else {
    for (const record of manifest.changed_files.records) {
      lines.add(
        `- ${escapeUntrustedManifestText(record.status)} ${escapeUntrustedManifestText(record.path)}`,
      );
    }
  }
  lines.add("");
  lines.add("### Documentation Impact");
  appendArrayValues(
    lines,
    "Architecture files",
    manifest.doc_impact_summary.arch_files,
  );
  appendArrayValues(lines, "New ADRs", manifest.doc_impact_summary.new_adrs);
  appendArrayValues(
    lines,
    "Modified ADRs",
    manifest.doc_impact_summary.modified_adrs,
  );
  appendRoutingRiskValues(
    lines,
    "Architecture routing risks",
    manifest.doc_impact_summary.architecture_routing_risks,
  );
  appendRoutingRiskValues(
    lines,
    "Spec routing risks",
    manifest.doc_impact_summary.spec_routing_risks,
  );
  if (manifest.doc_impact_summary.notes) {
    lines.add(
      `- **Notes:** ${escapeUntrustedMarkdownText(manifest.doc_impact_summary.notes)}`,
    );
  }
  lines.add("");
  lines.add("### ADR References");
  if (manifest.adr_references.length === 0) {
    lines.add("(none)");
  } else {
    for (const record of manifest.adr_references) {
      lines.add(
        `- ${escapeUntrustedManifestText(record.path)} - ${escapeUntrustedManifestText(record.reason)}`,
      );
    }
  }
  lines.add("");
  lines.add("## Output Format");
  lines.text(`${manifest.output_format.markdown}\n`);
  lines.add("");
  return lines.toString();
}

function appendArrayValues(
  lines: Lines,
  title: string,
  values: string[],
): void {
  lines.add(`- **${title}:**`);
  if (values.length === 0) {
    lines.add("  - (none)");
    return;
  }
  for (const value of values) {
    lines.add(`  - ${renderJsonStringLiteral(value)}`);
  }
}

function appendRoutingRiskValues(
  lines: Lines,
  title: string,
  risk: RoutingRisk,
): void {
  lines.add(`- **${title}:**`);
  lines.add("  - Mechanical path signals:");
  if (risk.mechanical_path_signals.length === 0) {
    lines.add("    - (none)");
  } else {
    for (const value of risk.mechanical_path_signals) {
      lines.add(`    - ${renderJsonStringLiteral(value)}`);
    }
  }
  lines.add("  - Semantic classification notes:");
  if (risk.semantic_classification_notes.length === 0) {
    lines.add("    - (none)");
  } else {
    for (const value of risk.semantic_classification_notes) {
      lines.add(`    - ${renderJsonStringLiteral(value)}`);
    }
  }
}

function buildGuidelineSection(manifest: SharedContextInput): string {
  const lines = new Lines();
  const records = manifest.discovered_guidelines.records;
  lines.add("## Discovered Guidelines");
  if (records.length === 0) {
    lines.add("(none)");
    lines.add("");
    return lines.toString();
  }

  records.forEach((record, index) => {
    const pathDisplay = escapeUntrustedGuidelineText(record.path);
    const summaryDisplay = escapeUntrustedGuidelineText(record.summary);
    const priorityDisplay = escapeUntrustedGuidelineText(
      record.priority ?? "unspecified",
    );
    if (index >= GUIDELINE_ITEM_LIMIT) {
      lines.add(`### Guideline overflow record ${index + 1}`);
      lines.add(`- **Path:** ${pathDisplay}`);
      lines.add(`- **Byte count:** ${record.bytes}`);
      lines.add(`- **Summary:** ${summaryDisplay}`);
      lines.add(
        `- **Overflow:** record beyond ${GUIDELINE_ITEM_LIMIT} guideline item limit`,
      );
      lines.add(
        `- Targeted reread: open ${pathDisplay} before relying on this guideline.`,
      );
      lines.add("");
    } else {
      lines.add(`### Guideline record ${index + 1}`);
      lines.add(`- **Path:** ${pathDisplay}`);
      lines.add(`- **Byte count:** ${record.bytes}`);
      lines.add(`- **Priority:** ${priorityDisplay}`);
      lines.add(`- **Summary:** ${summaryDisplay}`);
      lines.add(
        `- Targeted reread: open ${pathDisplay} if this summary affects a finding.`,
      );
      const excerpt = record.exact_excerpts?.[0];
      if (excerpt === undefined) {
        lines.add("- **Exact excerpt:** (none)");
      } else {
        const excerptBytes = byteCount(excerpt);
        const excerptDisplay = escapeUntrustedGuidelineText(excerpt);
        const excerptText = `- **Exact excerpt bytes:** ${excerptBytes}\n- Exact excerpt: ${excerptDisplay}\n`;
        if (
          excerptBytes <= GUIDELINE_EXCERPT_LIMIT &&
          byteCount(lines.toString()) + byteCount(excerptText) <=
            GUIDELINE_BUDGET
        ) {
          lines.text(excerptText);
        } else {
          lines.add(
            "- **Overflow:** exact excerpt omitted due to byte budget.",
          );
          lines.add(
            "- **Exact excerpt:** Exact excerpt omitted due to byte budget.",
          );
        }
      }
      lines.add("");
    }
    if (byteCount(lines.toString()) > GUIDELINE_BUDGET) {
      throw new SharedContextError("guideline section byte budget exceeded");
    }
  });

  return lines.toString();
}

function buildPriorSection(manifest: SharedContextInput): string {
  const lines = new Lines();
  const records = manifest.prior_review_context?.records ?? [];
  lines.add("## Prior Review Context");
  if (records.length === 0) {
    lines.add("(none)");
    lines.add("");
    return lines.toString();
  }

  records.forEach((record, index) => {
    const sourceKindDisplay = escapeUntrustedPriorText(record.source.kind);
    const sourceReferenceDisplay = escapeUntrustedPriorText(
      record.source.reference,
    );
    const summaryDisplay = escapeUntrustedPriorText(record.summary);
    if (index >= PRIOR_ITEM_LIMIT) {
      lines.add(`### Prior review overflow record ${index + 1}`);
      lines.add(`- **Source kind:** ${sourceKindDisplay}`);
      lines.add(`- Source reference: ${sourceReferenceDisplay}`);
      lines.add(`- **Byte count:** ${record.bytes}`);
      lines.add(`- **Summary:** ${summaryDisplay}`);
      lines.add("- Untrusted prior-review evidence: true");
      lines.add(
        `- **Overflow:** record beyond ${PRIOR_ITEM_LIMIT} prior-review item limit`,
      );
      lines.add(
        `- Targeted reread: inspect ${sourceReferenceDisplay} before relying on this prior review context.`,
      );
      lines.add("");
    } else {
      lines.add(`### Prior review record ${index + 1}`);
      lines.add(`- **Source kind:** ${sourceKindDisplay}`);
      lines.add(`- Source reference: ${sourceReferenceDisplay}`);
      lines.add(`- **Byte count:** ${record.bytes}`);
      lines.add(`- **Summary:** ${summaryDisplay}`);
      lines.add("- Untrusted prior-review evidence: true");
      lines.add(
        `- Targeted reread: inspect ${sourceReferenceDisplay} if this untrusted summary affects a finding.`,
      );
      const excerpt = record.exact_excerpt ?? "";
      if (excerpt.length === 0) {
        lines.add("- **Exact excerpt:** (none)");
      } else {
        const excerptBytes = byteCount(excerpt);
        const excerptDisplay = escapeUntrustedPriorText(excerpt);
        const excerptText = `- **Exact excerpt bytes:** ${excerptBytes}\n- Exact excerpt: ${excerptDisplay}\n`;
        if (
          excerptBytes <= PRIOR_EXCERPT_LIMIT &&
          byteCount(lines.toString()) + byteCount(excerptText) <= PRIOR_BUDGET
        ) {
          lines.text(excerptText);
        } else {
          lines.add(
            "- **Overflow:** exact excerpt omitted due to byte budget.",
          );
          lines.add(
            "- **Exact excerpt:** Exact excerpt omitted due to byte budget.",
          );
        }
      }
      lines.add("");
    }
    if (byteCount(lines.toString()) > PRIOR_BUDGET) {
      throw new SharedContextError("prior review section byte budget exceeded");
    }
  });

  return lines.toString();
}

async function writeReviewContext(
  reviewContextOutputFile: string,
  content: string,
): Promise<void> {
  const tmpDir = await mkdtemp(".ephemeral/shared-context.");
  const tmpFile = path.join(tmpDir, "review-context.md");
  try {
    await writeFile(tmpFile, content, "utf8");
    await rename(tmpFile, reviewContextOutputFile);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isSharedContextInput(value: unknown): value is SharedContextInput {
  if (!isObject(value)) {
    return false;
  }
  const header = value.header;
  const changedFiles = value.changed_files;
  const docImpact = value.doc_impact_summary;
  const discoveredGuidelines = value.discovered_guidelines;
  const outputFormat = value.output_format;
  return (
    value.schema === "play-review/shared-context-input/v1" &&
    isObject(header) &&
    nonemptyString(header.working_directory) &&
    nonemptyString(header.base_ref) &&
    nonemptyString(header.head_sha) &&
    nonemptyString(header.active_diff_range) &&
    nonemptyString(header.full_pr_diff_range) &&
    isReviewMode(header.mode) &&
    requiredStringArray(header.language_hints) &&
    isObject(changedFiles) &&
    nonemptyString(changedFiles.command) &&
    nonnegativeInteger(changedFiles.total_count) &&
    typeof changedFiles.truncated === "boolean" &&
    Array.isArray(changedFiles.records) &&
    changedFiles.records.every(isChangedFile) &&
    isObject(docImpact) &&
    Array.isArray(docImpact.arch_files) &&
    docImpact.arch_files.every(repoRelativePath) &&
    Array.isArray(docImpact.new_adrs) &&
    docImpact.new_adrs.every(repoRelativePath) &&
    Array.isArray(docImpact.modified_adrs) &&
    docImpact.modified_adrs.every(repoRelativePath) &&
    isRoutingRisk(docImpact.architecture_routing_risks) &&
    isRoutingRisk(docImpact.spec_routing_risks) &&
    (docImpact.notes === null ||
      docImpact.notes === undefined ||
      nonemptyString(docImpact.notes)) &&
    Array.isArray(value.adr_references) &&
    value.adr_references.every(isAdrReference) &&
    isObject(discoveredGuidelines) &&
    Array.isArray(discoveredGuidelines.records) &&
    discoveredGuidelines.records.every(isGuidelineRecord) &&
    isObject(outputFormat) &&
    nonemptyString(outputFormat.markdown) &&
    (value.prior_review_context === null ||
      value.prior_review_context === undefined ||
      (isObject(value.prior_review_context) &&
        Array.isArray(value.prior_review_context.records) &&
        value.prior_review_context.records.every(isPriorReviewRecord)))
  );
}

function isChangedFile(value: unknown): boolean {
  return (
    isObject(value) &&
    nonemptyString(value.status) &&
    repoRelativePath(value.path)
  );
}

function isRoutingRisk(value: unknown): boolean {
  return (
    isObject(value) &&
    Array.isArray(value.mechanical_path_signals) &&
    value.mechanical_path_signals.every(repoRelativePath) &&
    requiredStringArray(value.semantic_classification_notes)
  );
}

function isAdrReference(value: unknown): boolean {
  return (
    isObject(value) &&
    repoRelativePath(value.path) &&
    nonemptyString(value.reason)
  );
}

function isGuidelineRecord(value: unknown): boolean {
  return (
    isObject(value) &&
    repoRelativePath(value.path) &&
    nonnegativeInteger(value.bytes) &&
    nonemptyString(value.summary) &&
    (value.priority === null ||
      value.priority === undefined ||
      nonemptyString(value.priority)) &&
    (value.exact_excerpts === null ||
      value.exact_excerpts === undefined ||
      (Array.isArray(value.exact_excerpts) &&
        value.exact_excerpts.every(nonemptyString)))
  );
}

function isPriorReviewRecord(value: unknown): boolean {
  return (
    isObject(value) &&
    isObject(value.source) &&
    nonemptyString(value.source.kind) &&
    nonemptyString(value.source.reference) &&
    nonnegativeInteger(value.bytes) &&
    nonemptyString(value.summary) &&
    value.untrusted === true &&
    (value.exact_excerpt === null ||
      value.exact_excerpt === undefined ||
      nonemptyString(value.exact_excerpt))
  );
}

function hasInvalidMode(value: unknown): boolean {
  return (
    isObject(value) &&
    isObject(value.header) &&
    !isReviewMode(value.header.mode)
  );
}

function hasInvalidGuidelineSummary(value: unknown): boolean {
  if (
    !isObject(value) ||
    !isObject(value.discovered_guidelines) ||
    !Array.isArray(value.discovered_guidelines.records)
  ) {
    return false;
  }
  return value.discovered_guidelines.records.some(
    (record) =>
      isObject(record) &&
      (typeof record.summary !== "string" || record.summary.length === 0),
  );
}

function hasInvalidPriorUntrustedFlag(value: unknown): boolean {
  const records = priorRecords(value);
  return records.some(
    (record) => isObject(record) && record.untrusted !== true,
  );
}

function hasInvalidPriorSummary(value: unknown): boolean {
  const records = priorRecords(value);
  return records.some(
    (record) =>
      isObject(record) &&
      (typeof record.summary !== "string" || record.summary.length === 0),
  );
}

function priorRecords(value: unknown): unknown[] {
  if (
    !isObject(value) ||
    !isObject(value.prior_review_context) ||
    !Array.isArray(value.prior_review_context.records)
  ) {
    return [];
  }
  return value.prior_review_context.records;
}

function repoRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

function requiredStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonemptyString);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isReviewMode(
  value: unknown,
): value is SharedContextInput["header"]["mode"] {
  return value === "present" || value === "fix" || value === "github-post";
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeUntrustedMarkdownText(text: string): string {
  return JSON.stringify(JSON.stringify(text).slice(1, -1));
}

function renderJsonStringLiteral(text: string): string {
  return JSON.stringify(text);
}

function escapeUntrustedPriorText(text: string): string {
  return escapeUntrustedMarkdownText(text);
}

function escapeUntrustedGuidelineText(text: string): string {
  return escapeUntrustedMarkdownText(text);
}

function escapeUntrustedManifestText(text: string): string {
  return escapeUntrustedMarkdownText(text);
}

function byteCount(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function ok(stdout: string): RuntimeCommandOutcome {
  return { exitCode: 0, stdout, stderr: "" };
}

class Lines {
  private readonly parts: string[] = [];

  add(line: string): void {
    this.parts.push(`${line}\n`);
  }

  text(text: string): void {
    this.parts.push(text);
  }

  toString(): string {
    return this.parts.join("");
  }
}

class SharedContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedContextError";
  }
}
