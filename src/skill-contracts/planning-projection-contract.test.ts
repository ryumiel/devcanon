import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

type ProjectionFixture = {
  entryId: string;
  knownEntryIds: readonly string[];
  owner: string;
  participant: string;
  taskId: string;
  boundaryCitation?: string;
  hardRequirements: readonly string[];
  traceability: readonly string[];
};

function projectionFixtureBlockers(fixture: ProjectionFixture): string[] {
  const blockers: string[] = [];
  if (!fixture.knownEntryIds.includes(fixture.entryId))
    blockers.push("unresolvable Entry ID");
  if (!fixture.owner) blockers.push("missing authoritative owner");
  if (!fixture.participant)
    blockers.push("missing execution-relevant participant");
  if (!fixture.taskId) blockers.push("missing task membership");
  if (fixture.boundaryCitation !== fixture.entryId)
    blockers.push("missing required task citation");
  for (const requirement of fixture.hardRequirements) {
    if (!fixture.traceability.includes(requirement))
      blockers.push(`uncovered hard requirement: ${requirement}`);
  }
  return blockers;
}

describe("play-planning execution projection contract", () => {
  it("accepts one directional relationship and traceability without duplicate proof allocation", async () => {
    const [skill, criteria, checklist] = await Promise.all([
      readSource("skills/play-planning/SKILL.md"),
      readSource("skills/play-planning/references/planning-criteria.md"),
      readSource("docs/guidelines/documentation-checklists.md"),
    ]);

    expect(skill).toMatch(
      /Represent each approved\s+relationship once in the direction needed to give its assigned task curated\s+execution context\./,
    );
    expect(criteria).toMatch(
      /equivalent inverse relationship or duplicate proof allocation in a boundary\s+record, task contract, or traceability matrix is not required and must not be a\s+review blocker\./,
    );
    expect(criteria).toMatch(
      /The matrix does not reallocate or repeat the Execution Projection's\s+proof allocation;/,
    );
    expect(checklist).toMatch(
      /do not duplicate\s+it here or add an equivalent\s+inverse producer-consumer edge\./,
    );
  });

  it("keeps real projection and requirement omissions blocking", async () => {
    const criteria = await readSource(
      "skills/play-planning/references/planning-criteria.md",
    );

    for (const blocker of [
      "stale or unresolvable Entry ID",
      "missing\nauthoritative owner",
      "omitted execution-relevant participant",
      "conflicting task membership",
      "An uncovered hard requirement remains blocking.",
    ]) {
      expect(criteria).toContain(blocker);
    }
  });

  it("covers a one-directional fixture and isolated blocking mutations", () => {
    const valid: ProjectionFixture = {
      entryId: "EP-RENDER-PARITY",
      knownEntryIds: ["EP-RENDER-PARITY"],
      owner: "skills/play-planning/SKILL.md",
      participant: "generated Codex bundle",
      taskId: "VERIFY-PARITY",
      boundaryCitation: "EP-RENDER-PARITY",
      hardRequirements: ["HR-PARITY"],
      traceability: ["HR-PARITY"],
    };

    expect(projectionFixtureBlockers(valid)).toEqual([]);
    expect(
      projectionFixtureBlockers({ ...valid, entryId: "EP-STALE-ENTRY" }),
    ).toContain("unresolvable Entry ID");
    expect(projectionFixtureBlockers({ ...valid, owner: "" })).toContain(
      "missing authoritative owner",
    );
    expect(projectionFixtureBlockers({ ...valid, participant: "" })).toContain(
      "missing execution-relevant participant",
    );
    expect(projectionFixtureBlockers({ ...valid, taskId: "" })).toContain(
      "missing task membership",
    );
    expect(
      projectionFixtureBlockers({ ...valid, boundaryCitation: undefined }),
    ).toContain("missing required task citation");
    expect(projectionFixtureBlockers({ ...valid, traceability: [] })).toContain(
      "uncovered hard requirement: HR-PARITY",
    );
  });

  it("keeps D5 and D6 independent same-digest reviewers", async () => {
    const [skill, criteria] = await Promise.all([
      readSource("skills/play-planning/SKILL.md"),
      readSource("skills/play-planning/references/planning-criteria.md"),
    ]);

    expect(skill).toContain("Reviewed digest: <sha256>");
    expect(criteria).toContain(
      "D6 reports projection facts only for concrete task-local startability defects;",
    );
    expect(criteria).toContain(
      "D5 must not block solely because an equivalent inverse relationship or duplicate\nproof allocation is absent.",
    );
  });
});
