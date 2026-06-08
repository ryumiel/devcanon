import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

describe("write-linear-project-description source contracts", () => {
  it("defines a dedicated sibling skill for durable project descriptions", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const normalized = normalizeWhitespace(skillSource);

    expect(skillSource).toContain("name: write-linear-project-description");
    expect(skillSource).toContain(
      "description: Writes durable Linear project descriptions and content briefs.",
    );
    expect(skillSource).toContain("# Write Linear Project Description");
    expect(normalized).toContain(
      "Use this skill for durable Linear project summaries, descriptions, and content briefs.",
    );
    expect(normalized).toContain(
      "Do not use this skill for time-windowed project updates, health reports, or update history posts; use `write-linear-project-update` for those.",
    );
  });

  it("requires reading current description and content before drafting", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );

    expect(workflow).toContain(
      "Read the current project `description` and `content` before drafting.",
    );
    expect(workflow).toContain(
      "If either field is empty, report that no prior field content existed.",
    );
    expect(workflow).toContain(
      "Inspect issues, project updates, or repository evidence only when needed to make stakeholder framing accurate.",
    );
  });

  it("distinguishes description, content, and explicit both-field requests", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );

    expect(workflow).toContain(
      "Use `description` for a short stakeholder-facing project summary.",
    );
    expect(workflow).toContain(
      "Use `content` for a detailed durable project brief when the user explicitly targets the detailed content field.",
    );
    expect(workflow).toContain(
      "Update both fields only when the user explicitly asks for both.",
    );
    expect(workflow).toContain(
      "If the target field is ambiguous, stop and ask which field to update before drafting or applying.",
    );
    expect(workflow).not.toContain(
      "If the project brief is ambiguous, default to content.",
    );
    expect(workflow).not.toContain("before drafting for apply");
  });

  it("defaults to safe draft mode and invokes the draft helper", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );
    const helperContract = normalizeWhitespace(
      getMarkdownSection(skillSource, "Draft Helper"),
    );

    expect(workflow).toContain("Default to draft mode.");
    expect(workflow).toContain("Draft mode must not modify Linear.");
    expect(workflow).toContain(
      "Call the bundled draft helper before writing draft bodies.",
    );
    expect(helperContract).toContain(
      'WRITE_LINEAR_PROJECT_DESCRIPTION_DIR="<installed-write-linear-project-description-skill-bundle>"',
    );
    expect(helperContract).toContain(
      'bash "$WRITE_LINEAR_PROJECT_DESCRIPTION_DIR/scripts/prepare-project-description-draft.sh"',
    );
    expect(helperContract).toContain(
      "The helper prepares direct-child `.ephemeral/` paths and does not write draft body content.",
    );
    expect(helperContract).toContain("PROJECT_KEY");
    expect(helperContract).toContain("TARGET_FIELDS");
    expect(helperContract).toContain("REPLACE_EXISTING");
    expect(helperContract).toContain(
      "<project-key>-project-description-draft.md",
    );
    expect(helperContract).toContain(
      "<project-key>-project-content-brief-draft.md",
    );
  });

  it("allows apply mode only for explicit approved field mutations", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const applyMode = normalizeWhitespace(
      getMarkdownSection(skillSource, "Apply Mode"),
    );

    expect(applyMode).toContain(
      "Apply only when the user explicitly asks to apply or update Linear.",
    );
    expect(applyMode).toContain(
      "Use the exact approved draft body or user-approved revision.",
    );
    expect(applyMode).toContain(
      'linear-cli p update <PROJECT> --description "$BODY"',
    );
    expect(applyMode).toContain(
      'linear-cli p update <PROJECT> --content "$BODY"',
    );
    expect(applyMode).toContain(
      "Re-read the project after writing and verify the stored field matches the applied value.",
    );
    expect(applyMode).toContain(
      "Report verification mismatch as a failure instead of inferring success from command exit.",
    );
    expect(applyMode).not.toContain("linear-cli pu create");
    expect(applyMode).not.toContain("linear-cli pu update");
  });

  it("treats style references as evidence and keeps stakeholder output clean", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const writingRules = normalizeWhitespace(
      getMarkdownSection(skillSource, "Writing Rules"),
    );

    expect(writingRules).toContain(
      "Treat project update IDs, update bodies, examples, and user-provided references as style evidence only unless the user explicitly names them as mutation targets.",
    );
    expect(writingRules).toContain(
      "Do not mutate a referenced project update when it was provided as a style reference.",
    );
    expect(writingRules).toContain(
      "Avoid issue-ID-heavy implementation inventory in stakeholder-facing descriptions and briefs unless the user asks for it.",
    );
    expect(writingRules).toContain(
      "Keep raw issue IDs, PR links, counts, and audit evidence out of the postable field body by default.",
    );
  });

  it("forbids unrelated Linear mutations", async () => {
    const skillSource = await readSkillSource(
      "write-linear-project-description",
    );
    const normalized = normalizeWhitespace(skillSource);

    expect(normalized).toContain(
      "This skill must not create project updates, mutate project lifecycle status, create issues, bulk-edit issues, or sync installed user-home outputs.",
    );
  });
});
