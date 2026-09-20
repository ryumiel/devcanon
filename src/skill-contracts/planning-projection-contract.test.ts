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

function boldFieldLabels(markdown: string): string[] {
  return [...markdown.matchAll(/^\*\*([^*\r\n]+):\*\*/gm)].map(
    (match) => match[1],
  );
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

  it("keeps canonical reference fields in planning task blocks", async () => {
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
    }
  });

  it("keeps tier and reference fields in the canonical planning task block", async () => {
    const block = canonicalReferenceBlock(
      await readRepoFile("skills/play-planning/SKILL.md"),
    );

    expect(boldFieldLabels(block)).toEqual(
      expect.arrayContaining([
        "Task ID",
        "Boundary rows",
        "Supporting-owner supplements",
        "Contract tier",
        "Compact contract",
      ]),
    );
  });

  it("keeps controller refusal and compatibility tokens without a resolver surface", async () => {
    const execution = await readRepoFile(
      "skills/play-subagent-execution/SKILL.md",
    );

    expect(execution).toContain("`BLOCKED/NEEDS_CONTEXT`");
    expect(execution).toContain("inspect-plan-projection.sh --path");
    expect(execution).toContain("`planning-projection/v1`");
    expect(execution).not.toContain("resolve-task-records.mjs");
    expect(execution).not.toContain("task-record-resolution/v1");
  });

  it("keeps the planning handoff notice wire tokens", async () => {
    const planning = await readRepoFile("skills/play-planning/SKILL.md");

    expect(planning).toContain("`Plan written to <repo-relative-path>.`");
    expect(planning).toContain("`Reviewed digest: <sha256>`");
  });

  it("links the proportionality ADR from navigation and its execution consumer", async () => {
    const [map, skipDispatch] = await Promise.all([
      readRepoFile("MAP.md"),
      readRepoFile(
        "docs/adr/adr-0015-skip-dispatch-for-trivial-single-task-plans.md",
      ),
    ]);
    const adrPath =
      "docs/adr/adr-0035-behavioral-planning-contract-proportionality.md";

    expect(map).toContain(`(${adrPath})`);
    expect(skipDispatch).toContain("ADR-0035");
  });
});
