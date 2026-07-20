import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  type AgentRoutingDirectChildRouteRow,
  type AgentRoutingRouteClause,
  type AgentSemanticRoleContract,
  parseAgentSemanticRoleOwner,
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";
import {
  getSkillOutput,
  listRelativeFiles,
  normalizeWhitespace,
  parseRenderedMarkdownArtifact,
  parseRenderedTomlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { CODEX_SKILL_OVERRIDE_FIELDS } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const SKILLS_WITH_METADATA = {
  claudeFrontmatter: [
    "github-issue-priming",
    "issue-batch-routing",
    "issue-priming-workflow",
    "linear-issue-priming",
  ] as const,
  codexFrontmatter: [
    "github-issue-priming",
    "issue-batch-routing",
    "linear-issue-priming",
    "report-devcanon-issue",
  ] as const,
  sidecar: [
    "github-issue-priming",
    "issue-batch-routing",
    "linear-issue-priming",
    "pr-review",
    "report-devcanon-issue",
    "write-linear-project-description",
    "write-linear-project-update",
  ] as const,
  policySidecar: [
    "issue-priming-workflow",
    "play-review",
    "play-validate-review-artifacts",
    "subagent-lifecycle",
  ] as const,
};

const PUBLIC_EXPLICIT_PLAY_SKILLS = [
  "play-agent-dispatch",
  "play-brainstorm",
  "play-branch-finish",
  "play-debug",
  "play-planning",
  "play-review-response",
  "play-skill-authoring",
  "play-subagent-execution",
  "play-tdd",
  "play-verification",
] as const;

interface AgentSourceContract {
  name: string;
  description: string;
  instructions: string;
  capability: string;
  claude: { effort: string; tools: string[] };
  codex: { model_reasoning_effort: string; sandbox_mode: string };
}

interface ParsedRenderedAgent {
  name: unknown;
  description: unknown;
  model: unknown;
  effort: unknown;
  instructions: string;
}

type RoutingOwner = Awaited<ReturnType<typeof readAgentRoutingPolicyOwner>>;

const TOUCHED_SKILL_COVERAGE = {
  "github-issue-priming":
    "explicit metadata expectations cover Claude model, Codex metadata, and Codex sidecar packaging",
  "issue-batch-routing":
    "explicit metadata expectations cover Claude model, Codex metadata, and Codex sidecar packaging",
  "issue-priming-workflow":
    "explicit metadata expectations cover Claude model and Codex policy sidecar packaging",
  "issue-slicing":
    "Codex frontmatter smoke coverage protects recently touched shared skill prose from invalid Codex keys",
  "issue-worktree-setup":
    "Codex frontmatter smoke coverage protects recently touched shared skill prose from invalid Codex keys",
  "linear-issue-priming":
    "explicit metadata expectations cover Claude model, Codex metadata, and Codex sidecar packaging",
  "write-linear-project-update":
    "explicit metadata expectations cover Codex sidecar packaging and Codex frontmatter smoke coverage",
  "write-linear-project-description":
    "explicit metadata expectations cover Codex sidecar packaging and Codex frontmatter smoke coverage",
  "play-brainstorm":
    "Codex frontmatter smoke coverage protects recently touched workflow skill prose from invalid Codex keys",
  "play-branch-finish":
    "Codex frontmatter smoke coverage protects recently touched workflow skill prose from invalid Codex keys",
  "play-debug":
    "explicit-only workflow metadata coverage protects debugging from implicit workflow selection",
  "play-agent-dispatch":
    "Codex frontmatter smoke coverage protects recently touched dispatch skill prose from invalid Codex keys",
  "pr-review": "explicit metadata expectations cover Codex sidecar packaging",
  "branch-review":
    "Codex frontmatter smoke coverage protects recently touched review wrapper prose from invalid Codex keys",
  "play-review":
    "explicit metadata expectations cover Codex policy sidecar packaging",
  "play-subagent-execution":
    "Codex frontmatter smoke coverage protects recently touched execution skill prose from invalid Codex keys",
  "pr-merge":
    "Codex frontmatter smoke coverage protects recently touched merge skill prose from invalid Codex keys",
  "play-skill-authoring":
    "Codex frontmatter smoke coverage protects recently touched skill-authoring prose from invalid Codex keys",
  "play-planning":
    "Codex frontmatter smoke coverage protects recently touched planning skill prose from invalid Codex keys",
  "play-review-response":
    "explicit-only workflow metadata coverage protects review-shaped feedback from implicit workflow selection",
  "report-devcanon-issue":
    "explicit metadata expectations cover Codex metadata and Codex sidecar packaging",
  "spec-readiness-review":
    "Codex frontmatter smoke coverage protects recently touched readiness-review prose from invalid Codex keys",
  "subagent-lifecycle":
    "explicit metadata expectations cover Codex policy sidecar packaging",
  "play-tdd":
    "explicit-only workflow metadata coverage protects implementation-adjacent discussion from implicit TDD selection",
  "play-verification":
    "explicit-only workflow metadata coverage protects completion checks from implicit workflow selection",
  "play-validate-review-artifacts":
    "explicit metadata expectations cover the support-only validator policy sidecar, support references, and script packaging",
  "write-product-requirements":
    "Codex frontmatter smoke coverage protects recently touched product requirements skill prose from invalid Codex keys",
  "write-product-spec":
    "Codex frontmatter smoke coverage protects mirrored reference packaging assertions for this skill",
} as const;

type TouchedSkill = keyof typeof TOUCHED_SKILL_COVERAGE;

const TOUCHED_SKILL_NAMES = Object.keys(
  TOUCHED_SKILL_COVERAGE,
) as TouchedSkill[];
const TOUCHED_SKILLS: ReadonlySet<string> = new Set(TOUCHED_SKILL_NAMES);

function getMetadataExpectationSkills(): Set<string> {
  return new Set(Object.values(SKILLS_WITH_METADATA).flat());
}

const CODEX_ALLOWED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "allowed-tools",
  ...CODEX_SKILL_OVERRIDE_FIELDS,
]);

const GITHUB_CLI_PLACEHOLDER = "{{tool:github-cli}}";
const WORKFLOW_GUIDE_PLACEHOLDER = "{{file:workflow-guide}}";

const SKILLS_WITH_GITHUB_CLI_PLACEHOLDER = [
  "branch-review",
  "github-issue-priming",
  "play-brainstorm",
  "play-branch-finish",
  "play-review",
  "play-review-response",
  "pr-authoring",
  "pr-merge",
  "pr-review",
] as const;

const SKILLS_WITH_WORKFLOW_GUIDE_PLACEHOLDER = [
  "doc-gardening",
  "play-branch-finish",
  "play-planning",
  "play-review",
  "pr-authoring",
  "pr-merge",
  "report-devcanon-issue",
  "write-product-requirements",
  "write-product-spec",
] as const;

function renderDogfoodGlossaryPlaceholders(value: string): string {
  return value
    .replaceAll(GITHUB_CLI_PLACEHOLDER, "gh")
    .replaceAll(WORKFLOW_GUIDE_PLACEHOLDER, "WORKFLOW.md");
}

function expectPlaceholderLinesRendered(
  source: string,
  output: string,
  placeholder: string,
): void {
  const expectedLines = source
    .split("\n")
    .filter((line) => line.includes(placeholder))
    .map(renderDogfoodGlossaryPlaceholders);

  expect(expectedLines.length).toBeGreaterThan(0);

  for (const expectedLine of expectedLines) {
    expect(output).toContain(expectedLine);
  }
}

async function readAgentSources(): Promise<AgentSourceContract[]> {
  const agentsDir = path.join(process.cwd(), "agents");
  const files = (await readdir(agentsDir)).filter((entry) =>
    entry.endsWith(".yaml"),
  );
  return Promise.all(
    files.map(async (file) =>
      parseYaml(await readFile(path.join(agentsDir, file), "utf8")),
    ),
  ) as Promise<AgentSourceContract[]>;
}

function normalizedEvidence(value: string): string {
  return normalizeWhitespace(value).replaceAll("-", " ").toLowerCase();
}

function routeAnchorMatches(
  unit: string,
  route: AgentRoutingDirectChildRouteRow,
): boolean {
  const normalized = normalizedEvidence(unit);
  const labels = [
    route.evidenceLabel,
    route.evidenceLabel.replace(/^(?:skill|issue)\s+/i, ""),
    route.evidenceLabel.replace(/\s+(?:topical|review|implementation)$/i, ""),
  ].map(normalizedEvidence);
  if (/\stopical$/i.test(route.evidenceLabel)) {
    return (
      normalized.includes(labels[2]) &&
      new RegExp(`\\b${route.id}\\b`, "i").test(unit)
    );
  }
  return (
    labels.some((label) => label.length > 6 && normalized.includes(label)) ||
    new RegExp(`\\b${route.id}\\b`, "i").test(unit) ||
    (route.evidenceLocator !== undefined &&
      normalized.includes(normalizedEvidence(route.evidenceLocator)))
  );
}

function markdownStructuralUnits(markdown: string): {
  atomic: string[];
  sections: string[];
} {
  const lines = markdown.split("\n");
  const sections = lines.flatMap((line, start) => {
    const heading = /^(#{1,6})\s/.exec(line);
    if (!heading) return [];
    const endOffset = lines.slice(start + 1).findIndex((candidate) => {
      const next = /^(#{1,6})\s/.exec(candidate);
      return next !== null && next[1].length <= heading[1].length;
    });
    const end = endOffset === -1 ? lines.length : start + endOffset + 1;
    return [lines.slice(start, end).join("\n")];
  });
  const paragraphs = markdown.split(/\n\s*\n/).filter(Boolean);
  const sentences = paragraphs.flatMap((paragraph) =>
    paragraph.split(/(?<=[.!?])\s+(?=[A-Z`])/),
  );
  const sortUnits = (units: string[]): string[] =>
    units
      .map((unit) => unit.trim())
      .filter(Boolean)
      .sort((left, right) => left.length - right.length);
  return {
    atomic: sortUnits([
      ...lines.filter((line) => line.startsWith("|")),
      ...sentences,
      ...paragraphs,
    ]),
    sections: sortUnits(sections),
  };
}

function clausePattern(clause: AgentRoutingRouteClause): RegExp {
  const token = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const role = `(?<![a-z0-9-])${token(clause.role)}(?![a-z0-9-])`;
  const profile = `${token(clause.capability)}\\s*(?:/|\\|)\\s*${token(clause.effort)}`;
  const separator = "(?:[\\s`|,]|and){1,50}";
  return new RegExp(
    `(?:${role}${separator}${profile}${separator}${token(clause.sourceAuthority)}|${token(clause.sourceAuthority)}${separator}${role}${separator}${profile})`,
    "gi",
  );
}

type SemanticRoleField = "role" | "capability" | "effort" | "source_authority";

type SemanticRoleRecord = Record<SemanticRoleField, string>;

const SEMANTIC_ROLE_FIELDS = [
  "role",
  "capability",
  "effort",
  "source_authority",
] as const;

function canonicalSemanticRoleField(
  label: string,
): SemanticRoleField | undefined {
  const normalized = label.toLowerCase().replaceAll(/[\s_-]+/g, "");
  switch (normalized) {
    case "role":
    case "semanticrole":
      return "role";
    case "capability":
    case "effort":
      return normalized;
    case "sourceauthority":
    case "sourcemutationdefault":
      return "source_authority";
    default:
      return undefined;
  }
}

function canonicalMarkdownSemanticRoleField(
  label: string,
  target: "claude" | "codex",
): SemanticRoleField | undefined {
  const canonicalField = canonicalSemanticRoleField(label);
  if (canonicalField) return canonicalField;
  const normalized = label.toLowerCase().replaceAll(/[\s_-]+/g, "");
  switch (normalized) {
    case "agent":
      return "role";
    case "sourcedefault":
      return "source_authority";
    case "claudeeffort":
      return target === "claude" ? "effort" : undefined;
    case "codexeffort":
      return target === "codex" ? "effort" : undefined;
    default:
      return undefined;
  }
}

function semanticRoleRecord(
  pairs: readonly (readonly [string, string])[],
  fieldForLabel: (
    label: string,
  ) => SemanticRoleField | undefined = canonicalSemanticRoleField,
): SemanticRoleRecord | undefined {
  const fields = new Map<SemanticRoleField, string>();
  for (const [label, value] of pairs) {
    const field = fieldForLabel(label);
    if (!field) continue;
    if (fields.has(field)) return undefined;
    fields.set(field, value.trim().replace(/^['"`]|['"`]$/g, ""));
  }
  if (!SEMANTIC_ROLE_FIELDS.every((field) => fields.has(field))) {
    return undefined;
  }
  return Object.fromEntries(fields) as SemanticRoleRecord;
}

function labeledSemanticRoleRecord(
  record: string,
  separator: ":" | "=",
): SemanticRoleRecord | undefined {
  const escapedSeparator = separator === "=" ? "=" : ":";
  const pairs = Array.from(
    record.matchAll(
      new RegExp(
        `(?:^|[\\s;,])([a-z_ -]+?)\\s*${escapedSeparator}\\s*([^\\s,;]+)`,
        "gi",
      ),
    ),
    (match) => [match[1], match[2]] as const,
  );
  return semanticRoleRecord(pairs);
}

function positionalCompactPipeSemanticRoleRecord(
  record: string,
): SemanticRoleRecord | undefined {
  if (!/^[^\s|]+ \| [^\s|]+ \| [^\s|]+ \| [^\s|]+$/u.test(record)) {
    return undefined;
  }
  return semanticRoleRecord(
    SEMANTIC_ROLE_FIELDS.map(
      (field, index) => [field, record.split(" | ")[index]] as const,
    ),
  );
}

function markdownPipeCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function copiedSemanticRoles(
  section: string,
  roles: readonly AgentSemanticRoleContract[],
  target: "claude" | "codex",
): AgentSemanticRoleContract[] {
  const records: SemanticRoleRecord[] = [];
  const lines = section.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const header = markdownPipeCells(lines[index]);
    if (header && /^\s*\|[\s|:-]+\|\s*$/.test(lines[index + 1] ?? "")) {
      for (
        index += 2;
        index < lines.length && markdownPipeCells(lines[index]);
        index += 1
      ) {
        const row = markdownPipeCells(lines[index]);
        if (!row || row.length !== header.length) continue;
        const record = semanticRoleRecord(
          header.map((label, column) => [label, row[column]] as const),
          (label) => canonicalMarkdownSemanticRoleField(label, target),
        );
        if (record) records.push(record);
      }
      index -= 1;
      continue;
    }

    const bullet = /^\s*-\s*(.*)$/.exec(lines[index]);
    if (bullet) {
      const item = [bullet[1]];
      while (
        index + 1 < lines.length &&
        /^\s+\S/.test(lines[index + 1]) &&
        !/^\s*-\s/.test(lines[index + 1])
      ) {
        item.push(lines[index + 1]);
        index += 1;
      }
      const yamlRecord = labeledSemanticRoleRecord(item.join("\n"), ":");
      const labeledRecord = labeledSemanticRoleRecord(item.join("\n"), "=");
      if (yamlRecord) records.push(yamlRecord);
      if (labeledRecord) records.push(labeledRecord);
    }
  }

  for (const object of section.matchAll(/\{[^{}]*\}/gs)) {
    const value = object[0];
    if (
      value
        .replace(/"([^"\\]|\\.)*"\s*:\s*"([^"\\]|\\.)*"/g, "")
        .replace(/[{}\s,]/g, "")
    ) {
      continue;
    }
    const jsonRecord = semanticRoleRecord(
      Array.from(
        value.matchAll(/"([^"\\]+)"\s*:\s*"([^"\\]*)"/g),
        (match) => [match[1], match[2]] as const,
      ),
    );
    if (jsonRecord) records.push(jsonRecord);
  }

  for (const line of lines) {
    const positionalCompactPipeRecord =
      positionalCompactPipeSemanticRoleRecord(line);
    if (positionalCompactPipeRecord) records.push(positionalCompactPipeRecord);
    const candidates = line.includes(" | ") ? line.split(" | ") : [line];
    for (const candidate of candidates) {
      const record = labeledSemanticRoleRecord(candidate, "=");
      if (record) records.push(record);
    }
  }

  return roles.filter((role) => {
    const effort = target === "claude" ? role.claudeEffort : role.codexEffort;
    return records.some(
      (record) =>
        record.role === role.name &&
        record.capability === role.capability &&
        record.effort === effort &&
        record.source_authority === role.sourceAuthority,
    );
  });
}

function renderedRouteEvidenceFailures(
  owner: RoutingOwner,
  renderedBySkill: ReadonlyMap<string, string>,
): string[] {
  const knownQualifiers = new Set(
    owner.directChildRoutes.flatMap((route) =>
      route.clauses.flatMap((clause) =>
        clause.qualifier ? [normalizedEvidence(clause.qualifier)] : [],
      ),
    ),
  );
  return owner.directChildRoutes
    .filter((route) => route.id !== "D4")
    .filter((route) => {
      const clauses = route.clauses;
      const units = markdownStructuralUnits(
        renderedBySkill.get(route.ownerSkill) ?? "",
      );
      const matches = (unit: string): boolean =>
        routeAnchorMatches(unit, route) &&
        clauses.every((clause) => clausePattern(clause).test(unit));
      const atomicEvidence = units.atomic.find(matches);
      const signaturePeers = owner.directChildRoutes.filter(
        (peer) =>
          peer.ownerSkill === route.ownerSkill &&
          peer.id !== "D4" &&
          JSON.stringify(peer.clauses) === JSON.stringify(clauses),
      );
      const peerHasSeparateEvidence = signaturePeers.some(
        (peer) =>
          peer !== route &&
          units.atomic.some(
            (unit) =>
              routeAnchorMatches(unit, peer) &&
              clauses.every((clause) => clausePattern(clause).test(unit)),
          ),
      );
      const evidence =
        atomicEvidence ??
        (peerHasSeparateEvidence ? undefined : units.sections.find(matches));
      if (!evidence) return true;

      const local = markdownStructuralUnits(evidence).atomic.find((unit) =>
        routeAnchorMatches(unit, route),
      );
      if (!local) return true;
      const localEvidence = normalizedEvidence(local);
      if (
        route.clauses.some((clause) =>
          clause.qualifier
            ? !localEvidence.includes(normalizedEvidence(clause.qualifier))
            : false,
        )
      )
        return true;
      const ownedQualifiers = new Set(
        route.clauses.flatMap((clause) =>
          clause.qualifier ? [normalizedEvidence(clause.qualifier)] : [],
        ),
      );
      if (
        [...knownQualifiers].some(
          (qualifier) =>
            !ownedQualifiers.has(qualifier) &&
            localEvidence.includes(qualifier),
        )
      )
        return true;

      const members = signaturePeers.filter((peer) =>
        routeAnchorMatches(evidence, peer),
      );
      const occurrences = clauses.map(
        (clause) => [...evidence.matchAll(clausePattern(clause))].length,
      );
      return (
        members.length === 0 ||
        occurrences.some((count) => count !== 1 && count !== members.length)
      );
    })
    .map((route) => route.id);
}

const D4_PRODUCER_FIELDS = [
  "route_id",
  "target_id",
  "selected_role_id",
  "scope",
  "termination",
  "context_ref",
  "approval_ref",
  "capability",
  "effort",
  "model",
  "source_authority",
  "external_authority",
  "claude_tools",
  "codex_sandbox",
  "default_network",
] as const;

const D4_CONTROLLER_BOUND_OWNER_FIELDS = [
  "route_id",
  "target_id",
  "selected_role_id",
  "scope",
  "termination",
  "context_ref",
  "approval_ref",
] as const;

const D4_OWNER_DERIVED_FIELDS = [
  "capability",
  "effort",
  "source_authority",
  "external_authority",
  "claude_tools",
  "codex_sandbox",
  "default_network",
  "model",
] as const;

function commonMarkAtxHeading(
  line: string,
): { level: number; title: string } | undefined {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(line);
  if (!match) return undefined;
  const title = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trimEnd();
  return { level: match[1].length, title };
}

function commonMarkFenceOpener(line: string): string | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return undefined;
  const [marker, info] = [match[1], match[2]];
  return marker[0] === "`" && info.includes("`") ? undefined : marker;
}

function commonMarkColumnAfter(text: string, startingColumn = 0): number {
  let column = startingColumn;
  for (const character of text) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

function commonMarkBlockquoteContent(
  line: string,
): { content: string; startingColumn: number } | undefined {
  const match = /^( {0,3})>(.*)$/u.exec(line);
  if (!match) return undefined;
  const markerEndColumn = commonMarkColumnAfter(`${match[1]}>`);
  const remainder = match[2];
  if (remainder.startsWith(" ")) {
    return {
      content: remainder.slice(1),
      startingColumn: markerEndColumn + 1,
    };
  }
  if (remainder.startsWith("\t")) {
    const tabWidth = 4 - (markerEndColumn % 4);
    return {
      content: `${" ".repeat(tabWidth - 1)}${remainder.slice(1)}`,
      startingColumn: markerEndColumn + 1,
    };
  }
  return { content: remainder, startingColumn: markerEndColumn };
}

function isCommonMarkThematicBreak(line: string, startingColumn = 0): boolean {
  let column = startingColumn;
  let indentColumns = 0;
  let markerStart = 0;
  for (; markerStart < line.length; markerStart += 1) {
    const character = line[markerStart];
    if (character !== " " && character !== "\t") break;
    const advance = character === "\t" ? 4 - (column % 4) : 1;
    column += advance;
    indentColumns += advance;
    if (indentColumns >= 4) return false;
  }
  const compact = line.slice(markerStart).replace(/[ \t]/gu, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/u.test(compact);
}

function commonMarkHeadingsOutsideFences(
  lines: readonly string[],
): Array<{ index: number; level: number; title: string }> {
  const headings: Array<{ index: number; level: number; title: string }> = [];
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let htmlComment = false;
  for (const [index, line] of lines.entries()) {
    if (fence !== undefined) {
      const closer = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line)?.[1];
      if (
        closer !== undefined &&
        closer[0] === fence.marker &&
        closer.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }
    if (htmlComment) {
      if (line.includes("-->")) htmlComment = false;
      continue;
    }
    if (/^ {0,3}<!--/u.test(line)) {
      htmlComment = !line.includes("-->");
      continue;
    }
    const opener = commonMarkFenceOpener(line);
    if (opener !== undefined) {
      fence = {
        marker: opener[0] as "`" | "~",
        length: opener.length,
      };
      continue;
    }
    const heading = commonMarkAtxHeading(line);
    if (heading !== undefined) headings.push({ index, ...heading });
  }
  return headings;
}

function markdownHeadingSection(
  markdown: string,
  heading: string,
): string | undefined {
  const lines = markdown.split("\n");
  const expected = commonMarkAtxHeading(heading);
  if (!expected) return undefined;
  const headings = commonMarkHeadingsOutsideFences(lines);
  const matchingHeadings = headings.filter(
    (candidate) =>
      candidate.level === expected.level && candidate.title === expected.title,
  );
  if (matchingHeadings.length !== 1) return undefined;
  const start = matchingHeadings[0].index;
  const end =
    headings.find(
      (candidate) =>
        candidate.index > start && candidate.level <= expected.level,
    )?.index ?? lines.length;
  return lines.slice(start, end).join("\n");
}

function d4OwnerDeclarationFieldValidation(
  routingPolicySource: string,
  boundedOwnerSection = markdownHeadingSection(
    routingPolicySource,
    "### D4 Declaration Obligation",
  ),
): { controllerBoundValid: boolean; ownerDerivedValid: boolean } | undefined {
  const section = boundedOwnerSection;
  if (!section) return undefined;
  const controllerBoundSource =
    /Its controller-bound fields are exactly\s+([\s\S]*?);\s*`termination` includes/u.exec(
      section,
    )?.[1];
  const ownerDerivedMatch =
    /For the exact selected role and target, it derives\s+([\s\S]*?)\.\s*\[`devcanon\.config\.yaml`\][\s\S]*?`([^`]+)`\./u.exec(
      section,
    );
  const backtickedFields = (source: string): string[] =>
    Array.from(source.matchAll(/`([^`]+)`/g), (match) => match[1]);
  const controllerTokens = backtickedFields(controllerBoundSource ?? "");
  const controllerBound = controllerTokens.filter((field) => field !== "D4");
  const ownerDerived = [
    ...backtickedFields(ownerDerivedMatch?.[1] ?? ""),
    ...(ownerDerivedMatch?.[2] ? [ownerDerivedMatch[2]] : []),
  ];
  const duplicateFree = (fields: string[]): boolean =>
    new Set(fields).size === fields.length;
  const disjoint = controllerBound.every(
    (field) => !ownerDerived.includes(field),
  );
  const targetNativeEffortValid =
    /(?:^|,\s*)target-native\s+`effort`(?:,|$)/u.test(
      ownerDerivedMatch?.[1] ?? "",
    );
  return {
    controllerBoundValid:
      JSON.stringify(controllerTokens) ===
        JSON.stringify([
          "route_id",
          "D4",
          ...D4_CONTROLLER_BOUND_OWNER_FIELDS.slice(1),
        ]) && disjoint,
    ownerDerivedValid:
      duplicateFree(ownerDerived) &&
      JSON.stringify(ownerDerived) ===
        JSON.stringify(D4_OWNER_DERIVED_FIELDS) &&
      targetNativeEffortValid &&
      disjoint,
  };
}

function d4ProducerOwnerDerivedFieldsValid(section: string): boolean {
  const matches = [
    ...section.matchAll(
      /For that exact selected role and\s+target, declare its\s+([\s\S]*?)\.\s*Resolve `model` only from the exact target\/capability resolution in\s+`devcanon\.config\.yaml`\./gu,
    ),
  ];
  if (matches.length !== 1) return false;

  const list = normalizeWhitespace(matches[0]?.[1] ?? "");
  const fields = Array.from(list.matchAll(/`([^`]+)`/gu), (match) => match[1]);
  return (
    list ===
      "`capability`, target-native `effort`, `source_authority`, `external_authority`, ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`" &&
    new Set(fields).size === fields.length &&
    JSON.stringify([...fields, "model"]) ===
      JSON.stringify(D4_OWNER_DERIVED_FIELDS)
  );
}

function d4AuthoritativeOwnerClaims(ownerSection: string): string[] {
  const lines = ownerSection.split("\n");
  const referenceLabels = new Set<string>();
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let quotedFence: { marker: "`" | "~"; length: number } | undefined;
  let htmlComment = false;
  let lazyBlockquote = false;
  let listContentIndent: number | undefined;
  const flush = (): void => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };
  const resetBlock = (): void => {
    flush();
    listContentIndent = undefined;
  };
  const validReferenceDestination = (destination: string): boolean => {
    const hasControlCharacter = [...destination].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
    if (hasControlCharacter) return false;
    if (destination.startsWith("<") || destination.endsWith(">")) {
      return /^<[^<>\s]+>$/u.test(destination);
    }
    if (destination === "" || /[\s<>]/u.test(destination)) {
      return false;
    }
    let parenthesisDepth = 0;
    for (const character of destination) {
      if (character === "(") parenthesisDepth += 1;
      if (character === ")") {
        if (parenthesisDepth === 0) return false;
        parenthesisDepth -= 1;
      }
    }
    return parenthesisDepth === 0;
  };
  const removeValidInlineLinks = (block: string): string => {
    const spans: Array<{ start: number; end: number }> = [];
    const opener = /!?\[[^\]\n]*\]\(/gu;
    for (
      let match = opener.exec(block);
      match !== null;
      match = opener.exec(block)
    ) {
      const destinationStart = opener.lastIndex;
      let destinationEnd = -1;
      let outerClose = -1;
      if (block[destinationStart] === "<") {
        const angleClose = block.indexOf(">", destinationStart + 1);
        if (angleClose !== -1 && block[angleClose + 1] === ")") {
          destinationEnd = angleClose + 1;
          outerClose = angleClose + 1;
        }
      } else {
        let depth = 0;
        for (let index = destinationStart; index < block.length; index += 1) {
          if (block[index] === "(") depth += 1;
          if (block[index] === ")") {
            if (depth === 0) {
              destinationEnd = index;
              outerClose = index;
              break;
            }
            depth -= 1;
          }
        }
      }
      const destination = block.slice(destinationStart, destinationEnd);
      if (outerClose !== -1 && validReferenceDestination(destination)) {
        spans.push({ start: match.index, end: outerClose + 1 });
        opener.lastIndex = outerClose + 1;
      } else {
        opener.lastIndex = match.index + 1;
      }
    }
    let cursor = 0;
    let result = "";
    for (const span of spans) {
      result += block.slice(cursor, span.start);
      cursor = span.end;
    }
    return result + block.slice(cursor);
  };
  const isQuotedParagraphContent = (
    content: string,
    startingColumn: number,
  ): boolean => {
    if (
      content.trim() === "" ||
      commonMarkAtxHeading(content) !== undefined ||
      commonMarkFenceOpener(content) !== undefined ||
      isCommonMarkThematicBreak(content, startingColumn) ||
      /^ {0,3}>/u.test(content) ||
      /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/u.test(content)
    ) {
      return false;
    }
    let column = startingColumn;
    let indentation = 0;
    for (const character of content) {
      if (character !== " " && character !== "\t") break;
      const advance = character === "\t" ? 4 - (column % 4) : 1;
      column += advance;
      indentation += advance;
      if (indentation >= 4) return false;
    }
    const referenceDefinition = /^ {0,3}\[([^\]]*)\]:[ \t]*(.*)$/u.exec(
      content,
    );
    return !(
      referenceDefinition !== null &&
      normalizeWhitespace(referenceDefinition[1]).toLowerCase() !== "" &&
      validReferenceDestination(referenceDefinition[2].trim())
    );
  };

  for (const line of lines) {
    if (fence !== undefined) {
      const closer = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line)?.[1];
      if (
        closer !== undefined &&
        closer[0] === fence.marker &&
        closer.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const blockquote = commonMarkBlockquoteContent(line);
    if (quotedFence !== undefined) {
      if (blockquote !== undefined) {
        const closer = /^ {0,3}(`+|~+)[ \t]*$/u.exec(blockquote.content)?.[1];
        if (
          closer !== undefined &&
          closer[0] === quotedFence.marker &&
          closer.length >= quotedFence.length
        ) {
          quotedFence = undefined;
        }
        resetBlock();
        lazyBlockquote = false;
        continue;
      }
      quotedFence = undefined;
    }

    if (htmlComment) {
      if (line.includes("-->")) htmlComment = false;
      continue;
    }
    if (/^ {0,3}<!--/u.test(line)) {
      resetBlock();
      lazyBlockquote = false;
      htmlComment = !line.includes("-->");
      continue;
    }

    const opener = commonMarkFenceOpener(line);
    if (opener !== undefined) {
      resetBlock();
      lazyBlockquote = false;
      fence = {
        marker: opener[0] as "`" | "~",
        length: opener.length,
      };
      continue;
    }
    if (line.trim() === "") {
      resetBlock();
      lazyBlockquote = false;
      continue;
    }
    if (commonMarkAtxHeading(line) !== undefined) {
      resetBlock();
      lazyBlockquote = false;
      continue;
    }
    if (blockquote !== undefined) {
      resetBlock();
      const quotedOpener = commonMarkFenceOpener(blockquote.content);
      if (quotedOpener !== undefined) {
        quotedFence = {
          marker: quotedOpener[0] as "`" | "~",
          length: quotedOpener.length,
        };
        lazyBlockquote = false;
        continue;
      }
      lazyBlockquote = isQuotedParagraphContent(
        blockquote.content,
        blockquote.startingColumn,
      );
      continue;
    }
    const listItem = /^( *)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/u.exec(line);
    if (lazyBlockquote) {
      if (isCommonMarkThematicBreak(line)) {
        resetBlock();
        lazyBlockquote = false;
        continue;
      }
      const marker = listItem?.[2];
      const orderedMarker = marker?.match(/^(\d{1,9})[.)]$/u);
      const interruptsParagraph =
        marker !== undefined &&
        (/^[-+*]$/u.test(marker) ||
          (orderedMarker !== null &&
            orderedMarker !== undefined &&
            Number.parseInt(orderedMarker[1], 10) === 1));
      if (listItem === null || listItem[1].length > 3 || !interruptsParagraph) {
        continue;
      }
      lazyBlockquote = false;
    }
    const referenceDefinition = /^ {0,3}\[([^\]]*)\]:[ \t]*(.*)$/u.exec(line);
    const normalizedReferenceLabel = normalizeWhitespace(
      referenceDefinition?.[1] ?? "",
    ).toLowerCase();
    const referenceDestination = referenceDefinition?.[2].trim() ?? "";
    if (
      referenceDefinition !== null &&
      normalizedReferenceLabel !== "" &&
      validReferenceDestination(referenceDestination)
    ) {
      resetBlock();
      referenceLabels.add(normalizedReferenceLabel);
      continue;
    }

    if (listItem !== null) {
      const indent = listItem[1].length;
      if (
        indent <= 3 ||
        (listContentIndent !== undefined && indent >= listContentIndent)
      ) {
        flush();
        current = [listItem[4].trim()];
        listContentIndent = indent + listItem[2].length + listItem[3].length;
        continue;
      }
    }

    if (listContentIndent !== undefined) {
      const leadingSpaces = /^ */u.exec(line)?.[0].length ?? 0;
      if (line.startsWith("\t")) {
        current.push(line.trim());
        continue;
      }
      if (!line.startsWith("\t") && leadingSpaces >= listContentIndent) {
        current.push(line.trim());
        continue;
      }
    }
    if (line.startsWith("\t") || /^ {4}/u.test(line)) {
      if (current.length > 0 && listContentIndent === undefined) {
        current.push(line.trim());
        continue;
      }
      resetBlock();
      continue;
    }
    current.push(line.trim());
  }
  flush();

  const removeResolvedReferences = (block: string): string => {
    let result = removeValidInlineLinks(block.replace(/`+[^`]*`+/gu, ""));
    result = result.replace(
      /\[([^\]]+)\]\[([^\]]*)\]/gu,
      (source, text: string, label: string) =>
        referenceLabels.has(
          normalizeWhitespace(label === "" ? text : label).toLowerCase(),
        )
          ? ""
          : source,
    );
    return result.replace(/\[([^\]]+)\](?![\[(])/gu, (source, text: string) =>
      referenceLabels.has(normalizeWhitespace(text).toLowerCase())
        ? ""
        : source,
    );
  };

  return blocks.flatMap((block) => {
    if (/^(?:Example|For example|Reference):/iu.test(block)) return [];
    const authoritativeText = removeResolvedReferences(block);
    return Array.from(
      authoritativeText.matchAll(
        /(?:^|[.!?]\s+)([^.!?]*?\bis\s+[^.!?:;]*?\bD4\s+route\s+owner)(?=\s*[:.;]|$)/gu,
      ),
      (match) => normalizeWhitespace(match[1]),
    );
  });
}

function d4OwnerDeclarationFailures(routingPolicySource: string): string[] {
  const section = markdownHeadingSection(
    routingPolicySource,
    "### D4 Declaration Obligation",
  );
  if (!section) return ["D4:owner:declaration-section"];
  if (
    !section.split("\n").some((line) => {
      const heading = commonMarkAtxHeading(line);
      return line.trim() !== "" && heading === undefined;
    })
  ) {
    return ["D4:owner:declaration-section"];
  }

  const normalized = normalizeWhitespace(section);
  const failures: string[] = [];
  const ownerClaims = d4AuthoritativeOwnerClaims(section);
  if (
    ownerClaims.length !== 1 ||
    ownerClaims[0] !== "This policy is the sole D4 route owner"
  ) {
    failures.push("D4:owner:sole-route-owner");
  }
  if (
    !normalized.includes(
      "The producer consumes this obligation; it does not define a peer route or role registry",
    )
  ) {
    failures.push("D4:owner:producer-consumer-boundary");
  }
  const ownerFieldValidation = d4OwnerDeclarationFieldValidation(
    routingPolicySource,
    section,
  );
  if (!ownerFieldValidation?.controllerBoundValid) {
    failures.push("D4:owner:controller-field-set");
  }
  if (!ownerFieldValidation?.ownerDerivedValid) {
    failures.push("D4:owner:owner-field-set");
  }
  for (const [partition, evidence] of [
    [
      "agent-spec",
      "[agent spec](../specs/agents.md) is the sole semantic-role catalog and role-envelope owner",
    ],
    [
      "config",
      "[`devcanon.config.yaml`](../../devcanon.config.yaml) solely resolves the exact-target/capability `model`",
    ],
    [
      "yaml-conformance",
      "`agents/*.yaml` are governed declarations/instances and parity inputs, never peer semantic authorities",
    ],
    [
      "planner-classification",
      "Cognitive demand and stance remain planner classification inputs only, not declaration fields or authority",
    ],
  ] as const) {
    if (!normalized.includes(evidence)) {
      failures.push(`D4:owner:${partition}`);
    }
  }
  if (/YAML is a peer semantic authority/u.test(section)) {
    failures.push("D4:owner:yaml-contradiction");
  }
  if (
    normalized.includes(
      "Cognitive demand and stance remain planner classification inputs only, not declaration fields or authority",
    ) &&
    /Cognitive demand and stance are declaration authority/u.test(section)
  ) {
    failures.push("D4:owner:planner-contradiction");
  }
  return failures;
}

function d4ProducerProjectionFailures(
  owner: RoutingOwner,
  roles: readonly AgentSemanticRoleContract[],
  renderedProducer: string,
  target: "claude" | "codex",
  routingPolicySource?: string,
): string[] {
  const failures: string[] = [];
  const d4Routes = owner.directChildRoutes.filter(
    (candidate) => candidate.id === "D4",
  );
  const route = d4Routes[0];
  if (
    d4Routes.length !== 1 ||
    route?.ownerSkill !== "play-agent-dispatch" ||
    route.d4Contract?.roleCardinality !== roles.length
  ) {
    failures.push("D4:producer-route-owner");
  }
  if (routingPolicySource !== undefined) {
    failures.push(...d4OwnerDeclarationFailures(routingPolicySource));
  }

  const section = markdownHeadingSection(
    renderedProducer,
    "### Semantic Route Contract",
  );
  if (!section) return [...failures, "D4:producer-section"];
  if (
    !section.split("\n").some((line) => {
      const heading = commonMarkAtxHeading(line);
      return line.trim() !== "" && heading === undefined;
    })
  ) {
    return [...failures, "D4:producer-section"];
  }
  const normalized = normalizeWhitespace(section);

  const missingFields = D4_PRODUCER_FIELDS.filter(
    (field) => !section.includes(`\`${field}\``),
  );
  for (const field of missingFields) {
    if (!section.includes(`\`${field}\``)) {
      failures.push(`D4:required-field:${field}`);
    }
  }
  if (
    missingFields.length === 0 &&
    !/`route_id`:\s*`D4`;\s*`target_id`;\s*planner-selected\s*`selected_role_id`;\s*`scope`;\s*`termination`;\s*`context_ref`;\s*and\s*`approval_ref` are controller-bound;/u.test(
      section,
    )
  ) {
    failures.push("D4:controller-field-set");
  }
  if (
    missingFields.length === 0 &&
    !d4ProducerOwnerDerivedFieldsValid(section)
  ) {
    failures.push("D4:owner-derived-field-set");
  }
  for (const [partition, evidence] of [
    ["routing-policy", "Agent Routing and Mutation Policy"],
    ["agent-spec", "`docs/specs/agents.md`"],
    ["config", "`devcanon.config.yaml`"],
    [
      "yaml-conformance",
      "governed declarations and parity inputs, never semantic authorities",
    ],
    [
      "planner-classification",
      "Cognitive demand and stance remain planner classification inputs only",
    ],
    ["fail-closed", "No field is optional"],
  ] as const) {
    if (!normalized.includes(evidence)) {
      failures.push(`D4:partition:${partition}`);
    }
  }
  if (!normalized.includes("`route_id`: `D4`")) {
    failures.push("D4:route-binding");
  }
  if (
    !normalized.includes(
      "The controller selects one of the policy-owned six-role set before spawn; a generic or inherited workflow does not supply a child route",
    )
  ) {
    failures.push("D4:producer-consumer-boundary");
  }
  if (/YAML is a peer semantic authority/u.test(section)) {
    failures.push("D4:partition:yaml-contradiction");
  }

  const copiedRoles = copiedSemanticRoles(section, roles, target);
  if (copiedRoles.length === roles.length) {
    failures.push("D4:copied-role-registry");
  }

  return failures;
}

function sourceAuthorityFromInstructions(
  instructions: string,
): AgentSemanticRoleContract["sourceAuthority"] | "unknown" {
  const normalized = normalizeWhitespace(instructions);
  if (normalized.includes("Do not make durable file edits.")) {
    return "source-immutable";
  }
  if (
    /(?:Edit|Modify) durable content only (?:at|within) the (?:exact )?dispatch-authorized/i.test(
      normalized,
    )
  ) {
    return "source-mutable";
  }
  return "unknown";
}

function externalAuthorityFromInstructions(
  instructions: string,
): AgentSemanticRoleContract["externalAuthority"] | "unknown" {
  return normalizeWhitespace(instructions).includes(
    "Do not mutate GitHub, Linear, Notion, or any other external system.",
  )
    ? "none"
    : "unknown";
}

function defaultNetworkFromInstructions(
  instructions: string,
): AgentSemanticRoleContract["defaultNetwork"] | "unknown" {
  const normalized = normalizeWhitespace(instructions);
  if (normalized.includes("Do not use network access.")) return "None";
  if (
    normalized.includes(
      "Use network access only when the dispatch explicitly names external research",
    )
  ) {
    return "Dispatch-owned";
  }
  if (
    normalized.includes(
      "Use network access only when the task explicitly authorizes and owns it.",
    )
  ) {
    return "Task-owned";
  }
  return "unknown";
}

function renderedInstructionProjectionFailures(
  role: AgentSemanticRoleContract,
  target: "claude" | "codex",
  instructions: string,
): string[] {
  const normalizedInstructions = normalizeWhitespace(instructions);
  const count = (marker: string): number =>
    normalizedInstructions
      .toLowerCase()
      .split(normalizeWhitespace(marker).toLowerCase()).length - 1;
  const sourceAuthorityMarkers = [
    ["source-immutable", "Do not make durable file edits."],
    [
      "source-mutable",
      "Edit durable content only at the exact dispatch-authorized paths and stay within every stated guardrail.",
    ],
    [
      "source-mutable",
      "Modify durable content only within the dispatch-authorized task scope",
    ],
  ] as const;
  const defaultNetworkMarkers = [
    ["None", "Do not use network access."],
    [
      "Dispatch-owned",
      "Use network access only when the dispatch explicitly names external research; otherwise do not access the network.",
    ],
    [
      "Task-owned",
      "Use network access only when the task explicitly authorizes and owns it.",
    ],
  ] as const;
  const failures: string[] = [];
  const sourceMatches = sourceAuthorityMarkers.flatMap(([value, marker]) =>
    Array.from({ length: count(marker) }, () => value),
  );
  if (sourceMatches.length !== 1 || sourceMatches[0] !== role.sourceAuthority) {
    failures.push(
      `D4:${role.name}:${target}:render-projection:source_authority`,
    );
  }
  const networkMatches = defaultNetworkMarkers.flatMap(([value, marker]) =>
    Array.from({ length: count(marker) }, () => value),
  );
  if (
    networkMatches.length !== 1 ||
    networkMatches[0] !== role.defaultNetwork
  ) {
    failures.push(
      `D4:${role.name}:${target}:render-projection:default_network`,
    );
  }
  return failures;
}

function agentSourceConformanceFailures(
  role: AgentSemanticRoleContract,
  source: AgentSourceContract,
): string[] {
  const failures: string[] = [];
  const compare = (field: string, actual: unknown, expected: unknown): void => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`${role.name}:${field}`);
    }
  };
  compare("name", source.name, role.name);
  compare("capability", source.capability, role.capability);
  compare("claude-effort", source.claude.effort, role.claudeEffort);
  compare(
    "codex-effort",
    source.codex.model_reasoning_effort,
    role.codexEffort,
  );
  compare("claude-tools", source.claude.tools, role.claudeTools);
  compare("codex-sandbox", source.codex.sandbox_mode, role.codexSandbox);
  compare(
    "source-authority",
    sourceAuthorityFromInstructions(source.instructions),
    role.sourceAuthority,
  );
  compare(
    "external-authority",
    externalAuthorityFromInstructions(source.instructions),
    role.externalAuthority,
  );
  compare(
    "default-network",
    defaultNetworkFromInstructions(source.instructions),
    role.defaultNetwork,
  );
  return failures;
}

function renderedAgentAlignmentFailures(
  role: AgentSemanticRoleContract,
  source: AgentSourceContract,
  target: "claude" | "codex",
  parsed: ParsedRenderedAgent,
  expectedModel: string,
): string[] {
  const failures = [...agentSourceConformanceFailures(role, source)];
  const expectedEffort =
    target === "claude" ? role.claudeEffort : role.codexEffort;
  if (parsed.name !== role.name) {
    failures.push(
      `D4:${role.name}:${target}:rendered-name:${String(parsed.name)}`,
    );
  }
  if (parsed.description !== source.description) {
    failures.push(
      `D4:${role.name}:${target}:rendered-description:${String(parsed.description)}`,
    );
  }
  if (parsed.model !== expectedModel) {
    failures.push(
      `D4:${role.name}:${target}:config-model-resolution:${String(parsed.model)}`,
    );
  }
  if (parsed.effort !== expectedEffort) {
    failures.push(
      `D4:${role.name}:${target}:target-effort:${String(parsed.effort)}`,
    );
  }
  const normalizedInstructions = normalizeWhitespace(parsed.instructions);
  if (
    !normalizedInstructions.includes(normalizeWhitespace(source.instructions))
  ) {
    failures.push(`D4:${role.name}:${target}:rendered-source-instructions`);
  }
  if (
    role.externalAuthority !== "none" ||
    !normalizedInstructions.includes(
      "Do not mutate GitHub, Linear, Notion, or any other external system.",
    )
  ) {
    failures.push(`D4:${role.name}:${target}:rendered-external-authority`);
  }
  if (
    role.sourceAuthority === "source-immutable" &&
    !normalizedInstructions.includes(
      "Do not modify durable source, tests, configuration, or documentation.",
    )
  ) {
    failures.push(`D4:${role.name}:${target}:rendered-source-authority`);
  }
  failures.push(
    ...renderedInstructionProjectionFailures(role, target, parsed.instructions),
  );
  return failures;
}

describe("existing skills render cleanly", () => {
  it("dogfoods tool and file glossary placeholders in selected skills", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    expect(config.toolNames?.["github-cli"]).toEqual({
      claude: "gh",
      codex: "gh",
    });
    expect(config.fileArtifacts?.["workflow-guide"]).toEqual({
      claude: "WORKFLOW.md",
      codex: "WORKFLOW.md",
    });

    const skillDirs = (await readdir(path.join(repoRoot, "skills")))
      .filter((entry) => !entry.startsWith("."))
      .sort();
    const skillSources = new Map<string, string>(
      await Promise.all(
        skillDirs.map(
          async (skillName): Promise<[string, string]> => [
            skillName,
            await readFile(
              path.join(repoRoot, "skills", skillName, "SKILL.md"),
              "utf-8",
            ),
          ],
        ),
      ),
    );

    expect(
      skillDirs.filter((skillName) =>
        skillSources.get(skillName)?.includes(GITHUB_CLI_PLACEHOLDER),
      ),
    ).toEqual([...SKILLS_WITH_GITHUB_CLI_PLACEHOLDER]);
    expect(
      skillDirs.filter((skillName) =>
        skillSources.get(skillName)?.includes(WORKFLOW_GUIDE_PLACEHOLDER),
      ),
    ).toEqual([...SKILLS_WITH_WORKFLOW_GUIDE_PLACEHOLDER]);

    for (const skillName of SKILLS_WITH_GITHUB_CLI_PLACEHOLDER) {
      const source = skillSources.get(skillName);
      expect(source).toContain(GITHUB_CLI_PLACEHOLDER);
    }

    for (const skillName of SKILLS_WITH_WORKFLOW_GUIDE_PLACEHOLDER) {
      const source = skillSources.get(skillName);
      expect(source).toContain(WORKFLOW_GUIDE_PLACEHOLDER);
    }

    const { outputs } = await renderAll(config, false);

    for (const target of ["claude", "codex"] as const) {
      for (const skillName of SKILLS_WITH_GITHUB_CLI_PLACEHOLDER) {
        const source = skillSources.get(skillName);
        expect(source).toBeDefined();
        const output = getSkillOutput(outputs, skillName, target);
        expectPlaceholderLinesRendered(
          source ?? "",
          output.content,
          GITHUB_CLI_PLACEHOLDER,
        );
        expect(output.content).not.toContain(GITHUB_CLI_PLACEHOLDER);
      }

      for (const skillName of SKILLS_WITH_WORKFLOW_GUIDE_PLACEHOLDER) {
        const source = skillSources.get(skillName);
        expect(source).toBeDefined();
        const output = getSkillOutput(outputs, skillName, target);
        expectPlaceholderLinesRendered(
          source ?? "",
          output.content,
          WORKFLOW_GUIDE_PLACEHOLDER,
        );
        expect(output.content).not.toContain(WORKFLOW_GUIDE_PLACEHOLDER);
      }
    }
  });

  it("renders every shipped skill to both targets without error", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const result = await renderAll(config, false);

    const skillEntries = await readdir(path.join(repoRoot, "skills"));
    const skillDirs = skillEntries.filter((e) => !e.startsWith("."));

    const skillOutputs = result.outputs.filter((o) => o.type === "skill");
    expect(skillOutputs).toHaveLength(skillDirs.length * 2);

    for (const output of skillOutputs) {
      expect(output.content.startsWith("---\n")).toBe(true);
      expect(output.content).toContain(`name: ${output.name}`);
    }
  });

  it("renders current routing contracts and semantic authority with target parity", async () => {
    const repoRoot = process.cwd();
    const [config, owner, roles, sources, routingPolicySource] =
      await Promise.all([
        loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
        readAgentRoutingPolicyOwner(
          "docs/guidelines/agent-routing-and-mutation-policy.md",
        ),
        readAgentSemanticRoleOwner(),
        readAgentSources(),
        readFile(
          path.join(
            repoRoot,
            "docs/guidelines/agent-routing-and-mutation-policy.md",
          ),
          "utf-8",
        ),
      ]);
    const { outputs } = await renderAll(config, false, true);
    const sourcesByName = new Map(
      sources.map((source) => [source.name, source]),
    );
    expect(roles).toHaveLength(6);

    for (const target of ["claude", "codex"] as const) {
      const renderedBySkill = new Map(
        outputs
          .filter(
            (output) => output.type === "skill" && output.target === target,
          )
          .map((output) => [output.name, output.content]),
      );
      expect(renderedRouteEvidenceFailures(owner, renderedBySkill)).toEqual([]);
      expect(
        d4ProducerProjectionFailures(
          owner,
          roles,
          renderedBySkill.get("play-agent-dispatch") ?? "",
          target,
          routingPolicySource,
        ),
      ).toEqual([]);
      const prMerge = normalizeWhitespace(
        renderedBySkill.get("pr-merge") ?? "",
      );
      for (const contract of [
        "skills/pr-merge/scripts/preflight-worktree-context.sh",
        "skills/pr-merge/scripts/post-merge-cleanup.sh",
        "No mode may use `gh pr merge --delete-branch`",
        "WORKTREE_CLEANUP=removed|retained|skipped|failed",
        "REMOTE_BRANCH_CLEANUP=deleted|retained|skipped|failed",
        "mutable child may edit only the authorized paths, run verification, and commit",
        "The controller/root alone owns push and merge",
      ])
        expect(prMerge).toContain(contract);
      expect(prMerge).toMatch(
        /Before any merge command.*preflight-worktree-context\.sh/i,
      );

      const renderedPlanning = normalizeWhitespace(
        renderedBySkill.get("play-planning") ?? "",
      );
      const renderedBrainstorm = normalizeWhitespace(
        renderedBySkill.get("play-brainstorm") ?? "",
      );
      const renderedExecution = normalizeWhitespace(
        renderedBySkill.get("play-subagent-execution") ?? "",
      );
      expect(renderedPlanning).toContain(
        "Classify the task using the bundled canonical criteria before choosing its contract detail",
      );
      expect(renderedPlanning).toContain(
        "Before any plan mutation, validate each proposed blocking gap against the canonical materiality contract",
      );
      expect(renderedBrainstorm).toContain(
        "planning handoff, not a `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` classification",
      );
      expect(renderedExecution).toContain(
        "The executor must not promote, demote, infer, or otherwise reclassify the tier",
      );
      expect(renderedExecution).toContain(
        "Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can identify the upstream two-gate `play-planning` return",
      );

      const agentOutputs = outputs
        .filter((output) => output.type === "agent" && output.target === target)
        .sort((left, right) => left.name.localeCompare(right.name));
      expect(agentOutputs).toHaveLength(6);
      expect(agentOutputs.map((output) => output.name)).toEqual(
        roles.map((role) => role.name).sort(),
      );

      for (const role of roles) {
        const source = sourcesByName.get(role.name);
        const output = agentOutputs.find(
          (candidate) => candidate.name === role.name,
        );
        expect(source, `missing source agent ${role.name}`).toBeDefined();
        expect(output, `missing ${target} agent ${role.name}`).toBeDefined();
        if (!source || !output) continue;
        expect(agentSourceConformanceFailures(role, source)).toEqual([]);

        let parsed: ParsedRenderedAgent;
        if (target === "claude") {
          const { frontmatter, body } = parseRenderedMarkdownArtifact(
            output.content,
          );
          expect(frontmatter.tools).toBe(role.claudeTools.join(", "));
          parsed = {
            name: frontmatter.name,
            description: frontmatter.description,
            model: frontmatter.model,
            effort: frontmatter.effort,
            instructions: body,
          };
        } else {
          const toml = parseRenderedTomlArtifact(output.content);
          expect(toml.sandbox_mode).toBe(role.codexSandbox);
          parsed = {
            name: toml.name,
            description: toml.description,
            model: toml.model,
            effort: toml.model_reasoning_effort,
            instructions: String(toml.developer_instructions ?? ""),
          };
        }

        const expectedModel =
          config.capabilityProfiles[role.capability][target];
        expect(
          renderedAgentAlignmentFailures(
            role,
            source,
            target,
            parsed,
            expectedModel,
          ),
        ).toEqual([]);
        const alternateNetworkRole = roles.find(
          (candidate) => candidate.defaultNetwork !== role.defaultNetwork,
        );
        expect(alternateNetworkRole).toBeDefined();
        if (alternateNetworkRole) {
          const defaultNetworkDrift: AgentSemanticRoleContract = {
            ...role,
            defaultNetwork: alternateNetworkRole.defaultNetwork,
          };
          expect(
            agentSourceConformanceFailures(defaultNetworkDrift, source),
          ).toEqual([`${role.name}:default-network`]);
          expect(
            renderedAgentAlignmentFailures(
              defaultNetworkDrift,
              source,
              target,
              parsed,
              expectedModel,
            ),
          ).toEqual([
            `${role.name}:default-network`,
            `D4:${role.name}:${target}:render-projection:default_network`,
          ]);
        }
        if (target === "codex" && role === roles[0]) {
          const effortDrift = { ...parsed, effort: "mutated-effort" };
          expect({ ...effortDrift, effort: parsed.effort }).toEqual(parsed);
          expect(
            renderedAgentAlignmentFailures(
              role,
              source,
              target,
              effortDrift,
              expectedModel,
            ),
          ).toEqual([
            `D4:${role.name}:${target}:target-effort:${effortDrift.effort}`,
          ]);
        }
      }
    }
  });

  it("rejects D4 producer and owner-convergence drift without copied role tuples", async () => {
    const repoRoot = process.cwd();
    const [config, owner, roles, sources, routingPolicySource] =
      await Promise.all([
        loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
        readAgentRoutingPolicyOwner(
          "docs/guidelines/agent-routing-and-mutation-policy.md",
        ),
        readAgentSemanticRoleOwner(),
        readAgentSources(),
        readFile(
          path.join(
            repoRoot,
            "docs/guidelines/agent-routing-and-mutation-policy.md",
          ),
          "utf-8",
        ),
      ]);
    const { outputs } = await renderAll(config, false, true);
    const sourcesByName = new Map(
      sources.map((source) => [source.name, source]),
    );
    const role = roles[0];
    const source = sourcesByName.get(role.name);
    const alternateRole = roles.find(
      (candidate) => candidate.capability !== role.capability,
    );
    expect(source).toBeDefined();
    expect(alternateRole).toBeDefined();
    if (!source || !alternateRole) return;

    for (const target of ["claude", "codex"] as const) {
      const alternateEffortRole = roles.find((candidate) =>
        target === "claude"
          ? candidate.claudeEffort !== role.claudeEffort
          : candidate.codexEffort !== role.codexEffort,
      );
      expect(alternateEffortRole).toBeDefined();
      if (!alternateEffortRole) continue;
      const producer = getSkillOutput(
        outputs,
        "play-agent-dispatch",
        target,
      ).content;
      const projectionFailures = (
        renderedProducer: string,
        policySource = routingPolicySource,
      ): string[] =>
        d4ProducerProjectionFailures(
          owner,
          roles,
          renderedProducer,
          target,
          policySource,
        );
      expect(projectionFailures(producer)).toEqual([]);

      for (const [label, hiddenHeading] of Object.entries({
        duplicateCanonical:
          "<!-- machine note\n### D4 Declaration Obligation\n-->",
        sameLevelSibling: " <!-- machine note\n### Peer Route Registry\n-->",
        higherLevelSibling: "  <!-- machine note\n## Peer Route Registry\n-->",
        threeSpaceMultilineClose:
          "   <!-- machine note\n### Peer Route Registry\ncontinued note\n-->",
        fenceInsideComment:
          "<!-- machine note\n```markdown\n### Peer Route Registry\n-->",
      })) {
        const ownerWithCommentHiddenHeading = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `This policy is the sole D4 route owner.\n\n${hiddenHeading}\n\nAnother policy is a peer D4 route owner.`,
        );
        expect(
          ownerWithCommentHiddenHeading,
          `${target}:owner HTML-comment ${label}:mutation`,
        ).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, ownerWithCommentHiddenHeading),
          `${target}:owner HTML-comment ${label}`,
        ).toEqual(["D4:owner:sole-route-owner"]);
      }

      for (const [label, hiddenHeading] of Object.entries({
        duplicateCanonical:
          "<!-- machine note\n### Semantic Route Contract\n-->",
        sameLevelSibling:
          " <!-- machine note\n### Source-Immutable Specialists\n-->",
        higherLevelSibling:
          "   <!-- machine note\n## Hidden producer boundary\n-->",
      })) {
        const producerWithCommentHiddenHeading = producer.replace(
          "### Source-Immutable Specialists",
          `${hiddenHeading}\n\nYAML is a peer semantic authority.\n\n### Source-Immutable Specialists`,
        );
        expect(
          producerWithCommentHiddenHeading,
          `${target}:producer HTML-comment ${label}:mutation`,
        ).not.toBe(producer);
        expect(
          projectionFailures(producerWithCommentHiddenHeading),
          `${target}:producer HTML-comment ${label}`,
        ).toEqual(["D4:partition:yaml-contradiction"]);
      }

      const ownerFenceContainingCommentOpener = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\n```markdown\n<!--\n### D4 Declaration Obligation\n-->\n```\n\nAnother policy is a peer D4 route owner.",
      );
      expect(ownerFenceContainingCommentOpener).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, ownerFenceContainingCommentOpener),
      ).toEqual(["D4:owner:sole-route-owner"]);

      for (const [label, impostor] of Object.entries({
        fourSpace: "    <!--\n### Peer Route Registry\n-->",
        tabIndented: "\t<!--\n### Peer Route Registry\n-->",
        nearMatch: "<! --\n### Peer Route Registry\n-->",
      })) {
        const ownerWithLiveHeadingImpostor = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `This policy is the sole D4 route owner.\n\n${impostor}\n\nAnother policy is a peer D4 route owner.`,
        );
        expect(
          ownerWithLiveHeadingImpostor,
          `${target}:owner HTML-comment impostor ${label}:mutation`,
        ).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, ownerWithLiveHeadingImpostor),
          `${target}:owner HTML-comment impostor ${label}`,
        ).toEqual([
          "D4:owner:producer-consumer-boundary",
          "D4:owner:controller-field-set",
          "D4:owner:owner-field-set",
          "D4:owner:agent-spec",
          "D4:owner:config",
          "D4:owner:yaml-conformance",
          "D4:owner:planner-classification",
        ]);
      }

      const effortForTarget = (candidate: AgentSemanticRoleContract): string =>
        target === "claude" ? candidate.claudeEffort : candidate.codexEffort;
      const labeledRecord = (candidate: AgentSemanticRoleContract): string =>
        `- role=${candidate.name}; capability=${candidate.capability}; effort=${effortForTarget(candidate)}; source_authority=${candidate.sourceAuthority}`;
      const duplicateRole = roles[0];
      const fiveDistinctRolesWithDuplicate = [
        ...roles.slice(0, 5),
        duplicateRole,
      ];
      const duplicateRegistry = fiveDistinctRolesWithDuplicate
        .map(labeledRecord)
        .join("\n");
      expect(fiveDistinctRolesWithDuplicate).toHaveLength(6);
      expect(
        new Set(
          fiveDistinctRolesWithDuplicate.map((candidate) => candidate.name),
        ).size,
      ).toBe(5);
      expect(fiveDistinctRolesWithDuplicate.at(-1)?.name).toBe(
        duplicateRole.name,
      );
      expect(duplicateRegistry.split("\n")).toHaveLength(6);
      const producerWithDuplicateRegistry = producer.replace(
        "### Source-Immutable Specialists",
        `${duplicateRegistry}\n\n### Source-Immutable Specialists`,
      );
      expect(
        producerWithDuplicateRegistry,
        `${target}:five-distinct-roles-plus-duplicate mutation`,
      ).not.toBe(producer);
      const duplicateRegistrySection = markdownHeadingSection(
        producerWithDuplicateRegistry,
        "### Semantic Route Contract",
      );
      expect(
        duplicateRegistrySection,
        `${target}:five-distinct-roles-plus-duplicate section`,
      ).toBeDefined();
      expect(
        duplicateRegistrySection,
        `${target}:five-distinct-roles-plus-duplicate injection`,
      ).toContain(duplicateRegistry);
      expect(
        projectionFailures(producerWithDuplicateRegistry),
        `${target}:five-distinct-roles-plus-duplicate`,
      ).toEqual([]);

      const sixthRole = roles[5];
      const sixthRecordWithoutSourceAuthority = `- role=${sixthRole.name}; capability=${sixthRole.capability}; effort=${effortForTarget(sixthRole)}; note=${sixthRole.sourceAuthority}`;
      const noteMaskedSixthRegistry = [
        ...roles.slice(0, 5).map(labeledRecord),
        sixthRecordWithoutSourceAuthority,
      ].join("\n");
      expect(noteMaskedSixthRegistry.split("\n")).toHaveLength(6);
      expect(sixthRecordWithoutSourceAuthority).toContain(
        `note=${sixthRole.sourceAuthority}`,
      );
      expect(
        ["role=", "capability=", "effort=", "source_authority="].filter(
          (label) => sixthRecordWithoutSourceAuthority.includes(label),
        ),
      ).toEqual(["role=", "capability=", "effort="]);
      const producerWithNoteMaskedSixthRegistry = producer.replace(
        "### Source-Immutable Specialists",
        `${noteMaskedSixthRegistry}\n\n### Source-Immutable Specialists`,
      );
      expect(
        producerWithNoteMaskedSixthRegistry,
        `${target}:sixth-role-note-masked-source-authority mutation`,
      ).not.toBe(producer);
      const noteMaskedSixthRegistrySection = markdownHeadingSection(
        producerWithNoteMaskedSixthRegistry,
        "### Semantic Route Contract",
      );
      expect(
        noteMaskedSixthRegistrySection,
        `${target}:sixth-role-note-masked-source-authority section`,
      ).toBeDefined();
      expect(
        noteMaskedSixthRegistrySection,
        `${target}:sixth-role-note-masked-source-authority injection`,
      ).toContain(noteMaskedSixthRegistry);
      expect(
        noteMaskedSixthRegistrySection,
        `${target}:sixth-role-note-masked-source-authority sixth-record`,
      ).toContain(sixthRecordWithoutSourceAuthority);
      expect(
        projectionFailures(producerWithNoteMaskedSixthRegistry),
        `${target}:sixth-role-note-masked-source-authority`,
      ).toEqual([]);

      const nonSolePolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is a D4 route owner",
      );
      expect(nonSolePolicyOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, nonSolePolicyOwner)).toEqual([
        "D4:owner:sole-route-owner",
      ]);

      const contradictoryPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner. Another policy is a peer D4 route owner",
      );
      expect(contradictoryPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, contradictoryPeerPolicyOwner),
      ).toEqual(["D4:owner:sole-route-owner"]);

      const duplicateSolePolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner. This policy is the sole D4 route owner",
      );
      expect(duplicateSolePolicyOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, duplicateSolePolicyOwner)).toEqual([
        "D4:owner:sole-route-owner",
      ]);

      const omittedPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner: ",
        "",
      );
      expect(omittedPolicyOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, omittedPolicyOwner)).toEqual([
        "D4:owner:sole-route-owner",
      ]);

      const blankParagraphPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\nAnother policy is a peer D4 route owner",
      );
      expect(blankParagraphPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, blankParagraphPeerPolicyOwner),
      ).toEqual(["D4:owner:sole-route-owner"]);

      const nestedPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\n#### Ownership detail\n\nAnother policy is a non-sole D4 route owner",
      );
      expect(nestedPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, nestedPeerPolicyOwner)).toEqual([
        "D4:owner:sole-route-owner",
      ]);

      const fencedSiblingPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\n```markdown\n### Ordinary child failure disposition\n```\n\nAnother policy is a peer D4 route owner",
      );
      expect(fencedSiblingPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, fencedSiblingPeerPolicyOwner),
      ).toEqual(["D4:owner:sole-route-owner"]);

      const invalidBacktickInfoPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\n```markdown`\n#### Ownership detail\n\nAnother policy is a peer D4 route owner",
      );
      expect(invalidBacktickInfoPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, invalidBacktickInfoPeerPolicyOwner),
      ).toEqual(["D4:owner:sole-route-owner"]);

      for (const [label, indentation] of Object.entries({
        fourSpaceParagraphContinuation: "    ",
        tabParagraphContinuation: "\t",
      })) {
        const policyWithIndentedContinuation = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `This policy is the sole D4 route owner\n${indentation}Another policy is a peer D4 route owner.`,
        );
        expect(policyWithIndentedContinuation, label).not.toBe(
          routingPolicySource,
        );
        expect(
          projectionFailures(producer, policyWithIndentedContinuation),
          label,
        ).toEqual(["D4:owner:sole-route-owner"]);
      }

      const malformedInlineLinkPeerPolicyOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner.\n\n[Another policy is a peer D4 route owner.](./owners/(peer.md)",
      );
      expect(malformedInlineLinkPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(
        projectionFailures(producer, malformedInlineLinkPeerPolicyOwner),
      ).toEqual(["D4:owner:sole-route-owner"]);

      for (const [label, contradictoryClaim] of Object.entries({
        nestedBullet:
          "#### Ownership detail\n\n- Another policy is a peer D4 route owner",
        orderedList: "1. Another policy is a peer D4 route owner",
        softWrapped: "Another policy is a peer D4\nroute owner.",
        softWrappedBullet: "- Another policy is a peer D4\n  route owner.",
        nestedList:
          "- Ownership detail:\n    - Another policy is a peer D4 route owner.",
        nestedOrdered:
          "1. Ownership detail:\n   1. Another policy is a peer D4 route owner.",
        fourSpaceListContinuation:
          "10. Another policy is a peer D4\n    route owner.",
        tabbedListContinuation: "- Another policy is a peer D4\n\troute owner.",
        quoteInterruptedByBullet:
          "> Reference prose\n- Another policy is a peer D4 route owner.",
        quoteInterruptedByOrderedList:
          "> Reference prose\n1. Another policy is a peer D4 route owner.",
        quoteInterruptedByLeadingZeroDot:
          "> Reference prose\n01. Another policy is a peer D4 route owner.",
        quoteInterruptedByLeadingZeroParen:
          "> Reference prose\n01) Another policy is a peer D4 route owner.",
        dashThematicBreakInterrupt:
          "> Reference prose\n---\nAnother policy is a peer D4 route owner.",
        asteriskThematicBreakInterrupt:
          "> Reference prose\n***\nAnother policy is a peer D4 route owner.",
        underscoreThematicBreakInterrupt:
          "> Reference prose\n_ _ _\nAnother policy is a peer D4 route owner.",
        quotedDashThematicBreak:
          "> ---\nAnother policy is a peer D4 route owner.",
        quotedAsteriskThematicBreak:
          "> ***\nAnother policy is a peer D4 route owner.",
        quotedUnderscoreThematicBreak:
          "> _ _ _\nAnother policy is a peer D4 route owner.",
        quotedTabDashThematicBreak:
          "> \t---\nAnother policy is a peer D4 route owner.",
        quotedTabAsteriskThematicBreak:
          "> \t***\nAnother policy is a peer D4 route owner.",
        quotedTabUnderscoreThematicBreak:
          "> \t_ _ _\nAnother policy is a peer D4 route owner.",
        quotedHeadingPeerOwner:
          "> #### Reference heading\nAnother policy is a peer D4 route owner.",
        quotedFenceBodyPeerOwner:
          "> ```text\n> Reference code\nAnother policy is a peer D4 route owner.",
        quotedTabIndentedCodePeerOwner:
          ">\t  Reference code\nAnother policy is a peer D4 route owner.",
        htmlCommentInterruptsLazyQuote:
          "> Reference prose\n<!-- machine note -->\nAnother policy is a peer D4 route owner.",
        multilineHtmlCommentInterruptsLazyQuote:
          "> Reference prose\n   <!-- machine\n   note -->\nAnother policy is a peer D4 route owner.",
        htmlCommentNearMatchPeerOwner:
          "<! -- Another policy is a peer D4 route owner. -->",
        fourSpaceHtmlCommentImpostor:
          "    <!-- machine note\nAnother policy is a peer D4 route owner.\n-->",
        tabIndentedHtmlCommentImpostor:
          "\t<!-- machine note\nAnother policy is a peer D4 route owner.\n-->",
      })) {
        const policyWithContradictoryClaim = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `This policy is the sole D4 route owner.\n\n${contradictoryClaim}`,
        );
        expect(policyWithContradictoryClaim, label).not.toBe(
          routingPolicySource,
        );
        expect(
          projectionFailures(producer, policyWithContradictoryClaim),
          label,
        ).toEqual(["D4:owner:sole-route-owner"]);
      }

      for (const indent of ["", " ", "  ", "   "]) {
        const policyWithCommentInterruption = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `This policy is the sole D4 route owner.\n\n> Reference prose\n${indent}<!-- machine note -->\nAnother policy is a peer D4 route owner.`,
        );
        expect(
          policyWithCommentInterruption,
          `comment-interruption-${indent.length}:mutation`,
        ).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, policyWithCommentInterruption),
          `comment-interruption-${indent.length}`,
        ).toEqual(["D4:owner:sole-route-owner"]);
      }

      for (const [syntax, reference] of Object.entries({
        shortcut: {
          claim: "[Another policy is a peer D4 route owner.]",
          definition:
            "[Another policy is a peer D4 route owner.]: ./peer-owner-example.md",
        },
        collapsed: {
          claim: "[Another policy is a peer D4 route owner.][]",
          definition:
            "[Another policy is a peer D4 route owner.]: ./peer-owner-example.md",
        },
        full: {
          claim: "[Another policy is a peer D4 route owner.][peer-owner]",
          definition: "[peer-owner]: ./peer-owner-example.md",
        },
      })) {
        for (const [codeKind, codedDefinition] of Object.entries({
          fenced: `\`\`\`text\n${reference.definition}\n\`\`\``,
          indented: `    ${reference.definition}`,
          tabIndented: `\t${reference.definition}`,
          blockquote: `> ${reference.definition}`,
        })) {
          const policyWithCodeDefinition = routingPolicySource.replace(
            "This policy is the sole D4 route owner",
            `${reference.claim}\n\n${codedDefinition}\n\nThis policy is the sole D4 route owner`,
          );
          expect(policyWithCodeDefinition, `${syntax}:${codeKind}`).not.toBe(
            routingPolicySource,
          );
          expect(
            projectionFailures(producer, policyWithCodeDefinition),
            `${syntax}:${codeKind}`,
          ).toEqual(["D4:owner:sole-route-owner"]);
        }
        const definitionPrefix = reference.definition.slice(
          0,
          reference.definition.indexOf(":") + 1,
        );
        for (const [invalidKind, invalidDefinition] of Object.entries({
          prefixOnly: definitionPrefix,
          whitespaceOnly: `${definitionPrefix}   `,
          emptyAngleDestination: `${definitionPrefix} <>`,
          unmatchedOpeningParenthesis: `${definitionPrefix} ./owners/(peer.md`,
          unmatchedClosingParenthesis: `${definitionPrefix} ./owners/peer).md`,
          whitespaceBreak: `${definitionPrefix} ./owners/peer owner.md`,
          controlBreakTab: `${definitionPrefix} ./owners/peer\towner.md`,
          missingClosingAngle: `${definitionPrefix} <./owners/peer.md`,
          unmatchedClosingAngle: `${definitionPrefix} ./owners/peer.md>`,
        })) {
          const policyWithInvalidDefinition = routingPolicySource.replace(
            "This policy is the sole D4 route owner",
            `${reference.claim}\n\n${invalidDefinition}\n\nThis policy is the sole D4 route owner`,
          );
          expect(
            policyWithInvalidDefinition,
            `${syntax}:${invalidKind}`,
          ).not.toBe(routingPolicySource);
          expect(
            markdownHeadingSection(
              policyWithInvalidDefinition,
              "### D4 Declaration Obligation",
            ),
            `${syntax}:${invalidKind}:bounded-placement`,
          ).toContain(invalidDefinition);
          expect(
            projectionFailures(producer, policyWithInvalidDefinition),
            `${syntax}:${invalidKind}`,
          ).toEqual(["D4:owner:sole-route-owner"]);
        }
      }

      for (const [label, evidence] of Object.entries({
        normalizedEmptyLabel:
          "[Another policy is a peer D4 route owner.][ ]\n\n[   ]: ./peer-owner-example.md",
        unmatchedShortcutDestination:
          "[Another policy is a peer D4 route owner.]\n\n[Another policy is a peer D4 route owner.]: )",
      })) {
        const invalidReferenceOwner = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `${evidence}\n\nThis policy is the sole D4 route owner`,
        );
        expect(invalidReferenceOwner, label).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, invalidReferenceOwner),
          label,
        ).toEqual(["D4:owner:sole-route-owner"]);
      }
      for (const [label, evidence] of Object.entries({
        normalizedValidLabel:
          "[Another policy is a peer D4 route owner.][peer owner]\n\n[  peer   owner ]: ./peer-owner-example.md",
        balancedDestination:
          "[Another policy is a peer D4 route owner.]\n\n[Another policy is a peer D4 route owner.]: ./owners/(peer).md",
        angleDestination:
          "[Another policy is a peer D4 route owner.]\n\n[Another policy is a peer D4 route owner.]: <./peer-owner-example.md>",
      })) {
        const validReferenceOwner = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `${evidence}\n\nThis policy is the sole D4 route owner`,
        );
        expect(validReferenceOwner, label).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, validReferenceOwner),
          label,
        ).toEqual([]);
      }

      const ownerNearMatch = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "This policy is the sole D4 route owner. Another policy documents a peer D4 route owner reference",
      );
      expect(ownerNearMatch).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, ownerNearMatch)).toEqual([]);

      for (const [label, nonAuthoritativeEvidence] of Object.entries({
        blockquote: "> Another policy is a peer D4 route owner.",
        lazyBlockquote:
          "> Reference: another ownership example follows\nAnother policy is a peer D4 route owner.",
        nonInterruptingOrderedQuote:
          "> Reference prose\n2. Another policy is a peer D4 route owner.",
        nonInterruptingZeroQuote:
          "> Reference prose\n0. Another policy is a peer D4 route owner.",
        nonInterruptingTenDigitQuote:
          "> Reference prose\n0000000001. Another policy is a peer D4 route owner.",
        nonThematicTwoMarkerQuote:
          "> Reference prose\n--\nAnother policy is a peer D4 route owner.",
        nonThematicMixedMarkerQuote:
          "> Reference prose\n-*-\nAnother policy is a peer D4 route owner.",
        tabExpandedDashNearMissQuote:
          "> Reference prose\n \t---\nAnother policy is a peer D4 route owner.",
        tabExpandedAsteriskNearMissQuote:
          "> Reference prose\n \t***\nAnother policy is a peer D4 route owner.",
        tabExpandedUnderscoreNearMissQuote:
          "> Reference prose\n \t_ _ _\nAnother policy is a peer D4 route owner.",
        link: "[Another policy is a peer D4 route owner.](./peer-owner-example.md)",
        referenceDefinition:
          "[Another policy is a peer D4 route owner.]: ./peer-owner-example.md",
        shortcutReference:
          "[Another policy is a peer D4 route owner.]\n\n[Another policy is a peer D4 route owner.]: ./peer-owner-example.md",
        collapsedReference:
          "[Another policy is a peer D4 route owner.][]\n\n[Another policy is a peer D4 route owner.]: ./peer-owner-example.md",
        fullReference:
          "[Another policy is a peer D4 route owner.][peer-owner]\n\n[peer-owner]: ./peer-owner-example.md",
        inlineCode: "`Another policy is a peer D4 route owner.`",
        fencedCode: "```text\nAnother policy is a peer D4 route owner.\n```",
        longerFence:
          "````text\n```\nAnother policy is a peer D4 route owner.\n````",
        indentedCode: "    Another policy is a peer D4 route owner.",
        tabIndentedCode: "\tAnother policy is a peer D4 route owner.",
        singleLineHtmlComment:
          "<!-- Another policy is a peer D4 route owner. -->",
        multilineHtmlComment:
          "<!-- machine note\nAnother policy is a peer D4 route owner.\n-->",
        oneSpaceHtmlComment:
          " <!-- Another policy is a peer D4 route owner. -->",
        twoSpaceHtmlComment:
          "  <!-- Another policy is a peer D4 route owner. -->",
        threeSpaceHtmlComment:
          "   <!-- Another policy is a peer D4 route owner. -->",
        exampleProse: "Example: Another policy is a peer D4 route owner.",
      })) {
        const policyWithNonAuthoritativeEvidence = routingPolicySource.replace(
          "This policy is the sole D4 route owner",
          `${nonAuthoritativeEvidence}\n\nThis policy is the sole D4 route owner`,
        );
        expect(policyWithNonAuthoritativeEvidence, label).not.toBe(
          routingPolicySource,
        );
        expect(
          projectionFailures(producer, policyWithNonAuthoritativeEvidence),
          label,
        ).toEqual([]);
      }

      const listCanonicalOwner = routingPolicySource.replace(
        "This policy is the sole D4 route owner",
        "- This policy is the sole D4 route owner",
      );
      expect(listCanonicalOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, listCanonicalOwner)).toEqual([]);

      const yamlPeerPolicyOwner = routingPolicySource.replace(
        "peer semantic authorities. Cognitive demand",
        "peer semantic authorities. YAML is a peer semantic authority. Cognitive demand",
      );
      expect(yamlPeerPolicyOwner).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, yamlPeerPolicyOwner)).toEqual([
        "D4:owner:yaml-contradiction",
      ]);

      const ownerWithoutApproval = routingPolicySource.replace(
        "and\n`approval_ref`; `termination`",
        "and\n`termination`",
      );
      expect(ownerWithoutApproval).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, ownerWithoutApproval)).toEqual([
        "D4:owner:controller-field-set",
      ]);

      const withoutSection = producer.replace(
        /### Semantic Route Contract[\s\S]*?(?=### Source-Immutable Specialists)/,
        "",
      );
      expect(withoutSection).not.toBe(producer);
      expect(projectionFailures(withoutSection)).toEqual([
        "D4:producer-section",
      ]);

      const duplicateOwnerHeading = routingPolicySource.replace(
        "### Ordinary child failure disposition",
        "### D4 Declaration Obligation\n\nThis competing section is an independent D4 declaration authority.\n\n### Ordinary child failure disposition",
      );
      expect(duplicateOwnerHeading).not.toBe(routingPolicySource);
      expect(
        duplicateOwnerHeading
          .split("\n")
          .filter((line) => line.trim() === "### D4 Declaration Obligation"),
      ).toHaveLength(2);
      expect(projectionFailures(producer, duplicateOwnerHeading)).toEqual([
        "D4:owner:declaration-section",
      ]);

      for (const indent of [" ", "  ", "   "]) {
        const indentedOwnerHeading = routingPolicySource.replace(
          "### D4 Declaration Obligation",
          `${indent}### D4 Declaration Obligation`,
        );
        expect(indentedOwnerHeading).not.toBe(routingPolicySource);
        expect(
          projectionFailures(producer, indentedOwnerHeading),
          `${target}:owner canonical heading indent ${indent.length}`,
        ).toEqual([]);

        const indentedProducerHeading = producer.replace(
          "### Semantic Route Contract",
          `${indent}### Semantic Route Contract`,
        );
        expect(indentedProducerHeading).not.toBe(producer);
        expect(
          projectionFailures(indentedProducerHeading),
          `${target}:producer canonical heading indent ${indent.length}`,
        ).toEqual([]);
      }

      const indentedOwnerSibling = routingPolicySource.replace(
        "### D4 Declaration Obligation\n\nThis policy",
        "### D4 Declaration Obligation\n\n  ### Peer Route Registry\n\nThis policy",
      );
      expect(indentedOwnerSibling).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, indentedOwnerSibling)).toEqual([
        "D4:owner:declaration-section",
      ]);

      const higherLevelOwnerSibling = routingPolicySource.replace(
        "### D4 Declaration Obligation\n\nThis policy",
        "### D4 Declaration Obligation\n\n  ## Peer Route Registry\n\nThis policy",
      );
      expect(higherLevelOwnerSibling).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, higherLevelOwnerSibling)).toEqual([
        "D4:owner:declaration-section",
      ]);

      const nestedOwnerHeading = routingPolicySource.replace(
        "### D4 Declaration Obligation\n\nThis policy",
        "### D4 Declaration Obligation\n\n  #### Owner Detail\n\nThis policy",
      );
      expect(nestedOwnerHeading).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, nestedOwnerHeading)).toEqual([]);

      const indentedProducerSibling = producer.replace(
        "### Semantic Route Contract\n\nBefore each",
        "### Semantic Route Contract\n\n  ### Peer Route Registry\n\nBefore each",
      );
      expect(indentedProducerSibling).not.toBe(producer);
      expect(projectionFailures(indentedProducerSibling)).toEqual([
        "D4:producer-section",
      ]);

      const higherLevelProducerSibling = producer.replace(
        "### Semantic Route Contract\n\nBefore each",
        "### Semantic Route Contract\n\n  ## Peer Route Registry\n\nBefore each",
      );
      expect(higherLevelProducerSibling).not.toBe(producer);
      expect(projectionFailures(higherLevelProducerSibling)).toEqual([
        "D4:producer-section",
      ]);

      const nestedProducerHeading = producer.replace(
        "### Semantic Route Contract\n\nBefore each",
        "### Semantic Route Contract\n\n  #### Producer Detail\n\nBefore each",
      );
      expect(nestedProducerHeading).not.toBe(producer);
      expect(projectionFailures(nestedProducerHeading)).toEqual([]);

      const producerWithFencedSiblingAuthority = producer.replace(
        "### Source-Immutable Specialists",
        "```markdown\n### Source-Immutable Specialists\n```\n\nYAML is a peer semantic authority.\n\n### Source-Immutable Specialists",
      );
      expect(producerWithFencedSiblingAuthority).not.toBe(producer);
      expect(projectionFailures(producerWithFencedSiblingAuthority)).toEqual([
        "D4:partition:yaml-contradiction",
      ]);

      const codeImpostorOwnerHeading = routingPolicySource.replace(
        "### D4 Declaration Obligation",
        "    ### D4 Declaration Obligation",
      );
      expect(codeImpostorOwnerHeading).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, codeImpostorOwnerHeading)).toEqual([
        "D4:owner:declaration-section",
      ]);

      const codeImpostorProducerHeading = producer.replace(
        "### Semantic Route Contract",
        "    ### Semantic Route Contract",
      );
      expect(codeImpostorProducerHeading).not.toBe(producer);
      expect(projectionFailures(codeImpostorProducerHeading)).toEqual([
        "D4:producer-section",
      ]);

      const codeImpostorOwnerSibling = routingPolicySource.replace(
        "### D4 Declaration Obligation\n\nThis policy",
        "### D4 Declaration Obligation\n\n    ### Peer Route Registry\n\nThis policy",
      );
      expect(codeImpostorOwnerSibling).not.toBe(routingPolicySource);
      expect(projectionFailures(producer, codeImpostorOwnerSibling)).toEqual(
        [],
      );

      const codeImpostorProducerSibling = producer.replace(
        "### Semantic Route Contract\n\nBefore each",
        "### Semantic Route Contract\n\n    ### Peer Route Registry\n\nBefore each",
      );
      expect(codeImpostorProducerSibling).not.toBe(producer);
      expect(projectionFailures(codeImpostorProducerSibling)).toEqual([]);

      const competingRegistry = roles.map(labeledRecord).join("\n");
      const duplicateProducerHeading = producer.replace(
        "### Source-Immutable Specialists",
        `### Semantic Route Contract\n\n${competingRegistry}\n\n### Source-Immutable Specialists`,
      );
      expect(duplicateProducerHeading).not.toBe(producer);
      expect(
        duplicateProducerHeading
          .split("\n")
          .filter((line) => line.trim() === "### Semantic Route Contract"),
      ).toHaveLength(2);
      expect(duplicateProducerHeading).toContain(competingRegistry);
      expect(projectionFailures(duplicateProducerHeading)).toEqual([
        "D4:producer-section",
      ]);

      const ownerDerivedFieldMutations = {
        missing: routingPolicySource.replace(
          "`codex_sandbox`,\nand `default_network`.",
          "`codex_sandbox`.",
        ),
        extra: routingPolicySource.replace(
          "`codex_sandbox`,\nand `default_network`.",
          "`codex_sandbox`, `default_network`, and `authority_ref`.",
        ),
        duplicate: routingPolicySource.replace(
          "`capability`, target-native `effort`",
          "`capability`, `capability`, target-native `effort`",
        ),
        scattered: routingPolicySource
          .replace(
            "`codex_sandbox`,\nand `default_network`.",
            "`codex_sandbox`.",
          )
          .replace(
            "solely resolves the exact-target/capability `model`.",
            "solely resolves the exact-target/capability `model`. The selected role also derives `default_network`.",
          ),
      };
      for (const [mutation, mutatedOwner] of Object.entries(
        ownerDerivedFieldMutations,
      )) {
        expect(mutatedOwner, `${target}:${mutation}`).not.toBe(
          routingPolicySource,
        );
        expect(
          projectionFailures(producer, mutatedOwner),
          `${target}:${mutation}`,
        ).toEqual(["D4:owner:owner-field-set"]);
      }
      for (const qualifier of [
        "generic",
        "ambient",
        target === "claude" ? "Codex-native" : "Claude-native",
      ]) {
        const mutatedOwner = routingPolicySource.replace(
          "target-native `effort`",
          `${qualifier} \`effort\``,
        );
        expect(mutatedOwner, `${target}:${qualifier}`).not.toBe(
          routingPolicySource,
        );
        expect(
          projectionFailures(producer, mutatedOwner),
          `${target}:${qualifier}`,
        ).toEqual(["D4:owner:owner-field-set"]);
      }

      const producerOwnerDerivedMutations = [
        {
          name: "masked missing default_network",
          mutated: producer
            .replace(
              "ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`.",
              "ordered duplicate-free `claude_tools` and `codex_sandbox`.",
            )
            .replace(
              "`devcanon.config.yaml`.",
              "`devcanon.config.yaml`. Backticked `default_network` remains a nearby reference.",
            ),
          fragment: "Backticked `default_network` remains a nearby reference.",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "extra owner-derived field",
          mutated: producer.replace(
            "ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`.",
            "ordered duplicate-free `claude_tools`, `codex_sandbox`, `default_network`, and `authority_ref`.",
          ),
          fragment: "`authority_ref`",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "duplicate owner-derived field",
          mutated: producer.replace(
            "`capability`, target-native `effort`",
            "`capability`, `capability`, target-native `effort`",
          ),
          fragment: "`capability`, `capability`",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "scattered owner-derived field",
          mutated: producer
            .replace(
              "ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`.",
              "ordered duplicate-free `claude_tools` and `codex_sandbox`.",
            )
            .replace(
              "`devcanon.config.yaml`.",
              "`devcanon.config.yaml`. The selected role also declares `default_network`.",
            ),
          fragment: "The selected role also declares `default_network`.",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "reordered owner-derived fields",
          mutated: producer.replace(
            "`source_authority`, `external_authority`",
            "`external_authority`, `source_authority`",
          ),
          fragment: "`external_authority`, `source_authority`",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "non-target-native effort",
          mutated: producer.replace(
            "target-native `effort`",
            "generic `effort`",
          ),
          fragment: "generic `effort`",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "near-miss owner-derived clause anchor",
          mutated: producer.replace(
            /For that exact selected role and\s+target, declare its/u,
            "For a nearby selected role and target, declare its",
          ),
          fragment: "For a nearby selected role and target, declare its",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "model moved into owner-derived list",
          mutated: producer.replace(
            "ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`.",
            "ordered duplicate-free `claude_tools`, `codex_sandbox`, `default_network`, and `model`.",
          ),
          fragment: "`default_network`, and `model`.",
          expected: ["D4:owner-derived-field-set"],
        },
        {
          name: "unmasked missing default_network",
          mutated: producer.replace(
            "ordered duplicate-free `claude_tools`, `codex_sandbox`, and `default_network`.",
            "ordered duplicate-free `claude_tools` and `codex_sandbox`.",
          ),
          fragment:
            "ordered duplicate-free `claude_tools` and `codex_sandbox`.",
          expected: ["D4:required-field:default_network"],
        },
      ];
      const canonicalProducerSection = markdownHeadingSection(
        producer,
        "### Semantic Route Contract",
      );
      expect(canonicalProducerSection).toBeDefined();
      for (const mutation of producerOwnerDerivedMutations) {
        expect(mutation.mutated, `${target}:${mutation.name}`).not.toBe(
          producer,
        );
        const mutatedSection = markdownHeadingSection(
          mutation.mutated,
          "### Semantic Route Contract",
        );
        expect(mutatedSection, `${target}:${mutation.name}:bounded`).toContain(
          mutation.fragment,
        );
        expect(
          mutatedSection,
          `${target}:${mutation.name}:section-change`,
        ).not.toBe(canonicalProducerSection);
        expect(
          projectionFailures(mutation.mutated),
          `${target}:${mutation.name}`,
        ).toEqual(mutation.expected);
      }

      const withoutApproval = producer.replace("`approval_ref`", "approval");
      expect(withoutApproval).not.toBe(producer);
      expect(projectionFailures(withoutApproval)).toEqual([
        "D4:required-field:approval_ref",
      ]);

      const withoutSpecOwner = producer.replace(
        "`docs/specs/agents.md`",
        "agent sources",
      );
      expect(withoutSpecOwner).not.toBe(producer);
      expect(projectionFailures(withoutSpecOwner)).toEqual([
        "D4:partition:agent-spec",
      ]);

      const withoutConfigOwner = producer.replace(
        "`devcanon.config.yaml`",
        "ambient configuration",
      );
      expect(withoutConfigOwner).not.toBe(producer);
      expect(projectionFailures(withoutConfigOwner)).toEqual([
        "D4:owner-derived-field-set",
        "D4:partition:config",
      ]);

      const yamlAsPeer = producer.replace(
        "governed declarations and parity\ninputs, never semantic authorities",
        "peer semantic authorities",
      );
      expect(yamlAsPeer).not.toBe(producer);
      expect(projectionFailures(yamlAsPeer)).toEqual([
        "D4:partition:yaml-conformance",
      ]);

      const producerOwnedRouteSet = producer.replace(
        "one\nof the policy-owned six-role set before spawn; a generic or inherited workflow\ndoes not supply a child route",
        "one\nof the producer-owned six-role set before spawn; a generic or inherited workflow\ndoes not supply a child route",
      );
      expect(producerOwnedRouteSet).not.toBe(producer);
      expect(projectionFailures(producerOwnedRouteSet)).toEqual([
        "D4:producer-consumer-boundary",
      ]);

      const canonicalD4Route = owner.directChildRoutes.find(
        (candidate) => candidate.id === "D4",
      );
      expect(canonicalD4Route).toBeDefined();
      if (!canonicalD4Route) throw new Error("missing canonical D4 route");
      const nonSoleOwner = {
        ...owner,
        directChildRoutes: [
          ...owner.directChildRoutes,
          {
            ...canonicalD4Route,
            ownerSkill: "play-review",
          },
        ],
      };
      expect(
        d4ProducerProjectionFailures(nonSoleOwner, roles, producer, target),
      ).toEqual(["D4:producer-route-owner"]);

      const substitutedControllerField = producer.replace(
        "planner-selected `selected_role_id`",
        "planner-selected `role_id`",
      );
      expect(substitutedControllerField).not.toBe(producer);
      expect(projectionFailures(substitutedControllerField)).toEqual([
        "D4:required-field:selected_role_id",
      ]);

      const duplicateControllerField = producer.replace(
        "`termination`; `context_ref`; and `approval_ref` are controller-bound;",
        "`termination`; `context_ref`; `approval_ref`; and `approval_ref` are controller-bound;",
      );
      expect(duplicateControllerField).not.toBe(producer);
      expect(projectionFailures(duplicateControllerField)).toEqual([
        "D4:controller-field-set",
      ]);

      const scatteredControllerField = producer.replace(
        "`termination`; `context_ref`; and `approval_ref` are controller-bound;",
        "`termination`; and `approval_ref` are controller-bound. `context_ref` is controller-bound;",
      );
      expect(scatteredControllerField).not.toBe(producer);
      expect(projectionFailures(scatteredControllerField)).toEqual([
        "D4:controller-field-set",
      ]);

      const extraAuthorityField = producer.replace(
        "`termination`; `context_ref`; and `approval_ref` are controller-bound;",
        "`termination`; `context_ref`; `approval_ref`; and `authority_ref` are controller-bound;",
      );
      expect(extraAuthorityField).not.toBe(producer);
      expect(projectionFailures(extraAuthorityField)).toEqual([
        "D4:controller-field-set",
      ]);

      const producerAuthorityContradiction = producer.replace(
        "governed declarations and parity\ninputs, never semantic authorities; they never override the policy, agent spec,\nor configuration owner.",
        "governed declarations and parity\ninputs, never semantic authorities; they never override the policy, agent spec,\nor configuration owner. YAML is a peer semantic authority for this producer.",
      );
      expect(producerAuthorityContradiction).not.toBe(producer);
      expect(projectionFailures(producerAuthorityContradiction)).toEqual([
        "D4:partition:yaml-contradiction",
      ]);

      const targetEffort =
        target === "claude" ? role.claudeEffort : role.codexEffort;
      const copiedTuple = producer.replace(
        "### Source-Immutable Specialists",
        `\`${role.name}\`, ${role.capability}/${targetEffort}, ${role.sourceAuthority}\n\n### Source-Immutable Specialists`,
      );
      expect(copiedTuple).not.toBe(producer);
      expect(projectionFailures(copiedTuple)).toEqual([]);

      const output = outputs.find(
        (candidate) =>
          candidate.type === "agent" &&
          candidate.target === target &&
          candidate.name === role.name,
      );
      expect(output).toBeDefined();
      if (!output) continue;
      let parsed: ParsedRenderedAgent;
      if (target === "claude") {
        const artifact = parseRenderedMarkdownArtifact(output.content);
        parsed = {
          name: artifact.frontmatter.name,
          description: artifact.frontmatter.description,
          model: artifact.frontmatter.model,
          effort: artifact.frontmatter.effort,
          instructions: artifact.body,
        };
      } else {
        const artifact = parseRenderedTomlArtifact(output.content);
        parsed = {
          name: artifact.name,
          description: artifact.description,
          model: artifact.model,
          effort: artifact.model_reasoning_effort,
          instructions: String(artifact.developer_instructions ?? ""),
        };
      }
      const expectedModel = config.capabilityProfiles[role.capability][target];

      const specDrift: AgentSemanticRoleContract = {
        ...role,
        claudeEffort:
          target === "claude"
            ? alternateEffortRole.claudeEffort
            : role.claudeEffort,
        codexEffort:
          target === "codex"
            ? alternateEffortRole.codexEffort
            : role.codexEffort,
      };
      expect(agentSourceConformanceFailures(specDrift, source)).toEqual([
        `${role.name}:${target}-effort`,
      ]);
      expect(
        renderedAgentAlignmentFailures(
          specDrift,
          source,
          target,
          parsed,
          expectedModel,
        ),
      ).toEqual([
        `${role.name}:${target}-effort`,
        `D4:${role.name}:${target}:target-effort:${String(parsed.effort)}`,
      ]);

      const yamlPeerDrift: AgentSourceContract = {
        ...source,
        capability: alternateRole.capability,
      };
      expect(agentSourceConformanceFailures(role, yamlPeerDrift)).toEqual([
        `${role.name}:capability`,
      ]);
      const yamlPeerParsed = {
        ...parsed,
        model: config.capabilityProfiles[alternateRole.capability][target],
      };
      expect(
        renderedAgentAlignmentFailures(
          role,
          yamlPeerDrift,
          target,
          yamlPeerParsed,
          expectedModel,
        ),
      ).toEqual([
        `${role.name}:capability`,
        `D4:${role.name}:${target}:config-model-resolution:${String(yamlPeerParsed.model)}`,
      ]);

      const modelDrift = { ...parsed, model: `${expectedModel}-drift` };
      expect({ ...modelDrift, model: parsed.model }).toEqual(parsed);
      expect(
        renderedAgentAlignmentFailures(
          role,
          source,
          target,
          modelDrift,
          expectedModel,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:config-model-resolution:${modelDrift.model}`,
      ]);

      const evolvedRole: AgentSemanticRoleContract = {
        ...role,
        claudeEffort: alternateEffortRole.claudeEffort,
        codexEffort: alternateEffortRole.codexEffort,
      };
      const evolvedSource: AgentSourceContract = {
        ...source,
        claude: { ...source.claude, effort: evolvedRole.claudeEffort },
        codex: {
          ...source.codex,
          model_reasoning_effort: evolvedRole.codexEffort,
        },
      };
      const evolvedParsed = {
        ...parsed,
        effort:
          target === "claude"
            ? evolvedRole.claudeEffort
            : evolvedRole.codexEffort,
      };
      expect(
        agentSourceConformanceFailures(evolvedRole, evolvedSource),
      ).toEqual([]);
      expect(
        renderedAgentAlignmentFailures(
          evolvedRole,
          evolvedSource,
          target,
          evolvedParsed,
          expectedModel,
        ),
      ).toEqual([]);
      expect(
        d4ProducerProjectionFailures(
          owner,
          roles.map((candidate) =>
            candidate.name === evolvedRole.name ? evolvedRole : candidate,
          ),
          producer,
          target,
        ),
      ).toEqual([]);

      const mutableRole: AgentSemanticRoleContract = {
        ...role,
        sourceAuthority: "source-mutable",
        externalAuthority: "none",
      };
      expect(agentSourceConformanceFailures(mutableRole, source)).toEqual([
        `${role.name}:source-authority`,
      ]);
      expect(
        renderedAgentAlignmentFailures(
          mutableRole,
          source,
          target,
          parsed,
          expectedModel,
        ),
      ).toEqual([
        `${role.name}:source-authority`,
        `D4:${role.name}:${target}:render-projection:source_authority`,
      ]);

      const sourceAuthorityOpposition = {
        ...parsed,
        instructions: `${parsed.instructions}\nEdit durable content only at the exact dispatch-authorized paths and stay within every stated guardrail.`,
      };
      expect(sourceAuthorityOpposition.instructions).not.toBe(
        parsed.instructions,
      );
      expect(
        renderedAgentAlignmentFailures(
          role,
          source,
          target,
          sourceAuthorityOpposition,
          expectedModel,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:source_authority`,
      ]);

      const defaultNetworkOpposition = {
        ...parsed,
        instructions: `${parsed.instructions}\nUse network access only when the dispatch explicitly names external research; otherwise do not access the network.`,
      };
      expect(defaultNetworkOpposition.instructions).not.toBe(
        parsed.instructions,
      );
      expect(
        renderedAgentAlignmentFailures(
          role,
          source,
          target,
          defaultNetworkOpposition,
          expectedModel,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:default_network`,
      ]);

      const sourceMarker = "Do not make durable file edits.";
      const withoutSourceMarker = parsed.instructions.replace(
        sourceMarker,
        "durable-edit marker removed.",
      );
      expect(withoutSourceMarker).not.toBe(parsed.instructions);
      expect(
        renderedInstructionProjectionFailures(
          role,
          target,
          withoutSourceMarker,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:source_authority`,
      ]);
      const duplicatedSourceMarker = `${parsed.instructions}\n${sourceMarker}`;
      expect(
        renderedInstructionProjectionFailures(
          role,
          target,
          duplicatedSourceMarker,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:source_authority`,
      ]);

      const networkMarker = "Do not use network access.";
      const withoutNetworkMarker = parsed.instructions.replace(
        networkMarker,
        "network marker removed.",
      );
      expect(withoutNetworkMarker).not.toBe(parsed.instructions);
      expect(
        renderedInstructionProjectionFailures(
          role,
          target,
          withoutNetworkMarker,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:default_network`,
      ]);
      const duplicatedNetworkMarker = `${parsed.instructions}\n${networkMarker}`;
      expect(
        renderedInstructionProjectionFailures(
          role,
          target,
          duplicatedNetworkMarker,
        ),
      ).toEqual([
        `D4:${role.name}:${target}:render-projection:default_network`,
      ]);
    }
  });

  it("renders an isolated source-authority evolution from governed inputs", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );
    const [specSource, assessorYaml, baseline] = await Promise.all([
      readFile(path.join(repoRoot, "docs/specs/agents.md"), "utf-8"),
      readFile(path.join(repoRoot, "agents/assessor.yaml"), "utf-8"),
      renderAll(config, false, true),
    ]);
    const evolvedSpecSource = specSource.replace(
      "| `assessor`      | balanced   | medium        | medium       | `source-immutable` | `none`           | Bounded classification or evaluation                  |",
      "| `assessor`      | balanced   | medium        | medium       | `source-mutable`   | `none`           | Bounded classification or evaluation                  |",
    );
    expect(evolvedSpecSource).not.toBe(specSource);
    const evolvedRole = parseAgentSemanticRoleOwner(evolvedSpecSource).find(
      (role) => role.name === "assessor",
    );
    expect(evolvedRole?.sourceAuthority).toBe("source-mutable");
    if (!evolvedRole) throw new Error("evolved assessor role was not parsed");

    const evolvedSource = parseYaml(assessorYaml) as AgentSourceContract;
    evolvedSource.description =
      "Bounded assessment role for classification or evaluation against a closed acceptance condition. Use when a workflow needs a focused source-mutable assessment within dispatch-authorized paths. Do not use for open-ended investigation, implementation, or synthesis review.";
    evolvedSource.instructions =
      "Modify durable content only within the dispatch-authorized task scope. Do not mutate GitHub, Linear, Notion, or any other external system. Do not use network access.";
    expect(agentSourceConformanceFailures(evolvedRole, evolvedSource)).toEqual(
      [],
    );

    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-source-authority-render-"),
    );
    const evolvedAgentsDir = path.join(tempRoot, "agents");
    try {
      await cp(path.join(repoRoot, "agents"), evolvedAgentsDir, {
        recursive: true,
      });
      await writeFile(
        path.join(evolvedAgentsDir, "assessor.yaml"),
        stringifyYaml(evolvedSource),
        "utf-8",
      );
      const evolvedConfig = {
        ...config,
        library: { ...config.library, agentsDir: evolvedAgentsDir },
      };
      const evolved = await renderAll(evolvedConfig, false, true);

      for (const target of ["claude", "codex"] as const) {
        const output = evolved.outputs.find(
          (candidate) =>
            candidate.type === "agent" &&
            candidate.target === target &&
            candidate.name === evolvedRole.name,
        );
        expect(output).toBeDefined();
        if (!output) continue;
        const parsed: ParsedRenderedAgent =
          target === "claude"
            ? (() => {
                const artifact = parseRenderedMarkdownArtifact(output.content);
                return {
                  name: artifact.frontmatter.name,
                  description: artifact.frontmatter.description,
                  model: artifact.frontmatter.model,
                  effort: artifact.frontmatter.effort,
                  instructions: artifact.body,
                };
              })()
            : (() => {
                const artifact = parseRenderedTomlArtifact(output.content);
                return {
                  name: artifact.name,
                  description: artifact.description,
                  model: artifact.model,
                  effort: artifact.model_reasoning_effort,
                  instructions: String(artifact.developer_instructions ?? ""),
                };
              })();
        expect(
          renderedAgentAlignmentFailures(
            evolvedRole,
            evolvedSource,
            target,
            parsed,
            config.capabilityProfiles[evolvedRole.capability][target],
          ),
        ).toEqual([]);
        expect(parsed.description).toBe(evolvedSource.description);
        expect(String(parsed.description)).not.toContain(
          "focused source-immutable decision",
        );
        expect(String(parsed.description)).toContain(
          "focused source-mutable assessment within dispatch-authorized paths",
        );
        expect(normalizeWhitespace(parsed.instructions)).toContain(
          "Modify durable content only within the dispatch-authorized task scope.",
        );
        expect(normalizeWhitespace(parsed.instructions)).not.toContain(
          "Do not modify durable source, tests, configuration, or documentation.",
        );
        expect(
          getSkillOutput(evolved.outputs, "play-agent-dispatch", target)
            .content,
        ).toBe(
          getSkillOutput(baseline.outputs, "play-agent-dispatch", target)
            .content,
        );
      }

      const restored = await renderAll(config, false, true);
      for (const target of ["claude", "codex"] as const) {
        const baselineAgent = baseline.outputs.find(
          (candidate) =>
            candidate.type === "agent" &&
            candidate.target === target &&
            candidate.name === evolvedRole.name,
        );
        const restoredAgent = restored.outputs.find(
          (candidate) =>
            candidate.type === "agent" &&
            candidate.target === target &&
            candidate.name === evolvedRole.name,
        );
        expect(restoredAgent?.content).toBe(baselineAgent?.content);
      }
      await expect(
        readFile(path.join(repoRoot, "docs/specs/agents.md"), "utf-8"),
      ).resolves.toBe(specSource);
      await expect(
        readFile(path.join(repoRoot, "agents/assessor.yaml"), "utf-8"),
      ).resolves.toBe(assessorYaml);
    } finally {
      await cleanupTempDir(tempRoot);
    }
  });

  it("rejects delimiter-independent copied D4 role registries", async () => {
    const repoRoot = process.cwd();
    const [config, owner, roles] = await Promise.all([
      loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
      readAgentRoutingPolicyOwner(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
      readAgentSemanticRoleOwner(),
    ]);
    const { outputs } = await renderAll(config, false, true);

    for (const target of ["claude", "codex"] as const) {
      const producer = getSkillOutput(
        outputs,
        "play-agent-dispatch",
        target,
      ).content;
      const tuple = (role: AgentSemanticRoleContract) => ({
        role: role.name,
        capability: role.capability,
        effort: target === "claude" ? role.claudeEffort : role.codexEffort,
        sourceAuthority: role.sourceAuthority,
      });
      const tuples = roles.map(tuple);
      expect(tuples).toHaveLength(6);
      const positionalCompactPipeRecord = (item: (typeof tuples)[number]) =>
        `${item.role} | ${item.capability} | ${item.effort} | ${item.sourceAuthority}`;
      const positionalCompactPipeFailures = (registry: string): string[] => {
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${registry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:positional-compact-pipe mutation`).not.toBe(
          producer,
        );
        expect(
          markdownHeadingSection(mutated, "### Semantic Route Contract"),
          `${target}:bounded registry insertion`,
        ).toContain(registry);
        return d4ProducerProjectionFailures(owner, roles, mutated, target);
      };
      const ownerNativeColumns = [
        "Agent",
        "Capability",
        "Claude effort",
        "Codex effort",
        "Source default",
      ] as const;
      const ownerNativeTable = (
        items: readonly {
          name: string;
          capability: string;
          claudeEffort: string;
          codexEffort: string;
          sourceAuthority: string;
        }[],
        columns: readonly string[] = ownerNativeColumns,
      ): string => {
        const cell = (role: (typeof items)[number], column: string) => {
          switch (column) {
            case "Agent":
            case "Semantic role":
              return role.name;
            case "Capability":
              return role.capability;
            case "Claude effort":
              return role.claudeEffort;
            case "Codex effort":
              return role.codexEffort;
            case "Source default":
            case "Note":
              return role.sourceAuthority;
            default:
              return "unrelated";
          }
        };
        return [
          `| ${columns.join(" | ")} |`,
          `| ${columns.map(() => "---").join(" | ")} |`,
          ...items.map(
            (role) =>
              `| ${columns.map((column) => cell(role, column)).join(" | ")} |`,
          ),
        ].join("\n");
      };
      const completeOwnerNativeTable = ownerNativeTable(roles);
      expect(completeOwnerNativeTable.split("\n").slice(2)).toHaveLength(6);
      expect(
        positionalCompactPipeFailures(completeOwnerNativeTable),
        `${target}:owner-native complete-six`,
      ).toEqual(["D4:copied-role-registry"]);
      expect(
        positionalCompactPipeFailures(
          ownerNativeTable(roles, [
            "Source default",
            "Codex effort",
            "Agent",
            "Capability",
            "Claude effort",
          ]),
        ),
        `${target}:owner-native reordered complete-six`,
      ).toEqual(["D4:copied-role-registry"]);
      for (const subsetSize of [0, 1, 2, 3, 4, 5]) {
        expect(
          positionalCompactPipeFailures(
            ownerNativeTable(roles.slice(0, subsetSize)),
          ),
          `${target}:owner-native subset-${subsetSize}`,
        ).toEqual([]);
      }
      const sixthOwnerRole = roles[5];
      const ownerNativeControls = {
        wrongSixth: ownerNativeTable([
          ...roles.slice(0, 5),
          { ...sixthOwnerRole, sourceAuthority: "not-the-owned-authority" },
        ]),
        incompleteSixth: ownerNativeTable([
          ...roles.slice(0, 5),
          { ...sixthOwnerRole, sourceAuthority: "" },
        ]),
        fiveDistinctPlusDuplicate: ownerNativeTable([
          ...roles.slice(0, 5),
          roles[0],
        ]),
        otherTargetEffortOnly: ownerNativeTable(roles, [
          "Agent",
          "Capability",
          target === "claude" ? "Codex effort" : "Claude effort",
          "Source default",
        ]),
        missingHeader: ownerNativeTable(roles, [
          "Agent",
          "Capability",
          target === "claude" ? "Claude effort" : "Codex effort",
        ]),
        duplicateRoleHeader: ownerNativeTable(roles, [
          "Agent",
          "Semantic role",
          "Capability",
          target === "claude" ? "Claude effort" : "Codex effort",
          "Source default",
        ]),
        literalDuplicateAgentHeader: ownerNativeTable(roles, [
          "Agent",
          "Agent",
          "Capability",
          target === "claude" ? "Claude effort" : "Codex effort",
          "Source default",
        ]),
        noteMasking: ownerNativeTable(roles, [
          "Agent",
          "Capability",
          target === "claude" ? "Claude effort" : "Codex effort",
          "Note",
        ]),
        distributedRecords: `${ownerNativeTable(roles, ["Agent", "Capability"])}\n\n${ownerNativeTable(roles, [target === "claude" ? "Claude effort" : "Codex effort", "Source default"])}`,
        unrelatedTable: ownerNativeTable(roles, ["Agent", "Result"]),
      };
      for (const [control, registry] of Object.entries(ownerNativeControls)) {
        expect(registry, `${target}:owner-native ${control}`).not.toBe(
          completeOwnerNativeTable,
        );
        expect(
          positionalCompactPipeFailures(registry),
          `${target}:owner-native ${control}`,
        ).toEqual([]);
      }
      expect(
        positionalCompactPipeFailures(ownerNativeTable([...roles, roles[0]])),
        `${target}:owner-native complete-six-plus-duplicate`,
      ).toEqual(["D4:copied-role-registry"]);
      const nonTableOwnerAliasRecords = roles.map((role) => ({
        agent: role.name,
        capability: role.capability,
        effort: target === "claude" ? role.claudeEffort : role.codexEffort,
        sourceDefault: role.sourceAuthority,
      }));
      const nonTableOwnerAliasControls = {
        jsonObjects: nonTableOwnerAliasRecords
          .map(
            (item) =>
              `{"Agent":"${item.agent}","Capability":"${item.capability}","Effort":"${item.effort}","Source default":"${item.sourceDefault}"}`,
          )
          .join("\n"),
        yamlRecords: nonTableOwnerAliasRecords
          .map((item) =>
            [
              `- Agent: ${item.agent}`,
              `  Capability: ${item.capability}`,
              `  Effort: ${item.effort}`,
              `  Source default: ${item.sourceDefault}`,
            ].join("\n"),
          )
          .join("\n"),
        dashOnlyYamlRecords: nonTableOwnerAliasRecords
          .map((item) =>
            [
              "-",
              `  Agent: ${item.agent}`,
              `  Capability: ${item.capability}`,
              `  Effort: ${item.effort}`,
              `  Source default: ${item.sourceDefault}`,
            ].join("\n"),
          )
          .join("\n"),
        labeledBullets: nonTableOwnerAliasRecords
          .map(
            (item) =>
              `- Agent=${item.agent}; Capability=${item.capability}; Effort=${item.effort}; Source default=${item.sourceDefault}`,
          )
          .join("\n"),
        labeledInline: nonTableOwnerAliasRecords
          .map(
            (item) =>
              `Agent=${item.agent}, Capability=${item.capability}, Effort=${item.effort}, Source default=${item.sourceDefault}`,
          )
          .join("\n"),
        labeledCompact: nonTableOwnerAliasRecords
          .map(
            (item) =>
              `Agent=${item.agent}; Capability=${item.capability}; Effort=${item.effort}; Source default=${item.sourceDefault}`,
          )
          .join(" | "),
        arbitraryNotes: nonTableOwnerAliasRecords
          .map(
            (item) =>
              `- note=Agent:${item.agent}; note=Capability:${item.capability}; note=Effort:${item.effort}; note=Source-default:${item.sourceDefault}`,
          )
          .join("\n"),
        distributedRecords: nonTableOwnerAliasRecords
          .map((item) =>
            [
              `- Agent=${item.agent}`,
              `- Capability=${item.capability}`,
              `- Effort=${item.effort}`,
              `- Source default=${item.sourceDefault}`,
            ].join("\n"),
          )
          .join("\n"),
      };
      for (const [control, registry] of Object.entries(
        nonTableOwnerAliasControls,
      )) {
        expect(
          registry,
          `${target}:non-table owner aliases ${control}`,
        ).toContain(roles[0].name);
        expect(
          positionalCompactPipeFailures(registry),
          `${target}:non-table owner aliases ${control}`,
        ).toEqual([]);
      }
      const independentOwnerAliasJsonControls = {
        agentOnly: roles
          .map(
            (role) =>
              `{"Agent":"${role.name}","capability":"${role.capability}","effort":"${target === "claude" ? role.claudeEffort : role.codexEffort}","source_authority":"${role.sourceAuthority}"}`,
          )
          .join("\n"),
        sourceDefaultOnly: roles
          .map(
            (role) =>
              `{"role":"${role.name}","capability":"${role.capability}","effort":"${target === "claude" ? role.claudeEffort : role.codexEffort}","Source default":"${role.sourceAuthority}"}`,
          )
          .join("\n"),
        targetEffortOnly: roles
          .map(
            (role) =>
              `{"role":"${role.name}","capability":"${role.capability}","${target === "claude" ? "Claude effort" : "Codex effort"}":"${target === "claude" ? role.claudeEffort : role.codexEffort}","source_authority":"${role.sourceAuthority}"}`,
          )
          .join("\n"),
      };
      for (const [control, registry] of Object.entries(
        independentOwnerAliasJsonControls,
      )) {
        expect(
          registry,
          `${target}:independent non-table owner alias ${control}`,
        ).toContain(roles[0].name);
        expect(
          positionalCompactPipeFailures(registry),
          `${target}:independent non-table owner alias ${control}`,
        ).toEqual([]);
      }
      const positionalCompactPipeRegistry = tuples
        .map(positionalCompactPipeRecord)
        .join("\n");
      expect(
        positionalCompactPipeRegistry.split("\n"),
        `${target}:positional-compact-pipe complete-six`,
      ).toHaveLength(6);
      expect(positionalCompactPipeRegistry).toContain(" | ");
      expect(
        positionalCompactPipeFailures(positionalCompactPipeRegistry),
        `${target}:positional-compact-pipe complete-six`,
      ).toEqual(["D4:copied-role-registry"]);

      const legacyHeaderTable = (
        items: readonly {
          role: string;
          capability: string;
          effort: string;
          sourceAuthority: string;
        }[],
      ) =>
        [
          "| Semantic role | Capability | Effort | Source mutation default |",
          "| --- | --- | --- | --- |",
          ...items.map(
            (item) =>
              `| ${item.role} | ${item.capability} | ${item.effort} | ${item.sourceAuthority} |`,
          ),
        ].join("\n");
      const completeLegacyHeaderTable = legacyHeaderTable(tuples);
      expect(
        completeLegacyHeaderTable.split("\n").slice(2),
        `${target}:legacy-header complete-six`,
      ).toHaveLength(6);
      expect(
        positionalCompactPipeFailures(completeLegacyHeaderTable),
        `${target}:legacy-header complete-six`,
      ).toEqual(["D4:copied-role-registry"]);
      for (const subsetSize of [0, 1, 2, 3, 4, 5]) {
        expect(
          positionalCompactPipeFailures(
            legacyHeaderTable(tuples.slice(0, subsetSize)),
          ),
          `${target}:legacy-header subset-${subsetSize}`,
        ).toEqual([]);
      }
      const legacySixth = tuples[5];
      const legacyHeaderControls = {
        wrongSixth: legacyHeaderTable([
          ...tuples.slice(0, 5),
          { ...legacySixth, sourceAuthority: "not-the-owned-authority" },
        ]),
        incompleteSixth: [
          "| Semantic role | Capability | Effort | Source mutation default |",
          "| --- | --- | --- | --- |",
          ...tuples
            .slice(0, 5)
            .map(
              (item) =>
                `| ${item.role} | ${item.capability} | ${item.effort} | ${item.sourceAuthority} |`,
            ),
          `| ${legacySixth.role} | ${legacySixth.capability} | ${legacySixth.effort} |`,
        ].join("\n"),
        fiveDistinctPlusDuplicate: legacyHeaderTable([
          ...tuples.slice(0, 5),
          tuples[0],
        ]),
        noteMasking: [
          "| Semantic role | Capability | Effort | Note |",
          "| --- | --- | --- | --- |",
          ...tuples.map(
            (item) =>
              `| ${item.role} | ${item.capability} | ${item.effort} | ${item.sourceAuthority} |`,
          ),
        ].join("\n"),
        distributedRecords: tuples
          .map((item) =>
            [
              `- Semantic role: ${item.role}`,
              `- Capability: ${item.capability}`,
              `- Effort: ${item.effort}`,
              `- Source mutation default: ${item.sourceAuthority}`,
            ].join("\n"),
          )
          .join("\n"),
        unrelatedTable: [
          "| Semantic role | Result |",
          "| --- | --- |",
          ...tuples.map((item) => `| ${item.role} | pass |`),
        ].join("\n"),
      };
      for (const [control, registry] of Object.entries(legacyHeaderControls)) {
        expect(registry, `${target}:legacy-header ${control}`).not.toBe(
          completeLegacyHeaderTable,
        );
        expect(
          positionalCompactPipeFailures(registry),
          `${target}:legacy-header ${control}`,
        ).toEqual([]);
      }
      expect(
        positionalCompactPipeFailures(
          legacyHeaderTable([...tuples, tuples[0]]),
        ),
        `${target}:legacy-header complete-six-plus-duplicate`,
      ).toEqual(["D4:copied-role-registry"]);
      const reorderedLegacyHeaderTable = [
        "| Source mutation default | Capability | Semantic role | Effort |",
        "| --- | --- | --- | --- |",
        ...tuples.map(
          (item) =>
            `| ${item.sourceAuthority} | ${item.capability} | ${item.role} | ${item.effort} |`,
        ),
      ].join("\n");
      expect(
        positionalCompactPipeFailures(reorderedLegacyHeaderTable),
        `${target}:legacy-header reordered-columns`,
      ).toEqual(["D4:copied-role-registry"]);

      for (const subsetSize of [0, 1, 2, 3, 4, 5]) {
        const subsetRegistry = tuples
          .slice(0, subsetSize)
          .map(positionalCompactPipeRecord)
          .join("\n");
        expect(
          positionalCompactPipeFailures(subsetRegistry),
          `${target}:positional-compact-pipe subset-${subsetSize}`,
        ).toEqual([]);
      }

      const sixthTuple = tuples[5];
      const wrongSixthSourceAuthority = "not-the-owned-authority";
      const positionalCompactPipeNearMisses = {
        wrongSixth: [
          ...tuples.slice(0, 5).map(positionalCompactPipeRecord),
          `${sixthTuple.role} | ${sixthTuple.capability} | ${sixthTuple.effort} | ${wrongSixthSourceAuthority}`,
        ].join("\n"),
        incompleteSixth: [
          ...tuples.slice(0, 5).map(positionalCompactPipeRecord),
          `${sixthTuple.role} | ${sixthTuple.capability} | ${sixthTuple.effort}`,
        ].join("\n"),
      };
      for (const [control, registry] of Object.entries(
        positionalCompactPipeNearMisses,
      )) {
        const sixthRecord = registry.split("\n").at(-1);
        expect(
          registry,
          `${target}:positional-compact-pipe ${control}`,
        ).not.toBe(positionalCompactPipeRegistry);
        expect(
          sixthRecord,
          `${target}:positional-compact-pipe ${control}`,
        ).toBe(
          control === "wrongSixth"
            ? `${sixthTuple.role} | ${sixthTuple.capability} | ${sixthTuple.effort} | ${wrongSixthSourceAuthority}`
            : `${sixthTuple.role} | ${sixthTuple.capability} | ${sixthTuple.effort}`,
        );
        expect(
          positionalCompactPipeFailures(registry),
          `${target}:positional-compact-pipe ${control}`,
        ).toEqual([]);
      }

      const fiveDistinctPlusDuplicate = [...tuples.slice(0, 5), tuples[0]];
      expect(fiveDistinctPlusDuplicate).toHaveLength(6);
      expect(
        new Set(fiveDistinctPlusDuplicate.map((item) => item.role)).size,
      ).toBe(5);
      expect(
        positionalCompactPipeFailures(
          fiveDistinctPlusDuplicate.map(positionalCompactPipeRecord).join("\n"),
        ),
        `${target}:positional-compact-pipe five-distinct-plus-duplicate`,
      ).toEqual([]);
      expect(
        positionalCompactPipeFailures(
          [...tuples, tuples[0]].map(positionalCompactPipeRecord).join("\n"),
        ),
        `${target}:positional-compact-pipe complete-six-plus-duplicate`,
      ).toEqual(["D4:copied-role-registry"]);
      const copiedRegistries = {
        table: [
          "| Role | Capability | Effort | Source authority |",
          "| --- | --- | --- | --- |",
          ...tuples.map(
            (item) =>
              `| ${item.role} | ${item.capability} | ${item.effort} | ${item.sourceAuthority} |`,
          ),
        ].join("\n"),
        bullets: tuples
          .map(
            (item) =>
              `- role=${item.role}; capability=${item.capability}; effort=${item.effort}; source authority=${item.sourceAuthority}`,
          )
          .join("\n"),
        inlineYaml: tuples
          .map(
            (item) =>
              `- role: ${item.role} capability: ${item.capability} effort: ${item.effort} source_authority: ${item.sourceAuthority}`,
          )
          .join("\n"),
        multilineYaml: tuples
          .map((item) =>
            [
              `- role: ${item.role}`,
              `  capability: ${item.capability}`,
              `  effort: ${item.effort}`,
              `  source_authority: ${item.sourceAuthority}`,
            ].join("\n"),
          )
          .join("\n"),
        inlineJson: tuples
          .map(
            (item) =>
              `{"role":"${item.role}","capability":"${item.capability}","effort":"${item.effort}","source_authority":"${item.sourceAuthority}"}`,
          )
          .join("\n"),
        prettyJson: tuples
          .map((item) =>
            [
              "{",
              `  "role": "${item.role}",`,
              `  "capability": "${item.capability}",`,
              `  "effort": "${item.effort}",`,
              `  "source_authority": "${item.sourceAuthority}"`,
              "}",
            ].join("\n"),
          )
          .join(",\n"),
        markdownRoleNonLeading: [
          "| Capability | Role | Source authority | Effort |",
          "| --- | --- | --- | --- |",
          ...tuples.map(
            (item) =>
              `| ${item.capability} | ${item.role} | ${item.sourceAuthority} | ${item.effort} |`,
          ),
        ].join("\n"),
        multilineYamlRoleLast: tuples
          .map((item) =>
            [
              `- capability: ${item.capability}`,
              `  effort: ${item.effort}`,
              `  source_authority: ${item.sourceAuthority}`,
              `  role: ${item.role}`,
            ].join("\n"),
          )
          .join("\n"),
        dashOnlyYamlRoleLast: tuples
          .map((item) =>
            [
              "-",
              `  capability: ${item.capability}`,
              `  effort: ${item.effort}`,
              `  source_authority: ${item.sourceAuthority}`,
              `  role: ${item.role}`,
            ].join("\n"),
          )
          .join("\n"),
        prettyJsonRoleLast: tuples
          .map((item) =>
            [
              "{",
              `  "capability": "${item.capability}",`,
              `  "effort": "${item.effort}",`,
              `  "source_authority": "${item.sourceAuthority}",`,
              `  "role": "${item.role}"`,
              "}",
            ].join("\n"),
          )
          .join(",\n"),
        labeledBulletsRoleNonLeading: tuples
          .map(
            (item) =>
              `- capability=${item.capability}; effort=${item.effort}; source_authority=${item.sourceAuthority}; role=${item.role}`,
          )
          .join("\n"),
        inlineRoleNonLeading: tuples
          .map(
            (item) =>
              `capability=${item.capability}, effort=${item.effort}, source_authority=${item.sourceAuthority}, role=${item.role}`,
          )
          .join(" | "),
      };
      for (const format of [
        "markdownRoleNonLeading",
        "multilineYamlRoleLast",
        "dashOnlyYamlRoleLast",
        "prettyJsonRoleLast",
        "labeledBulletsRoleNonLeading",
        "inlineRoleNonLeading",
      ] as const) {
        const registry = copiedRegistries[format];
        const firstRoleIndex = registry.indexOf(tuples[0].role);
        expect(firstRoleIndex, `${target}:${format}:role`).toBeGreaterThan(-1);
        expect(
          registry.indexOf(tuples[0].capability),
          `${target}:${format}:capability-before-role`,
        ).toBeLessThan(firstRoleIndex);
        if (format !== "markdownRoleNonLeading") {
          expect(
            registry.indexOf(tuples[0].effort),
            `${target}:${format}:effort-before-role`,
          ).toBeLessThan(firstRoleIndex);
          expect(
            registry.indexOf(tuples[0].sourceAuthority),
            `${target}:${format}:source-authority-before-role`,
          ).toBeLessThan(firstRoleIndex);
        }
        if (format === "dashOnlyYamlRoleLast") {
          expect(registry, `${target}:${format}:dash-only-item`).toContain(
            "-\n  capability:",
          );
        }
      }
      for (const [format, registry] of Object.entries(copiedRegistries)) {
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${registry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:${format} mutation`).not.toBe(producer);
        expect(
          d4ProducerProjectionFailures(owner, roles, mutated, target),
        ).toEqual(["D4:copied-role-registry"]);
      }

      for (const [control, nearMissRegistry] of Object.entries({
        missingEffort: copiedRegistries.multilineYamlRoleLast.replace(
          `  effort: ${tuples[0].effort}\n`,
          "",
        ),
        changedSourceAuthority: copiedRegistries.prettyJsonRoleLast.replace(
          `  "source_authority": "${tuples[0].sourceAuthority}",`,
          '  "source_authority": "not-the-owned-authority",',
        ),
      })) {
        const validRegistry =
          control === "missingEffort"
            ? copiedRegistries.multilineYamlRoleLast
            : copiedRegistries.prettyJsonRoleLast;
        expect(nearMissRegistry, `${target}:${control} dimension`).not.toBe(
          validRegistry,
        );
        const firstRecord = nearMissRegistry.slice(
          0,
          nearMissRegistry.indexOf(tuples[0].role),
        );
        if (control === "missingEffort") {
          expect(firstRecord, `${target}:${control}`).not.toContain(
            `effort: ${tuples[0].effort}`,
          );
        } else {
          expect(firstRecord, `${target}:${control}`).toContain(
            '"source_authority": "not-the-owned-authority"',
          );
          expect(firstRecord, `${target}:${control}`).not.toContain(
            `"source_authority": "${tuples[0].sourceAuthority}"`,
          );
        }
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${nearMissRegistry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:${control} mutation`).not.toBe(producer);
        const failures = d4ProducerProjectionFailures(
          owner,
          roles,
          mutated,
          target,
        );
        expect(failures, `${target}:${control}`).toEqual([]);
      }

      for (const subsetSize of [0, 1, 2, 3, 4, 5]) {
        const subsetRegistry = tuples
          .slice(0, subsetSize)
          .map(
            (item) =>
              `- role=${item.role}; capability=${item.capability}; effort=${item.effort}; source_authority=${item.sourceAuthority}`,
          )
          .join("\n");
        expect(
          subsetRegistry ? subsetRegistry.split("\n") : [],
          `${target}:subset-${subsetSize}`,
        ).toHaveLength(subsetSize);
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${subsetRegistry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:subset-${subsetSize} mutation`).not.toBe(
          producer,
        );
        expect(
          d4ProducerProjectionFailures(owner, roles, mutated, target),
          `${target}:subset-${subsetSize}`,
        ).toEqual([]);
      }

      const completeSixPlusDuplicate = [...tuples, tuples[0]]
        .map(
          (item) =>
            `- role=${item.role}; capability=${item.capability}; effort=${item.effort}; source_authority=${item.sourceAuthority}`,
        )
        .join("\n");
      const duplicateMutation = producer.replace(
        "### Source-Immutable Specialists",
        `${completeSixPlusDuplicate}\n\n### Source-Immutable Specialists`,
      );
      expect(duplicateMutation).not.toBe(producer);
      expect(
        d4ProducerProjectionFailures(owner, roles, duplicateMutation, target),
      ).toEqual(["D4:copied-role-registry"]);

      const distributedRecordControls = {
        splitJsonObjectsOnOneLine: tuples
          .map(
            (item) =>
              `{"role":"${item.role}"} {"capability":"${item.capability}","effort":"${item.effort}","source_authority":"${item.sourceAuthority}"}`,
          )
          .join("\n"),
        adjacentMixedRecords: tuples
          .map((item) =>
            [
              `- role: ${item.role}`,
              `- capability: ${item.capability}`,
              `{"effort":"${item.effort}"}`,
              "| Field | Value |",
              "| --- | --- |",
              `| source_authority | ${item.sourceAuthority} |`,
            ].join("\n"),
          )
          .join("\n"),
      };
      expect(
        distributedRecordControls.splitJsonObjectsOnOneLine
          .split("\n")[0]
          .match(/\{/g),
        `${target}:split-json-objects`,
      ).toHaveLength(2);
      expect(distributedRecordControls.adjacentMixedRecords).toContain(
        `- role: ${tuples[0].role}\n- capability: ${tuples[0].capability}`,
      );
      for (const [control, distributedRegistry] of Object.entries(
        distributedRecordControls,
      )) {
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${distributedRegistry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:${control} mutation`).not.toBe(producer);
        expect(
          d4ProducerProjectionFailures(owner, roles, mutated, target),
          `${target}:${control}`,
        ).toEqual([]);
      }

      const unrelatedTable = producer.replace(
        "### Source-Immutable Specialists",
        "| Domain | Result |\n| --- | --- |\n| formatting | pass |\n\n### Source-Immutable Specialists",
      );
      expect(unrelatedTable).not.toBe(producer);
      expect(
        d4ProducerProjectionFailures(owner, roles, unrelatedTable, target),
      ).toEqual([]);

      const fieldBindingControls = {
        noteTokenMasking: tuples
          .map(
            (item) =>
              `- note=${item.role}; note=${item.capability}; note=${item.effort}; note=${item.sourceAuthority}`,
          )
          .join("\n"),
        swappedLabeledValues: tuples
          .map(
            (item) =>
              `- role=${item.capability}; capability=${item.role}; effort=${item.sourceAuthority}; source_authority=${item.effort}`,
          )
          .join("\n"),
        unlabeledVocabulary: tuples
          .map(
            (item) =>
              `- ${item.role}; ${item.capability}; ${item.effort}; ${item.sourceAuthority}`,
          )
          .join("\n"),
        duplicateRoleLabel: tuples
          .map(
            (item) =>
              `- role=${item.role}; role=ambiguous; capability=${item.capability}; effort=${item.effort}; source_authority=${item.sourceAuthority}`,
          )
          .join("\n"),
      };
      for (const [control, registry] of Object.entries(fieldBindingControls)) {
        expect(registry, `${target}:${control}:registry`).toContain(
          tuples[0].role,
        );
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${registry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:${control}:mutation`).not.toBe(producer);
        expect(
          d4ProducerProjectionFailures(owner, roles, mutated, target),
          `${target}:${control}`,
        ).toEqual([]);
      }
    }
  });

  it("keeps copied registry efforts target-native under owner-derived divergence", async () => {
    const repoRoot = process.cwd();
    const [config, owner, roles] = await Promise.all([
      loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
      readAgentRoutingPolicyOwner(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
      readAgentSemanticRoleOwner(),
    ]);
    const selectedRole = roles[0];
    const alternateEffortRole = roles.find(
      (role) => role.codexEffort !== selectedRole.claudeEffort,
    );
    expect(alternateEffortRole).toBeDefined();
    if (!alternateEffortRole) return;
    const divergentRoles = roles.map((role) =>
      role.name === selectedRole.name
        ? { ...role, codexEffort: alternateEffortRole.codexEffort }
        : role,
    );
    const divergentSelectedRole = divergentRoles[0];
    expect(divergentSelectedRole.claudeEffort).not.toBe(
      divergentSelectedRole.codexEffort,
    );
    expect({
      ...divergentSelectedRole,
      codexEffort: selectedRole.codexEffort,
    }).toEqual(selectedRole);
    expect(
      divergentRoles.filter((role, index) => role !== roles[index]),
    ).toEqual([divergentSelectedRole]);

    const registryFor = (target: "claude" | "codex"): string =>
      divergentRoles
        .map(
          (role) =>
            `- role=${role.name}; capability=${role.capability}; effort=${target === "claude" ? role.claudeEffort : role.codexEffort}; source_authority=${role.sourceAuthority}`,
        )
        .join("\n");
    const ownerNativeRegistryFor = (
      target: "claude" | "codex",
      useOtherTargetEffort: boolean,
    ): string =>
      [
        "| Agent | Capability | Claude effort | Codex effort | Source default |",
        "| --- | --- | --- | --- | --- |",
        ...divergentRoles.map((role) => {
          const claudeEffort =
            target === "claude" && useOtherTargetEffort
              ? role.codexEffort
              : role.claudeEffort;
          const codexEffort =
            target === "codex" && useOtherTargetEffort
              ? role.claudeEffort
              : role.codexEffort;
          return `| ${role.name} | ${role.capability} | ${claudeEffort} | ${codexEffort} | ${role.sourceAuthority} |`;
        }),
      ].join("\n");
    const { outputs } = await renderAll(config, false, true);

    for (const target of ["claude", "codex"] as const) {
      const otherTarget = target === "claude" ? "codex" : "claude";
      const correctRegistry = registryFor(target);
      const otherTargetRegistry = registryFor(otherTarget);
      expect(otherTargetRegistry, `${target}:effort divergence`).not.toBe(
        correctRegistry,
      );
      const producer = getSkillOutput(
        outputs,
        "play-agent-dispatch",
        target,
      ).content;
      const failures = (registry: string): string[] => {
        const mutated = producer.replace(
          "### Source-Immutable Specialists",
          `${registry}\n\n### Source-Immutable Specialists`,
        );
        expect(mutated, `${target}:registry mutation`).not.toBe(producer);
        return d4ProducerProjectionFailures(
          owner,
          divergentRoles,
          mutated,
          target,
        );
      };

      expect(failures(correctRegistry), `${target}:correct effort`).toEqual([
        "D4:copied-role-registry",
      ]);
      expect(failures(otherTargetRegistry), `${target}:other effort`).toEqual(
        [],
      );
      const correctOwnerNativeRegistry = ownerNativeRegistryFor(target, false);
      const otherEffortOwnerNativeRegistry = ownerNativeRegistryFor(
        target,
        true,
      );
      expect(
        otherEffortOwnerNativeRegistry,
        `${target}:owner-native effort divergence`,
      ).not.toBe(correctOwnerNativeRegistry);
      expect(
        failures(correctOwnerNativeRegistry),
        `${target}:owner-native correct effort`,
      ).toEqual(["D4:copied-role-registry"]);
      expect(
        failures(otherEffortOwnerNativeRegistry),
        `${target}:owner-native other effort`,
      ).toEqual([]);
    }
  });

  it("rejects bounded route evidence and qualifier drift", async () => {
    const repoRoot = process.cwd();
    const [config, owner] = await Promise.all([
      loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
      readAgentRoutingPolicyOwner(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
    ]);
    const { outputs } = await renderAll(config, false, true);
    const rendered = new Map(
      outputs
        .filter(
          (output) => output.type === "skill" && output.target === "codex",
        )
        .map((output) => [output.name, output.content]),
    );
    const mutate = (
      skill: string,
      from: string | RegExp,
      to: string,
    ): Map<string, string> =>
      new Map(rendered).set(
        skill,
        (rendered.get(skill) ?? "").replace(from, to),
      );
    const failures = (mutated: ReadonlyMap<string, string>): string[] =>
      renderedRouteEvidenceFailures(owner, mutated);

    expect(
      failures(
        mutate(
          "issue-priming-workflow",
          "`assessor`, balanced/medium and source-immutable",
          "`assessor`",
        ),
      ),
    ).toContain("D1");
    expect(
      failures(
        mutate(
          "issue-priming-workflow",
          /no network access\.\s+External research also receives\s+external authority `none`, but the dispatch explicitly grants\s+named network access/,
          "no network access and named network access. External research also receives external authority `none`, but the dispatch explicitly grants",
        ),
      ),
    ).toContain("D3");
    expect(
      failures(
        mutate(
          "issue-priming-workflow",
          /Internal research receives external\s+authority `none` and no network access\./,
          "Internal research receives external authority `none` and no network access but has named network access.",
        ),
      ),
    ).toContain("D2");
    expect(
      failures(mutate("play-review", /^\| D8 .*$/m, "")).includes("D8"),
    ).toBe(true);
    expect(
      failures(
        mutate(
          "play-subagent-execution",
          /D15 is a separate response-only[\s\S]*?with zero handoffs\./,
          "",
        ),
      ),
    ).toContain("D15");
  });

  it("renders the touched skills with Codex-valid frontmatter", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const codexOutputs = outputs.filter(
      (output) =>
        output.type === "skill" &&
        output.target === "codex" &&
        TOUCHED_SKILLS.has(output.name),
    );

    expect(codexOutputs).toHaveLength(TOUCHED_SKILLS.size);

    for (const output of codexOutputs) {
      const { frontmatter, body } = parseFrontmatter(output.content);

      expect(frontmatter.name).toBe(output.name);
      expect(frontmatter.description).toEqual(expect.any(String));
      expect(frontmatter).not.toHaveProperty("model");
      expect(frontmatter).not.toHaveProperty("effort");
      expect(body).not.toContain("{{model:");

      for (const key of Object.keys(frontmatter)) {
        expect(CODEX_ALLOWED_FRONTMATTER_KEYS.has(key)).toBe(true);
      }
    }
  });

  it("renders play-branch-finish adapter guardrails for both targets", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);

    for (const target of ["claude", "codex"] as const) {
      const output = getSkillOutput(outputs, "play-branch-finish", target);
      const normalized = normalizeWhitespace(output.content);

      expect(normalized).toContain(
        "`branch-review` remains owned outside this skill",
      );
      expect(normalized).toContain("Option 2 does not invoke `branch-review`");
      expect(normalized).toContain(
        "does not invoke `branch-review`, produce branch-review artifacts, judge branch-review findings, or decide review completeness",
      );
      expect(normalized).toContain(
        "validates caller-supplied `approval_summary_file` evidence only through the explicit `branch_review_required=true` gate",
      );
      expect(normalized).toContain(
        "delegates approval-summary interpretation to `play-validate-review-artifacts`",
      );
      expect(normalized).toContain(
        "validates the caller-supplied `nits_file` separately as a PR review comment posting input",
      );
      expect(normalized).toContain("No filtering inside this skill");

      for (const staleFinishOwnedNitPattern of [
        /\b(?:play-branch-finish|finish|option\s+2|this skill)\b[^.]*\b(?:fix(?:es)?|commit(?:s)?|auto-fix(?:es)?|classif(?:y|ies|ication)|handling)\b[^.]*\bmechanical(?:-|\s+)nits?\b/i,
        /\bmechanical(?:-|\s+)nit(?:s)?\s+(?:commit|commits|fix|fixes|auto-fix|auto-fixes|handling)\b/i,
        /\bdo\s+not\s+pass\s+mechanical(?:-|\s+)nits?\s+to\s+`?play-branch-finish`?\b/i,
      ] as const) {
        expect(normalized).not.toMatch(staleFinishOwnedNitPattern);
      }
    }
  });

  it("keeps explicit metadata expectations covered by touched-skill reasons", () => {
    const metadataExpectationSkills = getMetadataExpectationSkills();
    const uncoveredMetadataSkills = [...metadataExpectationSkills].filter(
      (skillName) => !TOUCHED_SKILLS.has(skillName),
    );

    expect(uncoveredMetadataSkills).toEqual([]);

    for (const skillName of TOUCHED_SKILL_NAMES) {
      expect(TOUCHED_SKILL_COVERAGE[skillName]).toEqual(expect.any(String));
      expect(TOUCHED_SKILL_COVERAGE[skillName].length).toBeGreaterThan(0);
    }
  });

  it("renders shipped per-target metadata for the priming and review skills", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    for (const skillName of SKILLS_WITH_METADATA.codexFrontmatter) {
      const codexOutput = getSkillOutput(outputs, skillName, "codex");
      const { frontmatter: codexFrontmatter, body: codexBody } =
        parseFrontmatter(codexOutput.content);

      expect(codexFrontmatter).toMatchObject({
        license: "MIT",
        metadata: {
          "short-description": expect.any(String),
        },
      });
      expect(codexBody).not.toContain("{{model:");
      expect(codexFrontmatter).toMatchSnapshot(
        `${skillName}-codex-frontmatter`,
      );
    }

    for (const skillName of SKILLS_WITH_METADATA.claudeFrontmatter) {
      const claudeOutput = getSkillOutput(outputs, skillName, "claude");
      const { frontmatter: claudeFrontmatter, body: claudeBody } =
        parseFrontmatter(claudeOutput.content);

      expect(claudeFrontmatter).toMatchObject({
        model: "claude-opus-4-8",
      });
      expect(claudeBody).not.toContain("{{model:");
      expect(claudeFrontmatter).toMatchSnapshot(
        `${skillName}-claude-frontmatter`,
      );
    }

    for (const skillName of SKILLS_WITH_METADATA.sidecar) {
      const sidecarPath = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        skillName,
        "agents",
        "openai.yaml",
      );

      expect(await pathExists(sidecarPath)).toBe(true);

      const sidecar = await readFile(sidecarPath, "utf-8");
      const parsed = parseYaml(sidecar) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        interface: {
          display_name: expect.any(String),
          short_description: expect.any(String),
          brand_color: expect.any(String),
        },
      });
      expect(parsed).toMatchSnapshot(`${skillName}-sidecar`);
    }

    for (const skillName of SKILLS_WITH_METADATA.policySidecar) {
      const sidecarPath = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        skillName,
        "agents",
        "openai.yaml",
      );

      expect(await pathExists(sidecarPath)).toBe(true);

      const sidecar = await readFile(sidecarPath, "utf-8");
      const parsed = parseYaml(sidecar) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        interface: {
          display_name: expect.stringContaining(" (devcanon)"),
        },
        policy: { allow_implicit_invocation: false },
      });
      expect(parsed).toMatchSnapshot(`${skillName}-sidecar`);
    }
  });

  it("renders public play workflows as explicit-invocation-only", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    for (const skillName of PUBLIC_EXPLICIT_PLAY_SKILLS) {
      const claudeOutput = getSkillOutput(outputs, skillName, "claude");
      const { frontmatter: claudeFrontmatter } = parseFrontmatter(
        claudeOutput.content,
      );

      expect(claudeFrontmatter).not.toHaveProperty("disable-model-invocation");
      expect(claudeFrontmatter.description).toContain("Use only when");
      expect(claudeFrontmatter.description).toContain(skillName);

      const sidecarPath = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        skillName,
        "agents",
        "openai.yaml",
      );

      expect(await pathExists(sidecarPath)).toBe(true);

      const sidecar = await readFile(sidecarPath, "utf-8");
      const parsed = parseYaml(sidecar) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        policy: { allow_implicit_invocation: false },
      });
    }
  });

  it("renders DevCanon issue reporting with the renamed skill and DevCanon target", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    for (const target of ["claude", "codex"] as const) {
      const output = getSkillOutput(outputs, "report-devcanon-issue", target);

      expect(output.content).toContain("name: report-devcanon-issue");
      expect(output.content).toContain("ryumiel/devcanon");
      expect(output.content).not.toContain("ryumiel/agent-manager");
    }

    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "codex",
          "skills",
          "report-devcanon-shared-issue",
        ),
      ),
    ).toBe(false);
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          "report-devcanon-shared-issue",
        ),
      ),
    ).toBe(false);
  });

  it("renders play-subagent implementer prompts with conditional snapshot behavior", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    const promptReferences = ["implementer-prompt.md", "executor-prompt.md"];

    for (const target of ["claude", "codex"] as const) {
      const output = getSkillOutput(outputs, "play-subagent-execution", target);
      expect(output.content).toContain("references/snapshot-consumption.md");

      const skillRoot = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "play-subagent-execution",
      );

      const recipePath = path.join(
        skillRoot,
        "references",
        "snapshot-manifest-recipe.md",
      );
      const helperPath = path.join(
        skillRoot,
        "scripts",
        "write-snapshot-manifest.sh",
      );

      expect(await pathExists(recipePath)).toBe(true);
      expect(await readFile(recipePath, "utf-8")).toContain(
        "implementer/snapshot/v1",
      );
      const snapshotConsumptionPath = path.join(
        skillRoot,
        "references",
        "snapshot-consumption.md",
      );
      const snapshotConsumption = await readFile(
        snapshotConsumptionPath,
        "utf-8",
      );
      expect(snapshotConsumption).toContain("Controller skipped the snapshot");
      expect(snapshotConsumption).toContain(
        "Requested snapshot notice line is absent from DONE/DONE_WITH_CONCERNS",
      );
      expect(snapshotConsumption).toContain(
        "Record snapshot state as `malformed`; surface the requested-snapshot contract violation",
      );
      expect(await pathExists(helperPath)).toBe(true);
      expect(await readFile(helperPath, "utf-8")).toContain(
        "Snapshot written to",
      );

      for (const promptReference of promptReferences) {
        const promptPath = path.join(skillRoot, "references", promptReference);
        const prompt = await readFile(promptPath, "utf-8");
        const normalizedPrompt = prompt.replace(/\s+/g, " ");

        expect(prompt).toContain(
          "Snapshot request: <SNAPSHOT_REQUEST_STATE: requested|skipped>",
        );
        expect(prompt).toContain(
          "Only write a side-channel snapshot manifest when the",
        );
        expect(prompt).toContain("snapshot request state is `requested`.");
        expect(prompt).toContain(
          "If the snapshot request state is `skipped`, do not append any snapshot notice",
        );
        expect(normalizedPrompt).toContain(
          "default fields: status, summary, tests, files changed, base SHA, head SHA.",
        );
        expect(normalizedPrompt).toContain(
          "If the helper exits nonzero, report BLOCKED instead of emitting the notice",
        );
        expect(prompt).toContain("Snapshot written to <repo-relative-path>.");
        expect(normalizedPrompt).not.toContain(
          "After committing and self-reviewing, write the side-channel snapshot manifest before reporting",
        );
      }
    }
  });

  it("mirrors bundled references and scripts to both targets", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    await renderAll(config, true);

    const expectedReferences = [
      "routing-and-evidence.md",
      "pre-slicing-procedure-map.md",
    ];

    for (const reference of expectedReferences) {
      const sourcePath = path.join(
        repoRoot,
        "skills/spec-readiness-review/references",
        reference,
      );
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "spec-readiness-review",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }

    const playSubagentReferencesRoot = path.join(
      repoRoot,
      "skills/play-subagent-execution/references",
    );
    const playSubagentReferenceFiles = await listRelativeFiles(
      playSubagentReferencesRoot,
    );

    for (const reference of playSubagentReferenceFiles) {
      const sourcePath = path.join(playSubagentReferencesRoot, reference);
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "play-subagent-execution",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        const generatedContent = await readFile(generatedPath, "utf-8");
        expect(generatedContent).toBe(sourceContent);
      }
    }

    const tierAwarePromptReferences = [
      "implementer-prompt.md",
      "executor-prompt.md",
      "spec-reviewer-prompt.md",
    ];
    const tierSemantics = [
      "literal declared `Contract tier` plus its tier-appropriate structure",
      "consume the declared tier and never reclassify it",
      "`FULL` requires the complete checklist vocabulary",
      "`LIGHTWEIGHT` does not require intentionally absent FULL-only fields or `N/A` entries",
      "`NO-TRIGGER` requires the literal tier, a task-specific reason, ordinary task fields, acceptance, and minimum proof without a checklist",
      "Missing, malformed, or unsupported tier",
      "omitted actual known participant or direct producer-consumer relationship",
      "independently triggered material obligation",
      "changing only that example's tier to missing or unsupported must fail closed",
      "removing one known direct consumer must remain blocking",
    ];

    for (const reference of tierAwarePromptReferences) {
      const sourcePath = path.join(playSubagentReferencesRoot, reference);
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "play-subagent-execution",
          "references",
          reference,
        );
        const generatedContent = await readFile(generatedPath, "utf-8");
        expect(generatedContent).toBe(sourceContent);

        const normalizedGenerated = normalizeWhitespace(generatedContent);
        for (const semantic of tierSemantics) {
          expect(normalizedGenerated).toContain(semantic);
        }
        expect(normalizedGenerated).not.toContain(
          "task-local checklist/no-trigger status",
        );
      }
    }

    const playPlanningReferencesRoot = path.join(
      repoRoot,
      "skills/play-planning/references",
    );
    const playPlanningReferenceFiles = await listRelativeFiles(
      playPlanningReferencesRoot,
    );

    for (const reference of playPlanningReferenceFiles) {
      const sourcePath = path.join(playPlanningReferencesRoot, reference);
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "play-planning",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }

    for (const script of [
      "write-snapshot-manifest.sh",
      "validate-snapshot-manifest.sh",
    ]) {
      const sourcePath = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts",
        script,
      );
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "play-subagent-execution",
          "scripts",
          script,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }

    const skillEntries = await readdir(path.join(repoRoot, "skills"), {
      withFileTypes: true,
    });
    const skillDirs = skillEntries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);

    for (const skillName of skillDirs) {
      const sourceScriptsRoot = path.join(
        repoRoot,
        "skills",
        skillName,
        "scripts",
      );
      if (!(await pathExists(sourceScriptsRoot))) continue;

      const scriptFiles = await listRelativeFiles(sourceScriptsRoot);
      for (const scriptFile of scriptFiles) {
        const sourcePath = path.join(sourceScriptsRoot, scriptFile);
        const sourceContent = await readFile(sourcePath, "utf-8");

        for (const target of ["claude", "codex"] as const) {
          const generatedPath = path.join(
            config.library.generatedDir,
            target,
            "skills",
            skillName,
            "scripts",
            scriptFile,
          );

          expect(await pathExists(generatedPath)).toBe(true);
          expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
        }
      }
    }

    const sourcePath = path.join(
      repoRoot,
      "skills/write-product-spec/references/behavior-spec-evidence-routing.md",
    );
    const sourceContent = await readFile(sourcePath, "utf-8");

    for (const target of ["claude", "codex"] as const) {
      const generatedPath = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "write-product-spec",
        "references",
        "behavior-spec-evidence-routing.md",
      );

      expect(await pathExists(generatedPath)).toBe(true);
      expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
    }

    const projectUpdateTemplateSourcePath = path.join(
      repoRoot,
      "skills/write-linear-project-update/references/update-template.md",
    );
    const projectUpdateTemplateSourceContent = await readFile(
      projectUpdateTemplateSourcePath,
      "utf-8",
    );

    for (const target of ["claude", "codex"] as const) {
      const generatedPath = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "write-linear-project-update",
        "references",
        "update-template.md",
      );

      expect(await pathExists(generatedPath)).toBe(true);
      expect(await readFile(generatedPath, "utf-8")).toBe(
        projectUpdateTemplateSourceContent,
      );
    }

    const issuePrimingReferencesRoot = path.join(
      repoRoot,
      "skills/issue-priming-workflow/references",
    );
    const issuePrimingReferenceFiles = await listRelativeFiles(
      issuePrimingReferencesRoot,
    );
    for (const reference of issuePrimingReferenceFiles) {
      const sourcePath = path.join(issuePrimingReferencesRoot, reference);
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "issue-priming-workflow",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }
  });
});
