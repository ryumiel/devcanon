import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  readRepoFile,
} from "../__test-helpers__/skill-contracts.js";

const projectionFields = [
  "Entry ID",
  "Affected surface or equivalent set",
  "Owner/source",
  "Mode",
  "Implementation disposition",
  "Proof",
] as const;

const recordReferenceFields = [
  "Boundary rows",
  "Supporting-owner supplements",
] as const;

const lightweightDimensions = [
  "exactly one behavioral owner",
  "no public schema or API",
  "no security-sensitive or untrusted boundary",
  "no external mutation",
  "outputs and side effects are bounded and recoverable",
] as const;

function numberedFieldLabels(section: string): string[] {
  return [...section.matchAll(/^\d+\. `([^`]+)`:/gm)].map((match) => match[1]);
}

function canonicalReferenceBlock(markdown: string): string {
  const block = [...markdown.matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)]
    .map((match) => match[1])
    .find((candidate) =>
      recordReferenceFields.every((field) =>
        candidate.includes(`**${field}:**`),
      ),
    );

  if (!block) {
    throw new Error("canonical record-reference block not found");
  }
  return block;
}

function canonicalTaskFieldCounts(markdown: string): Record<string, number> {
  return Object.fromEntries(
    recordReferenceFields.map((field) => [
      field,
      [...markdown.matchAll(new RegExp(`^\\*\\*${field}:\\*\\*`, "gm"))].length,
    ]),
  );
}

function normalizedProse(markdown: string): string {
  return markdown.replace(/\s+/g, " ").trim();
}

describe("play-planning execution projection contract", () => {
  it("keeps one exact six-field projection structure", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const projection = getMarkdownSection(
      criteria,
      "Contract and traceability criteria",
    );

    expect(numberedFieldLabels(projection)).toEqual(projectionFields);
  });

  it("rejects drift in the source-owned projection field structure", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const projection = getMarkdownSection(
      criteria,
      "Contract and traceability criteria",
    );
    const missingAuthority = projection.replace(
      "3. `Owner/source`:",
      "3. `Reference`:",
    );

    expect(numberedFieldLabels(missingAuthority)).not.toEqual(projectionFields);
  });

  it("keeps one of each record-reference field in canonical task blocks", async () => {
    const [skill, criteria, execution] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of [skill, criteria, execution]) {
      const block = canonicalReferenceBlock(source);
      expect(canonicalTaskFieldCounts(block)).toEqual({
        "Boundary rows": 1,
        "Supporting-owner supplements": 1,
      });

      const missing = block.replace(/^\*\*Boundary rows:\*\*.*\r?\n/m, "");
      expect(canonicalTaskFieldCounts(missing)["Boundary rows"]).toBe(0);

      const duplicated = `${block}\n**Supporting-owner supplements:** []`;
      expect(
        canonicalTaskFieldCounts(duplicated)["Supporting-owner supplements"],
      ).toBe(2);
    }
  });

  it("keeps reference-field ordering non-semantic across planning owners", async () => {
    const [skill, criteria] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
    ]);

    for (const source of [skill, criteria]) {
      const block = canonicalReferenceBlock(source);
      const reversed = block.split(/\r?\n/).reverse().join("\n");
      expect(canonicalTaskFieldCounts(reversed)).toEqual(
        canonicalTaskFieldCounts(block),
      );
    }
  });

  it("removes repeated prose selectors from planning and execution contracts", async () => {
    const sources = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of sources) {
      expect(source).not.toContain("supporting-owner supplement <Entry ID>");
      expect(source).not.toContain("boundary row <stable row ID>");
    }
  });

  it("owns the closed behavioral LIGHTWEIGHT test and one-dimensional examples", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const section = getMarkdownSection(
      criteria,
      "Proportional contract planning",
    );
    const prose = normalizedProse(section);

    for (const dimension of lightweightDimensions) {
      expect(prose).toContain(dimension);
    }

    expect(prose).toContain("Persistence or filesystem effects alone");
    expect(prose).toContain("Invalid behavioral-owner mutation");
    expect(prose).toContain("Invalid public-contract mutation");
    expect(prose).toContain("Invalid trust-boundary mutation");
    expect(prose).toContain("Invalid external-mutation mutation");
    expect(prose).toContain("Invalid recovery mutation");
  });

  it("keeps upstream design facts aligned without moving tier authority", async () => {
    const brainstorm = normalizedProse(
      getMarkdownSection(
        await readRepoFile("skills/play-brainstorm/SKILL.md"),
        "Contract Decisions",
      ),
    );

    for (const dimension of lightweightDimensions) {
      expect(brainstorm).toContain(dimension);
    }
    expect(brainstorm).toContain("outside the authorized worktree");
    expect(brainstorm).toContain("planning handoff");
    expect(brainstorm).not.toContain(
      "private, transient, same-controller, and have no durable schema consumer",
    );
  });

  it("distinguishes authorized local filesystem output from external mutation", async () => {
    const [planningSkill, criteria, checklist, brainstorm] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("docs/guidelines/documentation-checklists.md"),
      readRepoFile("skills/play-brainstorm/SKILL.md"),
    ]);

    const criteriaProse = normalizedProse(
      getMarkdownSection(criteria, "Proportional contract planning"),
    );
    expect(criteriaProse).toContain("outside the authorized worktree state");
    expect(criteriaProse).toContain("bounded and recoverable");
    const allCriteriaProse = normalizedProse(criteria);
    expect(allCriteriaProse).toContain("mutation-authority");
    expect(allCriteriaProse).toContain("SIDE-EFFECT");
    expect(allCriteriaProse).toContain("recovery");
    expect(allCriteriaProse).toContain("cleanup");

    const checklistProse = normalizedProse(
      getMarkdownSection(checklist, "Side-Channel Artifact Contract Checklist"),
    );
    expect(checklistProse).toContain("outside the authorized worktree state");
    expect(checklistProse).toContain("fifth dimension");
    expect(checklistProse).toContain("mutation-authority");
    expect(checklistProse).toContain("SIDE-EFFECT");

    const brainstormProse = normalizedProse(
      getMarkdownSection(brainstorm, "Contract Decisions"),
    );
    expect(brainstormProse).toContain("outside the authorized worktree state");
    expect(brainstormProse).toContain("planning handoff");

    const templateProse = normalizedProse(
      getMarkdownSection(planningSkill, "Task Structure"),
    );
    expect(templateProse).toContain("material write or side-effect owner");
    expect(templateProse).toContain("failure and cleanup behavior");
    expect(templateProse).toContain("focused verification expectations");
    expect(templateProse).toContain("five behavioral eligibility dimensions");
    expect(templateProse).not.toContain("or side-effect owner, permission,");
  });

  it("keeps boundary-owned facts single-carrier and representation differences non-blocking", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const prose = normalizedProse(criteria);

    expect(prose).toContain("Valid boundary-carried context");
    expect(prose).toContain("Invalid missing-participant mutation");
    expect(prose).toContain("Invalid missing-authority mutation");
    expect(prose).toContain("Invalid missing-task-membership mutation");
    expect(prose).toContain("Invalid missing-proof mutation");
    expect(prose).toContain("Valid representation-only mutation");
    expect(prose).toContain("Boundary-row IDs are kind-scoped");
    expect(prose).toContain("supporting-owner supplement is keyed");
    expect(prose).toContain("existing Entry ID form");
    expect(prose).toContain("do not define a Markdown or record-body grammar");
  });

  it("keeps kind-scoped resolution controller-owned and fail-closed", async () => {
    const [planning, criteria, execution] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);
    const prose = normalizedProse(execution);

    expect(canonicalReferenceBlock(criteria)).toContain(
      '**Supporting-owner supplements:** ["EP-SUPPORTING-OWNERS"]',
    );
    for (const source of [planning, criteria, execution]) {
      const normalized = normalizedProse(source);
      expect(normalized).toContain("governing projection Entry ID");
      expect(normalized).toContain("existing Entry ID form");
    }
    expect(prose).toContain("declared record kind");
    expect(prose).toContain(
      "Unknown, duplicate, stale, ambiguous, or cross-kind identifiers return `BLOCKED/NEEDS_CONTEXT`",
    );
    expect(prose).toContain(
      "not a public helper or general Markdown parsing API",
    );
    expect(execution).not.toContain("resolve-task-records.mjs");
    expect(execution).not.toContain("task-record-resolution/v1");
  });
});
