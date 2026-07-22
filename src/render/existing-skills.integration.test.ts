import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  type AgentRoutingDirectChildRouteRow,
  type AgentRoutingRouteClause,
  type AgentSemanticRoleContract,
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
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

function routeClausesForTarget(
  route: AgentRoutingDirectChildRouteRow,
  roles: readonly AgentSemanticRoleContract[],
  target: "claude" | "codex",
): readonly AgentRoutingRouteClause[] {
  return route.id === "D4"
    ? roles.map((role) => ({
        role: role.name,
        capability: role.capability,
        effort: target === "claude" ? role.claudeEffort : role.codexEffort,
        sourceAuthority:
          role.sourceAuthority as AgentRoutingRouteClause["sourceAuthority"],
      }))
    : route.clauses;
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

function renderedRouteEvidenceFailures(
  owner: RoutingOwner,
  roles: readonly AgentSemanticRoleContract[],
  renderedBySkill: ReadonlyMap<string, string>,
  target: "claude" | "codex",
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
      const clauses = routeClausesForTarget(route, roles, target);
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
          JSON.stringify(routeClausesForTarget(peer, roles, target)) ===
            JSON.stringify(clauses),
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

function renderedAgentAligned(
  role: AgentSemanticRoleContract,
  source: AgentSourceContract,
  target: "claude" | "codex",
  parsed: ParsedRenderedAgent,
  expectedModel: string,
): boolean {
  const expectedEffort =
    target === "claude" ? role.claudeEffort : role.codexEffort;
  const expected: Record<string, unknown> = {
    name: role.name,
    description: source.description,
    model: expectedModel,
    effort: expectedEffort,
  };
  const normalizedInstructions = normalizeWhitespace(parsed.instructions);
  return (
    Object.entries(expected).every(
      ([field, value]) => parsed[field as keyof ParsedRenderedAgent] === value,
    ) &&
    normalizedInstructions.includes(normalizeWhitespace(source.instructions)) &&
    role.externalAuthority === "none" &&
    normalizedInstructions.includes(
      "Do not mutate GitHub, Linear, Notion, or any other external system.",
    ) &&
    (role.sourceAuthority !== "source-immutable" ||
      normalizedInstructions.includes(
        "Do not modify durable source, tests, configuration, or documentation.",
      ))
  );
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
    const [config, owner, roles, sources] = await Promise.all([
      loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
      readAgentRoutingPolicyOwner(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
      readAgentSemanticRoleOwner(),
      readAgentSources(),
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
      expect(
        renderedRouteEvidenceFailures(owner, roles, renderedBySkill, target),
      ).toEqual([]);
      const renderedDispatch = normalizeWhitespace(
        renderedBySkill.get("play-agent-dispatch") ?? "",
      );
      expect(renderedDispatch).toContain("complete D4 pre-spawn declaration");
      expect(renderedDispatch).toContain(
        "target-local literal `claude.model` or `codex.model`",
      );
      expect(renderedDispatch).toContain(
        "exact target/capability resolution in `devcanon.config.yaml` only as fallback",
      );
      expect(renderedDispatch).toContain(
        "selected source capability to match the selected semantic role",
      );
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
          renderedAgentAligned(role, source, target, parsed, expectedModel),
        ).toBe(true);
        if (target === "codex" && role === roles[0]) {
          expect(
            renderedAgentAligned(
              role,
              source,
              target,
              { ...parsed, effort: "mutated-effort" },
              expectedModel,
            ),
          ).toBe(false);
        }
      }
    }
  });

  it("rejects bounded route evidence and qualifier drift", async () => {
    const repoRoot = process.cwd();
    const [config, owner, roles] = await Promise.all([
      loadConfig(path.join(repoRoot, "devcanon.config.yaml")),
      readAgentRoutingPolicyOwner(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
      readAgentSemanticRoleOwner(),
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
      renderedRouteEvidenceFailures(owner, roles, mutated, "codex");

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
