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

const twoTaskPlan = `${completePlan}\n### Task 2: Second task\n\n**Task ID:** \`SECOND-TASK\`\n`;

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
      .replace("`BUILD-PROJECTION-OPERATION`]", "`UNKNOWN-TASK`]")
      .replace(
        "Task `BUILD-PROJECTION-OPERATION` — focused proof",
        "Task `BUILD-PROJECTION-OPERATION` focused proof",
      );

    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow("task-reference-unknown");
  });

  it.each([
    [
      "Setext projection",
      completePlan.replace(
        "## Execution Projection",
        "Execution Projection\n====",
      ),
      "execution-projection-missing",
    ],
    [
      "formatted Tasks",
      completePlan.replace("## Tasks", "## *Tasks*"),
      "tasks-section-missing",
    ],
    [
      "formatted Task heading",
      completePlan.replace(
        "### Task 1: Build projection operation",
        "### *Task 1: Build projection operation*",
      ),
      "task-reference-unknown",
    ],
  ])("requires literal ATX headings for %s", (_, input, code) => {
    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow(code);
  });

  it("decodes affected surfaces from their exact JSON source value", () => {
    const input = completePlan.replace(
      '["runtime inspector"]',
      '["*literal asterisks*", "_literal underscores_"]',
    );

    expect(
      inspectPlanningProjection(input, "plans/issue-651.md").projection
        .entries[0]?.affected_surfaces,
    ).toEqual(["*literal asterisks*", "_literal underscores_"]);
  });

  it("limits tasks to the peer Tasks section and preserves exact boundaries", () => {
    const input = [
      completePlan,
      "### Task 2: Second task",
      "",
      "**Task ID:** `SECOND-TASK`",
      "",
      "## Later section",
      "",
      "### Task 3: Ignored task",
      "",
      "**Task ID:** `IGNORED-TASK`",
      "",
    ].join("\n");

    const tasks = inspectPlanningProjection(input, "plans/issue-651.md").tasks;

    expect(tasks).toHaveLength(2);
    expect(input.slice(tasks[0]?.start, tasks[0]?.end)).toBe(
      input.slice(
        input.indexOf("### Task 1: Build projection operation"),
        input.indexOf("### Task 2: Second task"),
      ),
    );
    expect(input.slice(tasks[1]?.start, tasks[1]?.end)).toBe(
      input.slice(
        input.indexOf("### Task 2: Second task"),
        input.indexOf("## Later section"),
      ),
    );
    expect(tasks.map((task) => task.task_id)).not.toContain("IGNORED-TASK");
  });

  it("uses EOF as the final Task boundary", () => {
    const input = completePlan.trimEnd();
    const task = inspectPlanningProjection(input, "plans/issue-651.md")
      .tasks[0];

    expect(task?.end).toBe(input.length);
  });

  it.each([
    [
      "task-id-invalid",
      twoTaskPlan.replace("`SECOND-TASK`", "`not-a-task-id`"),
    ],
    [
      "task-id-duplicate",
      twoTaskPlan.replace(
        "**Task ID:** `SECOND-TASK`",
        "**Task ID:** `SECOND-TASK`\n\n**Task ID:** `SECOND-TASK-AGAIN`",
      ),
    ],
  ])("enforces one Task ID definition per task: %s", (code, input) => {
    expect(() =>
      inspectPlanningProjection(input, "plans/issue-651.md"),
    ).toThrow(code);
  });

  it("ignores semantic policy and excluded record material", () => {
    const input = [
      completePlan,
      "",
      '**Task references:** ["MISSING-TASK"]',
      "",
      "## Boundary rows",
      "",
      "- **Boundary ID:** `NOT-VALIDATED`",
      '- **Supporting-owner supplements:** ["unresolved"]',
      "",
      "## Later policy",
      "",
      "Unroutable, unapproved, and semantically incomplete on purpose.",
    ].join("\n");

    const result = inspectPlanningProjection(input, "plans/issue-651.md");

    expect(result).not.toHaveProperty("boundary_rows");
    expect(JSON.stringify(result)).not.toContain("NOT-VALIDATED");
  });
});
