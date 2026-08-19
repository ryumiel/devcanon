import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const WORKFLOW_PATH = "skills/issue-priming-workflow/SKILL.md";
const DIAGRAM_PATH =
  "skills/issue-priming-workflow/references/workflow-diagram.md";
const CLOSURE_HEADING = "Candidate Closure and Source Freeze";

function headingOffset(markdown: string, heading: string): number {
  const offset = markdown.indexOf(`### ${heading}\n`);
  expect(offset).toBeGreaterThanOrEqual(0);
  return offset;
}

describe("issue-priming candidate closure contract", () => {
  it("places the named freeze checkpoint between implementation and branch review", async () => {
    const workflow = await readRepoFile(WORKFLOW_PATH);

    const phase6 = headingOffset(workflow, "Phase 6: Implement");
    const closure = headingOffset(workflow, CLOSURE_HEADING);
    const phase7 = headingOffset(workflow, "Phase 7: Branch Review");

    expect(phase6).toBeLessThan(closure);
    expect(closure).toBeLessThan(phase7);
  });

  it("keeps the documented workflow transitions through closure", async () => {
    const diagram = await readRepoFile(DIAGRAM_PATH);

    expect(diagram).toContain(
      "plan -> implement -> candidate_closure -> downstream_evidence -> review -> create_pr -> done;",
    );
    expect(diagram).toMatch(/review\s*->\s*candidate_closure\s*\[/);
  });
});
