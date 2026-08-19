import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const WORKFLOW_PATH = "skills/issue-priming-workflow/SKILL.md";
const CLOSURE_HEADING = "Candidate Closure and Source Freeze";

function headingOffset(markdown: string, heading: string): number {
  const offset = markdown.indexOf(`### ${heading}\n`);
  expect(offset).toBeGreaterThanOrEqual(0);
  return offset;
}

function workflowSection(markdown: string, heading: string): string {
  const start = headingOffset(markdown, heading);
  const end = markdown.indexOf("\n### ", start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

describe("issue-priming candidate closure contract", () => {
  it("places the named freeze checkpoint between implementation and branch review", async () => {
    const workflow = await readRepoFile(WORKFLOW_PATH);

    const phase6 = headingOffset(workflow, "Phase 6: Implement");
    const closure = headingOffset(workflow, CLOSURE_HEADING);
    const phase7 = headingOffset(workflow, "Phase 7: Branch Review");

    expect(phase6).toBeLessThan(closure);
    expect(closure).toBeLessThan(phase7);

    const checkpoint = workflowSection(workflow, CLOSURE_HEADING);
    expect(checkpoint).toMatch(/bounded read-only impact scan/i);
    expect(checkpoint).toMatch(/clean worktree/i);
    expect(checkpoint).toMatch(/exact current `HEAD`/i);
    expect(checkpoint).toMatch(/`pnpm run check`/);
    expect(checkpoint).toMatch(/still match the frozen candidate/i);
  });

  it("invalidates downstream evidence and re-enters closure after a review-owned fix", async () => {
    const [workflow, phase7] = await Promise.all([
      readRepoFile(WORKFLOW_PATH),
      readRepoFile(
        "skills/issue-priming-workflow/references/phase-7-review-handling.md",
      ),
    ]);

    for (const source of [workflow, phase7]) {
      expect(source).toContain(CLOSURE_HEADING);
      expect(source).toMatch(
        /downstream evidence as stale|invalidates the prior candidate and downstream evidence/i,
      );
      expect(source).toMatch(/non-authorizing context/i);
    }
  });

  it("keeps reduced-route assurance downstream of closure without changing its owners", async () => {
    const [executor, routing, handoff, adr] = await Promise.all([
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
      readRepoFile(
        "skills/play-subagent-execution/references/review-routing-policy.md",
      ),
      readRepoFile(
        "skills/issue-priming-workflow/references/phase-6-auto-handoff.md",
      ),
      readRepoFile("docs/adr/adr-0018-risk-based-per-task-review-routing.md"),
    ]);

    for (const source of [executor, routing, handoff, adr]) {
      expect(source).toMatch(/Candidate Closure and\s+Source Freeze/);
      expect(source).toContain("branch-review --fix");
    }

    expect(routing).toContain("spec-and-quality");
    expect(routing).toContain("spec-only");
    expect(routing).toContain("none-final-only");
  });
});
