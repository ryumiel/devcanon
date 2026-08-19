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

const directCitationForms = [
  "supporting-owner supplement <Entry ID>",
  "boundary row <stable row ID>",
] as const;

function numberedFieldLabels(section: string): string[] {
  return [...section.matchAll(/^\d+\. `([^`]+)`:/gm)].map((match) => match[1]);
}

function citationForms(markdown: string): string[] {
  const knownForms = new Set<string>(directCitationForms);
  return [...markdown.matchAll(/`([^`\r\n]+)`/g)]
    .map((match) => match[1])
    .filter((token) => knownForms.has(token));
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

  it("shares distinct supplement and boundary-row citation forms with the execution consumer", async () => {
    const [skill, criteria, execution] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of [skill, criteria, execution]) {
      expect(new Set(citationForms(source))).toEqual(
        new Set(directCitationForms),
      );
    }
  });
});
