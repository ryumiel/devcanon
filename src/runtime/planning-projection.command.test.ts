import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRuntimeCommand } from "./command.js";

async function withPlan<T>(
  input: string,
  assertion: (relativePath: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(
    path.join(process.cwd(), ".execution-projection-test-"),
  );
  const planPath = path.join(directory, "plan.md");
  await writeFile(planPath, input, "utf8");
  try {
    return await assertion(path.relative(process.cwd(), planPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const structuralPlan = [
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
  "**Task ID:** BUILD-PROJECTION-OPERATION",
  "",
].join("\n");

const noReferenceStructuralPlan = structuralPlan
  .replace(
    "Tasks [`BUILD-PROJECTION-OPERATION`]",
    "No code — no implementation task is required",
  )
  .replace(
    "Task `BUILD-PROJECTION-OPERATION`",
    "Reviewer existing responsibility",
  );

describe("planning-projection inspect command", () => {
  it.each([
    [],
    ["inspect"],
    ["inspect", "--path"],
    ["inspect", "--schema", "planning-projection/v1"],
  ])("rejects non-exact inspect arguments: %j", async (...args) => {
    const result = await runRuntimeCommand(["planning-projection", ...args]);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.endsWith("\n")).toBe(true);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      code: "plan-path-invalid",
      message: expect.any(String),
    });
  });

  it("inspects a complete saved execution projection with sliceable ranges", async () => {
    const input = [
      "# Plan 😀",
      "",
      "## Execution Projection",
      "",
      "- **Entry ID:** `EP-RUNTIME-RESULT-PRODUCTION`",
      '  - **Affected surface or equivalent set:** ["runtime inspector", "typed stdout"]',
      "  - **Owner/source:** `issue #651` — result contract",
      "  - **Mode:** `authority`",
      "  - **Implementation disposition:** Tasks [`BUILD-PROJECTION-OPERATION`]",
      "  - **Proof:** Task `BUILD-PROJECTION-OPERATION` — focused proof",
      "",
      "## Tasks",
      "",
      "### Task 1: Build projection operation",
      "",
      "**Task ID:** BUILD-PROJECTION-OPERATION",
      "",
      "### Task 2: Package runtime",
      "",
      "**Task ID:** PACKAGE-PROJECTION-RUNTIME",
      "",
    ].join("\n");

    await withPlan(input, async (planPath) => {
      const result = await runRuntimeCommand([
        "planning-projection",
        "inspect",
        "--path",
        planPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout) as {
        schema: string;
        plan_path: string;
        projection: {
          start: number;
          end: number;
          entries: Array<Record<string, unknown>>;
        };
        tasks: Array<{
          task_id: string;
          heading: string;
          start: number;
          end: number;
        }>;
      };
      expect(parsed.schema).toBe("planning-projection/v1");
      expect(parsed.plan_path).toBe(planPath);
      expect(Object.keys(parsed).sort()).toEqual([
        "plan_path",
        "projection",
        "schema",
        "tasks",
      ]);
      expect(Object.keys(parsed.projection).sort()).toEqual([
        "end",
        "entries",
        "start",
      ]);
      expect(input.slice(parsed.projection.start, parsed.projection.end)).toBe(
        input.slice(
          input.indexOf("## Execution Projection"),
          input.indexOf("## Tasks"),
        ),
      );
      expect(parsed.projection.entries).toEqual([
        expect.objectContaining({
          entry_id: "EP-RUNTIME-RESULT-PRODUCTION",
          affected_surfaces: ["runtime inspector", "typed stdout"],
          owner_source: "issue #651 — result contract",
          mode: "authority",
          implementation_task_ids: ["BUILD-PROJECTION-OPERATION"],
          no_code_reason: null,
          proof: {
            owner_type: "task",
            owner: "BUILD-PROJECTION-OPERATION",
            boundary: "focused proof",
          },
        }),
      ]);
      const entry = parsed.projection.entries[0] as {
        proof: Record<string, unknown>;
        start: number;
        end: number;
      };
      expect(Object.keys(entry).sort()).toEqual([
        "affected_surfaces",
        "end",
        "entry_id",
        "implementation_task_ids",
        "mode",
        "no_code_reason",
        "owner_source",
        "proof",
        "start",
      ]);
      expect(Object.keys(entry.proof).sort()).toEqual([
        "boundary",
        "owner",
        "owner_type",
      ]);
      expect(input.slice(entry.start, entry.end)).toBe(
        input.slice(
          input.indexOf("- **Entry ID:"),
          input.indexOf("\n\n## Tasks"),
        ),
      );
      expect(
        parsed.tasks.map(({ task_id, heading }) => ({ task_id, heading })),
      ).toEqual([
        {
          task_id: "BUILD-PROJECTION-OPERATION",
          heading: "Task 1: Build projection operation",
        },
        {
          task_id: "PACKAGE-PROJECTION-RUNTIME",
          heading: "Task 2: Package runtime",
        },
      ]);
      for (const task of parsed.tasks) {
        expect(Object.keys(task).sort()).toEqual([
          "end",
          "heading",
          "start",
          "task_id",
        ]);
        expect(input.slice(task.start, task.end)).toContain(
          `### ${task.heading}`,
        );
      }
    });
  });

  it.each([
    [
      "plan-path-invalid",
      ["planning-projection", "inspect", "--path", "../plan.md"],
    ],
    [
      "plan-unreadable",
      ["planning-projection", "inspect", "--path", "missing-plan.md"],
    ],
    ["plan-unreadable", ["planning-projection", "inspect", "--path", "src"]],
  ])(
    "returns %s without stdout for an invalid saved-plan input",
    async (code, args) => {
      const result = await runRuntimeCommand(args);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, code });
    },
  );

  it("rejects a symlinked saved plan as an invalid path", async () => {
    const directory = await mkdtemp(
      path.join(process.cwd(), ".execution-projection-test-"),
    );
    await writeFile(path.join(directory, "target.md"), "# not read", "utf8");
    await symlink("target.md", path.join(directory, "linked.md"));
    try {
      const result = await runRuntimeCommand([
        "planning-projection",
        "inspect",
        "--path",
        path.relative(process.cwd(), path.join(directory, "linked.md")),
      ]);

      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        code: "plan-path-invalid",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "execution-projection-missing",
      structuralPlan.replace("## Execution Projection", "## Projection"),
    ],
    [
      "execution-projection-duplicate",
      `${structuralPlan}\n## Execution Projection\n`,
    ],
    [
      "tasks-section-missing",
      structuralPlan.slice(0, structuralPlan.indexOf("## Tasks")),
    ],
    [
      "task-heading-before-tasks",
      [
        "### Task 0: Before Tasks",
        "",
        "**Task ID:** BEFORE-TASKS",
        "",
        structuralPlan,
      ].join("\n"),
    ],
    [
      "projection-entry-missing",
      structuralPlan.replace(/- \*\*Entry ID:[\s\S]+?focused proof\n\n/u, ""),
    ],
    [
      "projection-entry-field-invalid",
      structuralPlan.replace("`authority`", "`unsupported mode`"),
    ],
    [
      "entry-id-duplicate",
      structuralPlan.replace(
        "## Tasks",
        `${structuralPlan.slice(
          structuralPlan.indexOf("- **Entry ID:"),
          structuralPlan.indexOf("\n\n## Tasks"),
        )}\n\n## Tasks`,
      ),
    ],
    [
      "task-id-invalid",
      noReferenceStructuralPlan.replace(
        "BUILD-PROJECTION-OPERATION",
        "not-a-task-id",
      ),
    ],
    [
      "task-id-duplicate",
      `${noReferenceStructuralPlan}\n### Task 2: Duplicate\n\n**Task ID:** BUILD-PROJECTION-OPERATION\n`,
    ],
    [
      "task-reference-unknown",
      structuralPlan.replace("BUILD-PROJECTION-OPERATION`]", "UNKNOWN-TASK`]"),
    ],
  ])(
    "emits the closed %s failure envelope at the command boundary",
    async (code, input) => {
      await withPlan(input, async (planPath) => {
        const result = await runRuntimeCommand([
          "planning-projection",
          "inspect",
          "--path",
          planPath,
        ]);

        expect(result.exitCode).toBeGreaterThan(0);
        expect(result.stdout).toBe("");
        expect(result.stderr.endsWith("\n")).toBe(true);
        expect(JSON.parse(result.stderr)).toMatchObject({
          ok: false,
          code,
          message: expect.any(String),
        });
      });
    },
  );
});
