import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

describe("write-product-spec source contracts", () => {
  it("owns behavior-spec boundaries in skill source instead of render tests", async () => {
    const skillSource = await readSkillSource("write-product-spec");

    const overview = normalizeWhitespace(
      getMarkdownSection(skillSource, "Overview"),
    );
    const whenToUse = normalizeWhitespace(
      getMarkdownSection(skillSource, "When To Use"),
    );
    const inputs = normalizeWhitespace(
      getMarkdownSection(skillSource, "Inputs"),
    );
    const procedure = normalizeWhitespace(
      getMarkdownSection(skillSource, "Procedure"),
    );
    const boundaryChecklist = normalizeWhitespace(
      getMarkdownSection(skillSource, "Boundary Checklist"),
    );

    expect(overview).toContain("docs/specs/");
    expect(overview).toContain("write-product-requirements");
    expect(overview).toContain("docs/product-requirements/");
    expect(overview).toContain("product intent");
    expect(overview).toContain("references/behavior-spec-evidence-routing.md");
    expect(overview).toContain("Repo-local AFDS docs are optional");
    expect(overview).toContain("required runtime inputs");
    expect(overview).toContain("readiness review");

    for (const excludedWork of [
      "routine bug fixes",
      "dependency audits",
      "review-feedback patches",
      "docs gardening",
      "behavior-preserving refactors",
    ]) {
      expect(whenToUse).toContain(excludedWork);
    }

    expect(inputs).toContain("Source-owned contract authority");
    expect(inputs).toContain(
      "Issues, PRs, design notes, tests, and code investigation",
    );
    expect(inputs).toContain("evidence pointer");
    expect(inputs).toContain("durable team, system, role, or artifact");
    expect(inputs).toContain("instead of person names, assignees");

    expect(procedure).toContain("docs/specs/<topic>.md");
    expect(procedure).toContain("never create root `SPEC.md`");
    expect(procedure).toContain("spec-readiness-review");
    expect(procedure).toContain("issue-slicing");
    expect(procedure.indexOf("spec-readiness-review")).toBeLessThan(
      procedure.indexOf("issue-slicing"),
    );

    for (const boundary of [
      "live issue status",
      "PR lists",
      "single-PR execution plans",
      "source-owned schemas, types, and validators",
      "Stable requirement IDs, scenario IDs, headings, or named anchors",
      "unapproved follow-up",
      "doc-impact-review",
      "post-merge-gardener",
      "new agent roles",
    ]) {
      expect(boundaryChecklist).toContain(boundary);
    }

    expect(skillSource).not.toContain(
      "docs/guidelines/portable-afds-user-procedure-map.md",
    );
    expect(skillSource).not.toContain(
      "docs/guidelines/behavior-spec-evidence-routing.md",
    );
    expect(skillSource).not.toContain("docs/specs/afds-workflow-routing.md");
    expect(skillSource).not.toContain("EVID-001");
    expect(skillSource).not.toContain("slice-issues");
  });
});
