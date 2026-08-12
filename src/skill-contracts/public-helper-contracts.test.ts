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

const requiredUsageHeadings = [
  "## Role",
  "## Invocation",
  "## Inputs",
  "## Working directory",
  "## Outputs",
  "## Refusal and failures",
  "## Side effects",
  "## Workflow boundary",
] as const;

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

function markdownLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
}

function assertRequiredUsageHeadings(usage: string): void {
  const headings = new Set(usage.split("\n"));
  for (const heading of requiredUsageHeadings) {
    if (!headings.has(heading)) {
      throw new Error(`required usage section missing: ${heading}`);
    }
  }
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

async function assertOwningSkillUsageLinks(
  rows: readonly CatalogRow[],
): Promise<void> {
  for (const row of rows) {
    const skill = await readFile(
      path.join(repositoryRoot, "skills", row.owningSkill, "SKILL.md"),
      "utf8",
    );
    const usageName = path.posix.basename(row.usageDocument);
    if (!markdownLinkTargets(skill).includes(`references/${usageName}`)) {
      throw new Error(`owning SKILL usage link missing: ${row.helperId}`);
    }
  }
}

describe("public helper registry", () => {
  test("catalogs structurally valid public helpers with adjacent readable contracts", async () => {
    const rows = catalogRows(await readFile(catalogPath, "utf8"));

    validateRows(rows);
    expect(rows).toContainEqual(
      expect.objectContaining({
        helperId: "issue-worktree-setup/setup-worktree",
        executable: "skills/issue-worktree-setup/scripts/setup-worktree.mjs",
      }),
    );
    expect(rows.map((row) => row.executable)).not.toContain(
      "skills/issue-worktree-setup/scripts/setup-worktree.sh",
    );
    expect(
      await readFile(
        path.join(repositoryRoot, "skills/issue-worktree-setup/SKILL.md"),
        "utf8",
      ),
    ).toContain(
      'node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs" --help',
    );
    for (const excluded of [
      "skills/devcanon-runtime/scripts/",
      "skills/play-skill-authoring/scripts/render-graphs.js",
      "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
    ]) {
      expect(rows.some((row) => row.executable.startsWith(excluded))).toBe(
        false,
      );
    }

    await assertExistingSources(rows);
    await assertUsageBacklinks(rows);
    await assertOwningSkillUsageLinks(rows);
    for (const row of rows) {
      const usage = await readFile(
        path.join(repositoryRoot, row.usageDocument),
        "utf8",
      );
      assertRequiredUsageHeadings(usage);
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

  test("rejects malformed required usage-section headings", () => {
    const malformed = requiredUsageHeadings
      .map((heading) => (heading === "## Role" ? "## Roleplay" : heading))
      .join("\n");

    expect(() => assertRequiredUsageHeadings(malformed)).toThrow(
      "required usage section missing: ## Role",
    );
  });
});
