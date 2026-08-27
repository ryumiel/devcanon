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

  it("uses distinct structural examples for both record-reference kinds", async () => {
    const block = canonicalReferenceBlock(
      await readRepoFile(
        "skills/play-planning/references/planning-criteria.md",
      ),
    );
    const boundaryRows = block.match(/^\*\*Boundary rows:\*\* (.+)$/m)?.[1];
    const supplements = block.match(
      /^\*\*Supporting-owner supplements:\*\* (.+)$/m,
    )?.[1];

    expect(JSON.parse(boundaryRows ?? "null")).toEqual(["BR-A", "BR-B"]);
    expect(JSON.parse(supplements ?? "null")).toEqual(["EP-SUPPORTING-OWNERS"]);
  });

  it("keeps controller refusal and compatibility tokens without a resolver surface", async () => {
    const execution = await readRepoFile(
      "skills/play-subagent-execution/SKILL.md",
    );

    expect(execution).toContain("`BLOCKED/NEEDS_CONTEXT`");
    expect(execution).not.toContain("resolve-task-records.mjs");
    expect(execution).not.toContain("task-record-resolution/v1");
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
