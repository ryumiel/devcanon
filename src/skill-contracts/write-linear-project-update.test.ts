import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

describe("write-linear-project-update source contracts", () => {
  it("uses the renamed skill and reference paths as the active source contract", async () => {
    const skillSource = await readSkillSource("write-linear-project-update");
    const reference = await readRepoFile(
      "skills/write-linear-project-update/references/update-template.md",
    );

    expect(skillSource).toContain("name: write-linear-project-update");
    expect(skillSource).toContain(
      "description: Writes concise Linear project updates from project evidence.",
    );
    expect(skillSource).toContain("# Write Linear Project Update");
    expect(normalizeWhitespace(skillSource)).toContain(
      "Use this skill to write a concise stakeholder-readable Linear project update from evidence.",
    );
    expect(reference).toContain("# Project Update Template");
    await expect(
      readRepoFile("skills/linear-project-update-auditor/SKILL.md"),
    ).rejects.toThrow();
  });

  it("routes normal apply requests to create mode and reserves update mode for explicit target mutation", async () => {
    const skillSource = await readSkillSource("write-linear-project-update");
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );
    const evidenceCommands = getMarkdownSection(
      skillSource,
      "Evidence Commands",
    );
    const reference = normalizeWhitespace(
      await readRepoFile(
        "skills/write-linear-project-update/references/update-template.md",
      ),
    );

    expect(workflow).toContain(
      "Use `create` mode by default, including normal requests to write, apply, post, or publish a project update.",
    );
    expect(workflow).not.toContain(
      "The proposed write action must update the latest project update ID.",
    );
    expect(workflow).not.toContain(
      "Do not propose creating a new project update unless the user explicitly asked for a new update.",
    );
    expect(evidenceCommands).toContain(
      'linear-cli pu create <PROJECT> --health <HEALTH> --body "$BODY"',
    );
    expect(workflow).toContain(
      "Use `update` mode only when the user explicitly asks to revise, edit, update, replace, or modify an existing project update.",
    );
    expect(workflow).toContain(
      "In `update` mode, require a target update ID or one single confirmed mutation target from the user/project evidence.",
    );
    expect(evidenceCommands).toContain(
      'linear-cli pu update <UPDATE_ID> --health <HEALTH> --body "$BODY"',
    );
    expect(evidenceCommands).not.toContain(
      'linear-cli pu update UPDATE_ID --health atRisk -b "$BODY"',
    );
    expect(workflow).toContain(
      "Accept a project update ID or body as a style/tone reference when the user presents it that way; a style reference is evidence only and is not a mutation target.",
    );
    expect(workflow).toContain(
      "If an update ID is ambiguous between a mutation target and a style/tone reference, treat it as non-mutating style evidence unless the user confirms explicit update intent.",
    );
    expect(reference).toContain(
      "For explicit `update` mode, note the confirmed target update ID separately from any style/tone reference update ID or body.",
    );
  });

  it("keeps dry-run and apply output contracts explicit for create versus update writes", async () => {
    const skillSource = await readSkillSource("write-linear-project-update");
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );
    const reference = normalizeWhitespace(
      await readRepoFile(
        "skills/write-linear-project-update/references/update-template.md",
      ),
    );

    expect(workflow).toContain(
      "Output current latest health, recommended health, proposed update body, evidence used, action mode (`create` or `update`), and the exact write action that would be performed.",
    );
    expect(workflow).toContain(
      "In `create` mode, the proposed write action must create a new project update.",
    );
    expect(workflow).toContain(
      "In `update` mode, the proposed write action must update the confirmed target update ID.",
    );
    expect(workflow).toContain(
      "Re-read project updates after writing and report final health, the created or updated update ID/URL, and a concise summary.",
    );
    expect(reference).toContain("Exact proposed write action and action mode.");
    expect(reference).toContain(
      "For default `create` mode, note the project target for the new project update.",
    );
  });

  it("preserves safety and reporting constraints for project update writes", async () => {
    const skillSource = await readSkillSource("write-linear-project-update");
    const workflow = normalizeWhitespace(
      getMarkdownSection(skillSource, "Workflow"),
    );
    const writingRules = normalizeWhitespace(
      getMarkdownSection(skillSource, "Writing Rules"),
    );
    const reference = normalizeWhitespace(
      await readRepoFile(
        "skills/write-linear-project-update/references/update-template.md",
      ),
    );

    expect(skillSource).toContain(
      "This skill must not create issues, bulk-edit issues, or change project lifecycle status.",
    );
    expect(workflow).toContain("Check risky issues directly.");
    expect(workflow).toContain("Do not rely only on aggregate counts.");
    expect(workflow).toContain(
      "recent comments, attachments, linked PR state, CI status, and whether the work was split or superseded.",
    );
    expect(workflow).toContain(
      "Put issue IDs, PR links, counts, and raw evidence in a separate evidence appendix file, not in the postable body.",
    );
    expect(workflow).toContain("Do not modify Linear.");
    expect(workflow).toContain("Do not change lifecycle status.");
    expect(writingRules).toContain(
      "Separate confirmed facts from inference in dry-run explanations.",
    );
    expect(writingRules).toContain("Do not hide blockers or failing checks.");
    expect(reference).toContain(
      "Do not include Linear issue IDs in this body.",
    );
    expect(reference).toContain(
      "Keep issue IDs, PR links, counts, and raw evidence in a separate appendix file.",
    );
    expect(reference).toContain("recommended health");
    expect(reference).toContain("Risky issue IDs and their current state.");
  });
});
