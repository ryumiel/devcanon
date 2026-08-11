import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const catalogPath = path.join(repositoryRoot, "contracts/public-helpers.md");

type CatalogRow = {
  helperId: string;
  role: string;
  owningSkill: string;
  executable: string;
  usageDocument: string;
};

const approvedExecutableById = {
  "branch-review/prepare-review-inputs":
    "skills/branch-review/scripts/prepare-review-inputs.sh",
  "branch-review/scope-decision-artifacts":
    "skills/branch-review/scripts/scope-decision-artifacts.sh",
  "git-workspace-cleanup/git-workspace-cleanup":
    "skills/git-workspace-cleanup/scripts/git-workspace-cleanup.sh",
  "issue-priming-workflow/phase-artifacts":
    "skills/issue-priming-workflow/scripts/phase-artifacts.sh",
  "issue-priming-workflow/source-immutability":
    "skills/issue-priming-workflow/scripts/source-immutability.sh",
  "issue-priming-workflow/write-assumptions-comment":
    "skills/issue-priming-workflow/scripts/write-assumptions-comment.sh",
  "issue-priming-workflow/write-auto-handoff":
    "skills/issue-priming-workflow/scripts/write-auto-handoff.sh",
  "issue-priming-workflow/write-research-brief":
    "skills/issue-priming-workflow/scripts/write-research-brief.sh",
  "issue-worktree-setup/setup-worktree":
    "skills/issue-worktree-setup/scripts/setup-worktree.mjs",
  "play-agent-dispatch/source-immutability":
    "skills/play-agent-dispatch/scripts/source-immutability.sh",
  "play-branch-finish/branch-review-approval-gate":
    "skills/play-branch-finish/scripts/branch-review-approval-gate.sh",
  "play-debug/find-polluter": "skills/play-debug/scripts/find-polluter.sh",
  "play-planning/source-immutability":
    "skills/play-planning/scripts/source-immutability.sh",
  "play-review/review-artifacts":
    "skills/play-review/scripts/review-artifacts.sh",
  "play-review/shared-review-context":
    "skills/play-review/scripts/shared-review-context.sh",
  "play-review/source-immutability":
    "skills/play-review/scripts/source-immutability.sh",
  "play-skill-authoring/source-immutability":
    "skills/play-skill-authoring/scripts/source-immutability.sh",
  "play-subagent-execution/source-immutability":
    "skills/play-subagent-execution/scripts/source-immutability.sh",
  "play-subagent-execution/validate-snapshot-manifest":
    "skills/play-subagent-execution/scripts/validate-snapshot-manifest.sh",
  "play-subagent-execution/write-risk-signals":
    "skills/play-subagent-execution/scripts/write-risk-signals.sh",
  "play-subagent-execution/write-snapshot-manifest":
    "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
  "pr-merge/post-merge-cleanup":
    "skills/pr-merge/scripts/post-merge-cleanup.sh",
  "pr-merge/preflight-worktree-context":
    "skills/pr-merge/scripts/preflight-worktree-context.sh",
  "pr-merge/source-immutability":
    "skills/pr-merge/scripts/source-immutability.sh",
  "pr-review/approved-review-artifacts":
    "skills/pr-review/scripts/approved-review-artifacts.sh",
  "pr-review/prior-thread-artifacts":
    "skills/pr-review/scripts/prior-thread-artifacts.sh",
  "pr-review/review-leases": "skills/pr-review/scripts/review-leases.sh",
  "pr-review/review-manifests": "skills/pr-review/scripts/review-manifests.sh",
  "write-linear-project-description/prepare-project-description-draft":
    "skills/write-linear-project-description/scripts/prepare-project-description-draft.sh",
} as const;

const expectedHelpers = Object.keys(approvedExecutableById).sort();

const approvedRoleById = {
  "branch-review/prepare-review-inputs":
    "Prepares branch-review inputs and scope-decision inputs.",
  "branch-review/scope-decision-artifacts":
    "Validates and writes branch-review scope decisions.",
  "git-workspace-cleanup/git-workspace-cleanup":
    "Cleans managed Git worktrees and branches.",
  "issue-priming-workflow/phase-artifacts":
    "Guards issue-priming phase artifact reads.",
  "issue-priming-workflow/source-immutability":
    "Runs issue-priming source-immutability lifecycle operations.",
  "issue-priming-workflow/write-assumptions-comment":
    "Prepares an assumptions-comment artifact target.",
  "issue-priming-workflow/write-auto-handoff":
    "Writes a validated automatic-handoff artifact.",
  "issue-priming-workflow/write-research-brief":
    "Prepares a research-brief artifact target.",
  "issue-worktree-setup/setup-worktree":
    "Sets up an issue worktree through the native adapter.",
  "play-agent-dispatch/source-immutability":
    "Runs dispatch source-immutability lifecycle operations.",
  "play-branch-finish/branch-review-approval-gate":
    "Evaluates branch-review approval-gate inputs.",
  "play-debug/find-polluter": "Locates the test that pollutes a target.",
  "play-planning/source-immutability":
    "Runs planning source-immutability lifecycle operations.",
  "play-review/review-artifacts":
    "Manages validated review artifact operations.",
  "play-review/shared-review-context":
    "Builds shared review-context artifacts.",
  "play-review/source-immutability":
    "Runs review source-immutability lifecycle operations.",
  "play-skill-authoring/source-immutability":
    "Runs skill-authoring source-immutability lifecycle operations.",
  "play-subagent-execution/source-immutability":
    "Runs subagent source-immutability lifecycle operations.",
  "play-subagent-execution/validate-snapshot-manifest":
    "Validates an implementer snapshot manifest.",
  "play-subagent-execution/write-risk-signals":
    "Writes a validated branch-review risk-signals artifact.",
  "play-subagent-execution/write-snapshot-manifest":
    "Writes an implementer snapshot manifest.",
  "pr-merge/post-merge-cleanup": "Cleans local state after a verified merge.",
  "pr-merge/preflight-worktree-context": "Reports merge worktree context.",
  "pr-merge/source-immutability":
    "Runs merge source-immutability lifecycle operations.",
  "pr-review/approved-review-artifacts":
    "Validates and materializes approved review artifacts.",
  "pr-review/prior-thread-artifacts":
    "Manages prior-thread and scope-decision artifacts.",
  "pr-review/review-leases": "Manages PR-review lease lifecycle operations.",
  "pr-review/review-manifests":
    "Manages PR-review handoff and result manifests.",
  "write-linear-project-description/prepare-project-description-draft":
    "Prepares a Linear project-description draft target.",
} as const;

function catalogRows(markdown: string): CatalogRow[] {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) =>
    equalCells(line, [
      "Helper ID",
      "Role",
      "Owning skill",
      "Executable",
      "Usage contract",
    ]),
  );
  if (headerIndex < 0)
    throw new Error("public helper catalog header is missing");

  const rows: CatalogRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 5)
      throw new Error("public helper catalog rows require five fields");
    rows.push({
      helperId: cells[0],
      role: cells[1],
      owningSkill: cells[2],
      executable: catalogRelativeTarget(markdownLinkTarget(cells[3])),
      usageDocument: catalogRelativeTarget(markdownLinkTarget(cells[4])),
    });
  }
  return rows;
}

function equalCells(line: string, expected: readonly string[]): boolean {
  return (
    line.startsWith("|") &&
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
      .every((cell, index) => cell === expected[index]) &&
    line.split("|").length - 2 === expected.length
  );
}

function catalogRelativeTarget(target: string): string {
  return path.posix.normalize(path.posix.join("contracts", target));
}

function markdownLinkTarget(value: string): string {
  const match = /^\[[^\]]+\]\(([^)]+)\)$/.exec(value);
  if (!match) throw new Error(`expected a Markdown link, got: ${value}`);
  return match[1];
}

function validateRows(
  rows: readonly CatalogRow[],
  expectedExecutables?: Readonly<Record<string, string>>,
): void {
  const helperIds = new Set<string>();
  const executablePaths = new Set<string>();
  for (const row of rows) {
    if (
      !row.helperId ||
      !row.role ||
      !row.owningSkill ||
      !row.executable ||
      !row.usageDocument
    ) {
      throw new Error(
        "public helper catalog rows require five non-empty fields",
      );
    }
    if (helperIds.has(row.helperId))
      throw new Error(`duplicate helper ID: ${row.helperId}`);
    if (executablePaths.has(row.executable))
      throw new Error(`duplicate executable path: ${row.executable}`);
    helperIds.add(row.helperId);
    executablePaths.add(row.executable);

    const [skill, stem] = row.helperId.split("/");
    if (!skill || !stem || row.helperId !== `${skill}/${stem}`)
      throw new Error(`invalid helper ID: ${row.helperId}`);
    if (!row.executable.startsWith(`skills/${skill}/scripts/${stem}.`))
      throw new Error(`executable owner mismatch: ${row.executable}`);
    if (
      expectedExecutables &&
      expectedExecutables[row.helperId] !== row.executable
    ) {
      throw new Error(`unexpected executable mapping: ${row.helperId}`);
    }
    if (row.owningSkill !== skill)
      throw new Error(`owning skill mismatch: ${row.owningSkill}`);
    if (row.usageDocument !== `skills/${skill}/references/${stem}-usage.md`) {
      throw new Error(`usage document owner mismatch: ${row.usageDocument}`);
    }
  }
}

function assertUniqueRows(
  rows: readonly Pick<CatalogRow, "helperId" | "executable">[],
): void {
  const helperIds = new Set<string>();
  const executablePaths = new Set<string>();
  for (const row of rows) {
    if (helperIds.has(row.helperId))
      throw new Error(`duplicate helper ID: ${row.helperId}`);
    if (executablePaths.has(row.executable))
      throw new Error(`duplicate executable path: ${row.executable}`);
    helperIds.add(row.helperId);
    executablePaths.add(row.executable);
  }
}

async function assertReadable(relativePath: string): Promise<void> {
  await access(path.join(repositoryRoot, relativePath));
}

async function assertExistingSources(
  rows: readonly CatalogRow[],
): Promise<void> {
  for (const row of rows) {
    await assertReadable(row.executable);
    await assertReadable(row.usageDocument);
    expect(
      (await stat(path.join(repositoryRoot, row.executable))).isFile(),
    ).toBe(true);
    expect(
      (await stat(path.join(repositoryRoot, row.usageDocument))).isFile(),
    ).toBe(true);
  }
}

async function assertUsageBacklinks(
  rows: readonly CatalogRow[],
  loadUsage = async (row: CatalogRow) =>
    readFile(path.join(repositoryRoot, row.usageDocument), "utf8"),
): Promise<void> {
  for (const row of rows) {
    const usage = await loadUsage(row);
    if (!/\[[^\]]+\]\(\.\.\/SKILL\.md\)/.test(usage)) {
      throw new Error(`owning SKILL backlink missing: ${row.helperId}`);
    }
  }
}

describe("public helper registry", () => {
  test("catalogs exactly the approved helpers with adjacent readable contracts", async () => {
    const rows = catalogRows(await readFile(catalogPath, "utf8"));

    validateRows(rows, approvedExecutableById);
    expect(rows).toHaveLength(29);
    expect(rows.map((row) => row.helperId).sort()).toEqual(expectedHelpers);
    expect(
      Object.fromEntries(rows.map((row) => [row.helperId, row.executable])),
    ).toEqual(approvedExecutableById);
    expect(
      rows.map((row) => [
        row.helperId,
        row.role,
        row.owningSkill,
        row.executable,
        row.usageDocument,
      ]),
    ).toEqual(
      expectedHelpers.map((helperId) => {
        const [owningSkill, stem] = helperId.split("/");
        return [
          helperId,
          approvedRoleById[helperId as keyof typeof approvedRoleById],
          owningSkill,
          approvedExecutableById[
            helperId as keyof typeof approvedExecutableById
          ],
          `skills/${owningSkill}/references/${stem}-usage.md`,
        ];
      }),
    );

    await assertExistingSources(rows);
    await assertUsageBacklinks(rows);
    for (const row of rows) {
      const usage = await readFile(
        path.join(repositoryRoot, row.usageDocument),
        "utf8",
      );
      for (const heading of [
        "## Role",
        "## Invocation",
        "## Inputs",
        "## Working directory",
        "## Outputs",
        "## Refusal and failures",
        "## Side effects",
        "## Workflow boundary",
      ]) {
        expect(usage).toContain(heading);
      }
      expect(usage).not.toMatch(
        /<operation>|documented environment|operation-specific/,
      );
    }
  });

  test("rejects duplicate identities, locations, and owner-mismatched rows", () => {
    const valid: CatalogRow = {
      helperId: "example-skill/example-helper",
      role: "An example deterministic action.",
      owningSkill: "example-skill",
      executable: "skills/example-skill/scripts/example-helper.sh",
      usageDocument: "skills/example-skill/references/example-helper-usage.md",
    };

    expect(() =>
      assertUniqueRows([
        valid,
        {
          ...valid,
          executable: "skills/example-skill/scripts/example-helper.mjs",
        },
      ]),
    ).toThrow("duplicate helper ID");
    expect(() =>
      assertUniqueRows([
        valid,
        {
          helperId: "example-skill/other-helper",
          executable: valid.executable,
        },
      ]),
    ).toThrow("duplicate executable path");
    expect(() => validateRows([{ ...valid, role: "" }])).toThrow(
      "five non-empty fields",
    );
    expect(() =>
      validateRows([
        {
          ...valid,
          executable: "skills/other-skill/scripts/example-helper.sh",
        },
      ]),
    ).toThrow("executable owner mismatch");
    expect(() =>
      validateRows([
        {
          ...valid,
          usageDocument:
            "skills/other-skill/references/example-helper-usage.md",
        },
      ]),
    ).toThrow("usage document owner mismatch");
    expect(() =>
      validateRows([{ ...valid, owningSkill: "other-skill" }]),
    ).toThrow("owning skill mismatch");
    expect(() =>
      validateRows(
        [
          {
            ...valid,
            helperId: "issue-worktree-setup/setup-worktree",
            owningSkill: "issue-worktree-setup",
            executable: "skills/issue-worktree-setup/scripts/setup-worktree.sh",
            usageDocument:
              "skills/issue-worktree-setup/references/setup-worktree-usage.md",
          },
        ],
        approvedExecutableById,
      ),
    ).toThrow("unexpected executable mapping");
  });

  test("rejects a catalog row whose executable source does not exist", async () => {
    const valid = (await catalogRows(await readFile(catalogPath, "utf8"))).find(
      (row) => row.helperId === "play-debug/find-polluter",
    );
    if (!valid)
      throw new Error("expected play-debug/find-polluter catalog row");

    await expect(
      assertExistingSources([
        {
          ...valid,
          executable: "skills/play-debug/scripts/missing-polluter.sh",
        },
      ]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a catalog row whose usage document does not exist", async () => {
    const valid = (await catalogRows(await readFile(catalogPath, "utf8"))).find(
      (row) => row.helperId === "play-debug/find-polluter",
    );
    if (!valid)
      throw new Error("expected play-debug/find-polluter catalog row");

    await expect(
      assertExistingSources([
        {
          ...valid,
          usageDocument:
            "skills/play-debug/references/missing-polluter-usage.md",
        },
      ]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects missing and wrong owning-SKILL backlinks independently", async () => {
    const valid = (await catalogRows(await readFile(catalogPath, "utf8")))[0];

    await expect(
      assertUsageBacklinks([valid], async () => "# Usage\n"),
    ).rejects.toThrow("owning SKILL backlink missing");
    await expect(
      assertUsageBacklinks(
        [valid],
        async () => "[Wrong skill](../other-skill/SKILL.md)\n",
      ),
    ).rejects.toThrow("owning SKILL backlink missing");
  });
});
