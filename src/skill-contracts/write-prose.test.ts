import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

describe("write-prose source contracts", () => {
  it("defines prose as a support skill without taking over owner workflow authority", async () => {
    const skillSource = await readSkillSource("write-prose");
    const authority = normalizeWhitespace(
      getMarkdownSection(skillSource, "Authority Boundaries"),
    );
    const normalizedSkillSource = normalizeWhitespace(skillSource);
    const sideEffects = normalizeWhitespace(
      getMarkdownSection(skillSource, "Side Effects"),
    );

    expect(skillSource).toContain("name: write-prose");
    expect(skillSource).toContain(
      "description: Drafts, revises, adapts, and reviews prose while preserving meaning, evidence, terminology, and artifact-owner contracts.",
    );
    expect(normalizedSkillSource).toContain(
      "This skill may also be used as a support pass inside another authoring workflow",
    );
    expect(authority).toContain("preserve its headings, required fields");
    expect(authority).toContain("action mode");
    expect(authority).toContain("health decision");
    expect(authority).toContain("no-external-mutation rules");
    expect(authority).toContain(
      "style improvement conflicts with source evidence, claim authority, or an owner contract",
    );
    expect(sideEffects).toContain("Do not mutate external systems");
    expect(sideEffects).toContain("Linear writes");
    expect(sideEffects).toContain("GitHub writes");
    expect(sideEffects).toContain(
      "If the request is a review, produce findings rather than editing unless the user asks for edits.",
    );
  });

  it("routes language-specific references without runtime dependency on the source vault", async () => {
    const skillSource = await readSkillSource("write-prose");
    const routing = normalizeWhitespace(
      getMarkdownSection(skillSource, "Reference Routing"),
    );

    for (const referencePath of [
      "skills/write-prose/references/english-prose.md",
      "skills/write-prose/references/korean-prose.md",
      "skills/write-prose/references/bilingual-prose.md",
      "skills/write-prose/references/prose-review-findings.md",
    ]) {
      await expect(readRepoFile(referencePath)).resolves.toContain("# ");
    }

    expect(routing).toContain("Load only the bundled reference files needed");
    expect(routing).toContain("references/english-prose.md");
    expect(routing).toContain("references/korean-prose.md");
    expect(routing).toContain("references/bilingual-prose.md");
    expect(routing).toContain("references/prose-review-findings.md");
    expect(routing).toContain("Do not open or require any external writing vault");

    expect(skillSource).not.toContain("../obsidian-work");
    expect(skillSource).not.toContain("/Users/ryumiel/Workspace/obsidian-work");
  });

  it("treats unsupported significance as a claim-support conflict in English and Korean", async () => {
    const skillSource = await readSkillSource("write-prose");
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );
    const outputRules = normalizeWhitespace(
      getMarkdownSection(skillSource, "Output Rules"),
    );
    const english = normalizeWhitespace(
      await readRepoFile("skills/write-prose/references/english-prose.md"),
    );
    const korean = normalizeWhitespace(
      await readRepoFile("skills/write-prose/references/korean-prose.md"),
    );

    expect(workflow).toContain("Remove, ground, or flag");
    expect(workflow).toContain(
      "Do not replace a strong unsupported claim with a softer unsupported claim.",
    );
    expect(outputRules).toContain("claim-support");
    expect(outputRules).toContain("Unsupported significance, value, scale");
    expect(outputRules).toContain("report the conflict instead of polishing");

    expect(english).toContain(
      "Pressure to sound confident, polished, strategic, human, or stakeholder-ready does not lower the evidence bar.",
    );
    expect(english).toContain('"strengthens the workflow"');
    expect(english).toContain("If only the artifact's existence is supported");

    expect(korean).toContain("근거 없는 의미 부여");
    expect(korean).toContain("`중요한 전환점`");
    expect(korean).toContain("`상당한 가치`");
    expect(korean).toContain("더 약한 표현으로 바꾸더라도");
  });

  it("keeps bilingual cleanup and owner-contract findings explicit", async () => {
    const bilingual = normalizeWhitespace(
      await readRepoFile("skills/write-prose/references/bilingual-prose.md"),
    );
    const findings = normalizeWhitespace(
      await readRepoFile(
        "skills/write-prose/references/prose-review-findings.md",
      ),
    );

    expect(bilingual).toContain("English/Korean bilingual drafting");
    expect(bilingual).toContain("Terminology Mapping");
    expect(bilingual).toContain("owner-workflow control words");
    expect(bilingual).toContain("owner-workflow structure and field values");
    expect(bilingual).toContain("English residue");

    expect(findings).toContain("Baseline Failure Coverage");
    expect(findings).toContain("Unsupported claim preservation");
    expect(findings).toContain("Owner-Contract Review");
    expect(findings).toContain(
      "leave the owner-controlled text unchanged or recommend restoring it",
    );
    expect(findings).toContain("Do not rewrite through the owner contract.");
  });
});
