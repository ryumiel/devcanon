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

const expectedHelpers = [
  "branch-review/prepare-review-inputs",
  "branch-review/scope-decision-artifacts",
  "git-workspace-cleanup/git-workspace-cleanup",
  "issue-priming-workflow/phase-artifacts",
  "issue-priming-workflow/source-immutability",
  "issue-priming-workflow/write-assumptions-comment",
  "issue-priming-workflow/write-auto-handoff",
  "issue-priming-workflow/write-research-brief",
  "issue-worktree-setup/setup-worktree",
  "play-agent-dispatch/source-immutability",
  "play-branch-finish/branch-review-approval-gate",
  "play-debug/find-polluter",
  "play-planning/source-immutability",
  "play-review/review-artifacts",
  "play-review/shared-review-context",
  "play-review/source-immutability",
  "play-skill-authoring/source-immutability",
  "play-subagent-execution/source-immutability",
  "play-subagent-execution/validate-snapshot-manifest",
  "play-subagent-execution/write-risk-signals",
  "play-subagent-execution/write-snapshot-manifest",
  "pr-merge/post-merge-cleanup",
  "pr-merge/preflight-worktree-context",
  "pr-merge/source-immutability",
  "pr-review/approved-review-artifacts",
  "pr-review/prior-thread-artifacts",
  "pr-review/review-leases",
  "pr-review/review-manifests",
  "write-linear-project-description/prepare-project-description-draft",
];

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

function validateRows(rows: readonly CatalogRow[]): void {
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
    if (row.owningSkill !== skill)
      throw new Error(`owning skill mismatch: ${row.owningSkill}`);
    if (row.usageDocument !== `skills/${skill}/references/${stem}-usage.md`) {
      throw new Error(`usage document owner mismatch: ${row.usageDocument}`);
    }
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

describe("public helper registry", () => {
  test("catalogs exactly the approved helpers with adjacent readable contracts", async () => {
    const rows = catalogRows(await readFile(catalogPath, "utf8"));

    validateRows(rows);
    expect(rows).toHaveLength(29);
    expect(rows.map((row) => row.helperId).sort()).toEqual(expectedHelpers);

    await assertExistingSources(rows);
    for (const row of rows) {
      const usage = await readFile(
        path.join(repositoryRoot, row.usageDocument),
        "utf8",
      );
      for (const heading of [
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

    expect(() => validateRows([valid, { ...valid }])).toThrow(
      "duplicate helper ID",
    );
    expect(() =>
      validateRows([
        valid,
        { ...valid, helperId: "example-skill/other-helper" },
      ]),
    ).toThrow("duplicate executable path");
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
  });

  test("rejects a catalog row whose declared source does not exist", async () => {
    await expect(
      assertExistingSources([
        {
          helperId: "example-skill/example-helper",
          role: "An example deterministic action.",
          owningSkill: "example-skill",
          executable: "skills/example-skill/scripts/missing-helper.sh",
          usageDocument:
            "skills/example-skill/references/example-helper-usage.md",
        },
      ]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
