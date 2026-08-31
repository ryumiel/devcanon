import { describe, expect, it } from "vitest";
import { inspectPlanningProjection } from "./planning-projection.js";

const completePlan = [
  "## Execution Projection",
  "",
  "- **Entry ID:** `EP-RUNTIME-RESULT-PRODUCTION`",
  '  - **Affected surface or equivalent set:** ["runtime inspector"]',
  "  - **Owner/source:** `issue #651` — result contract",
  "  - **Mode:** `authority`",
  "  - **Implementation disposition:** Tasks [`BUILD-PROJECTION-OPERATION`]",
  "  - **Proof:** Task `BUILD-PROJECTION-OPERATION` — focused proof",
  "",
  "## Tasks",
  "",
  "### Task 1: Build projection operation",
  "",
  "**Task ID:** `BUILD-PROJECTION-OPERATION`",
  "",
].join("\n");

describe("inspectPlanningProjection", () => {
  it("returns the closed projection result without changing its input", () => {
    const input = completePlan;

    const result = inspectPlanningProjection(input, "plans/issue-651.md");

    expect(input).toBe(completePlan);
    expect(result).toEqual({
      schema: "planning-projection/v1",
      plan_path: "plans/issue-651.md",
      projection: expect.objectContaining({
        entries: [
          expect.objectContaining({
            entry_id: "EP-RUNTIME-RESULT-PRODUCTION",
            implementation_task_ids: ["BUILD-PROJECTION-OPERATION"],
          }),
        ],
      }),
      tasks: [
        expect.objectContaining({
          task_id: "BUILD-PROJECTION-OPERATION",
          heading: "Task 1: Build projection operation",
        }),
      ],
    });
  });

  it.each([
    [
      "execution-projection-missing",
      completePlan.replace("## Execution Projection", "## Projection"),
    ],
    [
      "execution-projection-duplicate",
      `${completePlan}\n## Execution Projection\n`,
    ],
    [
      "tasks-section-missing",
      completePlan.slice(0, completePlan.indexOf("## Tasks")),
    ],
    [
      "task-heading-before-tasks",
      [
        "### Task 0: Before tasks",
        "",
        "**Task ID:** `TASK-BEFORE-TASKS`",
        "",
        completePlan,
      ].join("\n"),
    ],
    [
      "projection-entry-missing",
      completePlan.replace(/- \*\*Entry ID:[\s\S]+?focused proof\n\n/u, ""),
    ],
    [
      "projection-entry-field-invalid",
      completePlan.replace("`authority`", "`unsupported mode`"),
    ],
    [
      "entry-id-duplicate",
      completePlan.replace(
        "## Tasks",
        `${completePlan.slice(
          completePlan.indexOf("- **Entry ID:"),
          completePlan.indexOf("\n\n## Tasks"),
        )}\n\n## Tasks`,
      ),
    ],
    [
      "task-reference-unknown",
      completePlan.replace("BUILD-PROJECTION-OPERATION`]", "UNKNOWN-TASK`]"),
    ],
  ])("rejects %s at its single invalid dimension", (code, input) => {
    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow(code);
  });

  it.each([
    [
      "task-id-invalid",
      completePlan
        .replace(
          "Tasks [`BUILD-PROJECTION-OPERATION`]",
          "No code — no implementation task is required",
        )
        .replace(
          "Task `BUILD-PROJECTION-OPERATION`",
          "Reviewer existing responsibility",
        )
        .replace("`BUILD-PROJECTION-OPERATION`", "`not-a-task-id`"),
    ],
    [
      "task-id-duplicate",
      completePlan
        .replace(
          "Tasks [`BUILD-PROJECTION-OPERATION`]",
          "No code — no implementation task is required",
        )
        .replace(
          "Task `BUILD-PROJECTION-OPERATION`",
          "Reviewer existing responsibility",
        )
        .replace(
          "**Task ID:** `BUILD-PROJECTION-OPERATION`",
          [
            "**Task ID:** `BUILD-PROJECTION-OPERATION`",
            "",
            "### Task 2: Duplicate",
            "",
            "**Task ID:** `BUILD-PROJECTION-OPERATION`",
          ].join("\n"),
        ),
    ],
  ])("rejects %s without introducing a task reference fault", (code, input) => {
    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow(code);
  });

  it.each([
    ["fenced", "```md\n## Execution Projection\n```"],
    ["indented", "    ## Execution Projection"],
    ["block-quoted", "> ```md\n> ## Execution Projection\n> ```"],
    ["list-nested", "- item\n\n      ## Execution Projection"],
  ])(
    "does not classify %s block-code lookalikes as projection syntax",
    (_, literal) => {
      const input = [literal, "", completePlan].join("\n");

      expect(
        inspectPlanningProjection(input, "plans/issue-651.md").projection
          .entries,
      ).toHaveLength(1);
    },
  );

  it("returns the earliest distinct-offset finding without aggregation", () => {
    const input = completePlan
      .replace("`authority`", "`unsupported mode`")
      .replace("`BUILD-PROJECTION-OPERATION`", "`UNKNOWN-TASK`");

    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow("projection-entry-field-invalid");
  });
});
