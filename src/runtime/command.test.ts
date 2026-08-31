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

describe("runtime command helpers", () => {
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
      "**Task ID:** `BUILD-PROJECTION-OPERATION`",
      "",
      "### Task 2: Package runtime",
      "",
      "**Task ID:** `PACKAGE-PROJECTION-RUNTIME`",
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

  it("reports a stable command contract", async () => {
    await expect(runRuntimeCommand(["contract"])).resolves.toEqual({
      exitCode: 0,
      stdout:
        '{"command_group":"devcanon-runtime","major_version":1,"helper_foundation":true}\n',
      stderr: "",
    });
  });

  it("returns a stable failure envelope for an unknown config subcommand", async () => {
    await expect(runRuntimeCommand(["config", "replace"])).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"unknown-config-command","message":"unknown devcanon-runtime config command: replace"}\n',
    });
  });

  it.each([
    ["--key", "capabilityProfiles.balanced.codex", "--key", "other"],
    ["--key", "capabilityProfiles.balanced.codex", "extra"],
    ["--key", ""],
  ])("rejects non-exact config get arguments: %j", async (...args) => {
    await expect(
      runRuntimeCommand(["config", "get", ...args]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"runtime-error","message":"config get requires exactly --key <nonempty>"}\n',
    });
  });

  it("routes the provider scope producer through its distinct command group", async () => {
    await expect(
      runRuntimeCommand(["pr-review-provider-scope-evidence", "contract"]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout:
        '{"command_group":"pr-review-provider-scope-evidence","major_version":1}\n',
      stderr: "",
    });
    await expect(
      runRuntimeCommand(["review-artifacts", "write-provider-scope-evidence"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("usage: review-artifacts.sh"),
    });
  });

  it("returns parseable path facts", async () => {
    const result = await runRuntimeCommand([
      "path-info",
      "--path",
      "C:\\Temp\\..\\Agent\\File.txt",
      "--platform",
      "win32",
    ]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      normalized: "C:\\Agent\\File.txt",
      comparable: "c:/agent/file.txt",
      isAbsolute: true,
    });
  });

  it("returns stable stderr fragments for invalid paths", async () => {
    await expect(
      runRuntimeCommand(["ephemeral-child", "--path", "outside.json"]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"outside-ephemeral","message":"path must be a direct child under .ephemeral"}\n',
    });
  });

  it("rejects POSIX backslashes before accepting ephemeral children", async () => {
    await expect(
      runRuntimeCommand([
        "ephemeral-child",
        "--path",
        ".ephemeral\\result.json",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-separator","message":"path must use POSIX separators"}\n',
    });
  });

  it("fails malformed command envelopes", async () => {
    await expect(
      runRuntimeCommand([
        "validate-json",
        "--schema",
        "command-envelope",
        "--payload",
        '{"notCommand":true}',
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-command-envelope","message":"command is required"}\n',
    });
  });

  it("fails invalid JSON command envelopes", async () => {
    await expect(
      runRuntimeCommand([
        "validate-json",
        "--schema",
        "command-envelope",
        "--payload",
        "{",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-json","message":"payload must be valid JSON"}\n',
    });
  });

  it("rejects unknown path platforms with stable stderr JSON", async () => {
    await expect(
      runRuntimeCommand([
        "path-info",
        "--path",
        "/tmp/result.json",
        "--platform",
        "plan9",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"runtime-error","message":"unknown platform: plan9"}\n',
    });
  });

  it("routes source-immutability command parsing failures with plain stderr", async () => {
    await expect(
      runRuntimeCommand(["source-immutability", "verify"]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "verify requires --baseline\n",
    });
  });

  it("rejects duplicate source-immutability handoff declarations", async () => {
    await expect(
      runRuntimeCommand([
        "source-immutability",
        "capture",
        "--handoff",
        ".ephemeral/one.json",
        "--handoff",
        ".ephemeral/two.json",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "--handoff may be supplied only once\n",
    });
  });
});
