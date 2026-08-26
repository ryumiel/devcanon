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

const externalStateBoundary =
  "externally controlled or outside the authorized repository/worktree state";

function numberedFieldLabels(section: string): string[] {
  return [...section.matchAll(/^\d+\. `([^`]+)`:/gm)].map((match) => match[1]);
}

function canonicalTaskFields(markdown: string): string[] {
  return [...markdown.matchAll(/^\*\*([^*\r\n]+):\*\*/gm)]
    .map((match) => match[1])
    .filter((field) => recordReferenceFields.includes(field as never));
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

  it("shares canonical record-reference fields with the execution consumer", async () => {
    const [skill, criteria, execution] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of [skill, criteria, execution]) {
      expect(new Set(canonicalTaskFields(source))).toEqual(
        new Set(recordReferenceFields),
      );
    }
  });

  it("keeps reference-field ordering non-semantic across planning owners", async () => {
    const [skill, criteria] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
    ]);

    for (const source of [skill, criteria]) {
      expect(normalizedProse(source)).toContain(
        "their relative position and the order of unrelated task fields are non-semantic",
      );
      expect(source).not.toContain(
        "followed by exactly one `**Boundary rows:**`",
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
    expect(brainstorm).toContain(
      "Persistence, cross-session use, or a filesystem effect alone",
    );
    expect(brainstorm).toContain("Planning remains the sole tier classifier");
    expect(brainstorm).not.toContain(
      "private, transient, same-controller, and have no durable schema consumer",
    );
  });

  it("distinguishes authorized local filesystem output from external mutation", async () => {
    const [criteria, checklist, brainstorm] = await Promise.all([
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("docs/guidelines/documentation-checklists.md"),
      readRepoFile("skills/play-brainstorm/SKILL.md"),
    ]);

    for (const source of [criteria, checklist, brainstorm]) {
      expect(normalizedProse(source)).toContain(externalStateBoundary);
    }

    const criteriaProse = normalizedProse(
      getMarkdownSection(criteria, "Proportional contract planning"),
    );
    expect(criteriaProse).toContain(
      "bounded, recoverable filesystem output inside the authorized repository/worktree",
    );
    expect(criteriaProse).toContain(
      "explicit write owner, permission, failure, cleanup, and recovery",
    );
    expect(criteriaProse).toContain(
      "provider, network, user-home, system-wide, outside-worktree, or otherwise externally controlled mutation",
    );
    expect(normalizedProse(criteria)).toContain(
      "Missing or incorrect ownership or permission for a filesystem write",
    );
    expect(
      normalizedProse(criteria).match(
        /material write or side-effect owner, permission, failure, cleanup, and recovery behavior/g,
      ),
    ).toHaveLength(5);
  });

  it("keeps boundary-owned facts single-carrier and representation differences non-blocking", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const prose = normalizedProse(criteria);

    expect(prose).toContain(
      "Directly cited boundary records may exclusively own",
    );
    expect(prose).toContain(
      "does not also become an Execution Projection surface",
    );
    expect(prose).toContain(
      "representation-only wording or ordering difference is non-blocking",
    );
    expect(prose).toContain(
      "Missing owners, participants, implementation membership, proof ownership, or execution facts remain blocking",
    );
    expect(prose).toContain("Valid boundary-carried context");
    expect(prose).toContain("Invalid missing-participant mutation");
    expect(prose).toContain("Invalid missing-authority mutation");
    expect(prose).toContain("Invalid missing-task-membership mutation");
    expect(prose).toContain("Invalid missing-proof mutation");
    expect(prose).toContain("Valid representation-only mutation");
    expect(prose).toContain("narrow canonical anchor grammar");
    expect(prose).toContain("record IDs are kind-scoped and do not inherit");
    expect(prose).toContain("Task ID's `UPPER-ASCII-KEBAB` grammar");
  });

  it("keeps the controller and all prompt consumers on validated curated IDs", async () => {
    const [execution, ...prompts] = await Promise.all([
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
      readRepoFile(
        "skills/play-subagent-execution/references/implementer-prompt.md",
      ),
      readRepoFile(
        "skills/play-subagent-execution/references/executor-prompt.md",
      ),
      readRepoFile(
        "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
      ),
    ]);

    expect(execution).toContain(
      "Require the closed `play-subagent-execution/task-record-resolution/v1` result",
    );
    expect(execution).toContain("with exactly `schema`, `task_id`");
    expect(execution).toContain("Use only those validated IDs to curate");
    expect(execution).toContain(
      "an inline plan must return `BLOCKED/NEEDS_CONTEXT`",
    );
    expect(execution).toContain('*\\\\*) echo "plan path validation failed"');
    expect(normalizedProse(execution)).toContain(
      "Failure diagnostics do not echo the caller-controlled path",
    );
    for (const prompt of prompts) {
      expect(prompt).toContain(
        "plan-level records curated only from the\n    task resolver's validated canonical IDs",
      );
      expect(prompt).toContain(
        "Do not parse the full plan, re-resolve IDs, infer other records",
      );
    }
  });
});
