import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  readRepoFile,
} from "../__test-helpers__/skill-contracts.js";

const projectionFields = [
  "Entry ID",
  "Affected surface or equivalent set",
  "Owner/source",
  "Mode",
  "Implementation disposition",
  "Proof",
] as const;

const recordReferenceFields = [
  "Boundary rows",
  "Supporting-owner supplements",
] as const;

function numberedFieldLabels(section: string): string[] {
  return [...section.matchAll(/^\d+\. `([^`]+)`:/gm)].map((match) => match[1]);
}

function canonicalReferenceBlock(markdown: string): string {
  const block = [...markdown.matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)]
    .map((match) => match[1])
    .find((candidate) =>
      recordReferenceFields.every((field) =>
        candidate.includes(`**${field}:**`),
      ),
    );

  if (!block) {
    throw new Error("canonical record-reference block not found");
  }
  return block;
}

function canonicalTaskFieldCounts(markdown: string): Record<string, number> {
  return Object.fromEntries(
    recordReferenceFields.map((field) => [
      field,
      [...markdown.matchAll(new RegExp(`^\\*\\*${field}:\\*\\*`, "gm"))].length,
    ]),
  );
}

function boldFieldLabels(markdown: string): string[] {
  return [...markdown.matchAll(/^\*\*([^*\r\n]+):\*\*/gm)].map(
    (match) => match[1],
  );
}

describe("play-planning execution projection contract", () => {
  it("keeps one exact six-field projection structure", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const projection = getMarkdownSection(
      criteria,
      "Contract and traceability criteria",
    );

    expect(numberedFieldLabels(projection)).toEqual(projectionFields);
  });

  it("rejects drift in the source-owned projection field structure", async () => {
    const criteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const projection = getMarkdownSection(
      criteria,
      "Contract and traceability criteria",
    );
    const missingAuthority = projection.replace(
      "3. `Owner/source`:",
      "3. `Reference`:",
    );

    expect(numberedFieldLabels(missingAuthority)).not.toEqual(projectionFields);
  });

  it("keeps one of each record-reference field in canonical task blocks", async () => {
    const [skill, criteria, execution] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of [skill, criteria, execution]) {
      const block = canonicalReferenceBlock(source);
      expect(canonicalTaskFieldCounts(block)).toEqual({
        "Boundary rows": 1,
        "Supporting-owner supplements": 1,
      });

      const missing = block.replace(/^\*\*Boundary rows:\*\*.*\r?\n/m, "");
      expect(canonicalTaskFieldCounts(missing)["Boundary rows"]).toBe(0);

      const duplicated = `${block}\n**Supporting-owner supplements:** []`;
      expect(
        canonicalTaskFieldCounts(duplicated)["Supporting-owner supplements"],
      ).toBe(2);
    }
  });

  it("keeps reference-field ordering non-semantic across planning owners", async () => {
    const [skill, criteria] = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
    ]);

    for (const source of [skill, criteria]) {
      const block = canonicalReferenceBlock(source);
      const reversed = block.split(/\r?\n/).reverse().join("\n");
      expect(canonicalTaskFieldCounts(reversed)).toEqual(
        canonicalTaskFieldCounts(block),
      );
    }
  });

  it("removes repeated prose selectors from planning and execution contracts", async () => {
    const sources = await Promise.all([
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile("skills/play-planning/references/planning-criteria.md"),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const source of sources) {
      expect(source).not.toContain("supporting-owner supplement <Entry ID>");
      expect(source).not.toContain("boundary row <stable row ID>");
    }
  });

  it("keeps tier and reference fields in the canonical planning task block", async () => {
    const block = canonicalReferenceBlock(
      await readRepoFile("skills/play-planning/SKILL.md"),
    );

    expect(boldFieldLabels(block)).toEqual(
      expect.arrayContaining([
        "Task ID",
        "Boundary rows",
        "Supporting-owner supplements",
        "Contract tier",
        "Compact contract",
      ]),
    );
  });

  it("uses distinct structural examples for both record-reference kinds", async () => {
    const block = canonicalReferenceBlock(
      await readRepoFile(
        "skills/play-planning/references/planning-criteria.md",
      ),
    );
    const boundaryRows = block.match(/^\*\*Boundary rows:\*\* (.+)$/m)?.[1];
    const supplements = block.match(
      /^\*\*Supporting-owner supplements:\*\* (.+)$/m,
    )?.[1];

    expect(JSON.parse(boundaryRows ?? "null")).toEqual(["BR-A", "BR-B"]);
    expect(JSON.parse(supplements ?? "null")).toEqual(["EP-SUPPORTING-OWNERS"]);
  });

  it("keeps controller refusal and compatibility tokens without a resolver surface", async () => {
    const execution = await readRepoFile(
      "skills/play-subagent-execution/SKILL.md",
    );

    expect(execution).toContain("`BLOCKED/NEEDS_CONTEXT`");
    expect(execution).toContain("inspect-plan-projection.sh --path");
    expect(execution).toContain("`planning-projection/v1`");
    expect(execution).not.toContain("resolve-task-records.mjs");
    expect(execution).not.toContain("task-record-resolution/v1");
  });

  it("adopts the runtime projection only after path guards and digest verification", async () => {
    const execution = await readRepoFile(
      "skills/play-subagent-execution/SKILL.md",
    );
    const digestGate = execution.indexOf(
      "Only after the digest comparison passes",
    );
    const helperGate = execution.lastIndexOf(
      "`inspect-plan-projection.sh --path <repo-relative-plan-path>`",
    );

    expect(digestGate).toBeGreaterThanOrEqual(0);
    expect(helperGate).toBeGreaterThan(digestGate);
    expect(execution).toContain("closed `planning-projection/v1` success");
    expect(execution).toMatch(
      /zero-status malformed or unknown success or\s+inconsistent result/u,
    );
  });

  it("keeps the path-backed success envelope closed before controller consumption", async () => {
    const [usage, execution] = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/inspect-plan-projection-usage.md",
      ),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);
    const requiredContractTerms = [
      "exactly one newline-terminated JSON object on stdout",
      "empty stderr, and status 0",
      "`schema`, `plan_path`, `projection`, and `tasks`",
      "`planning-projection/v1`",
      "exactly equals the guarded repository-relative path",
      "`start`, `end`, and `entries`",
      "`entry_id`, `affected_surfaces`, `owner_source`, `mode`, `implementation_task_ids`, `no_code_reason`, `proof`, `start`, and `end`",
      "`owner_source` is a nonempty string",
      "`owner_type`, `owner`, and `boundary`",
      "`task_id`, `heading`, `start`, and `end`",
      "unique nonempty `entry_id`",
      "unique nonempty `task_id`",
      "nonempty unique strings",
      "`authority`, `reference`, `derived representation`, `non-normative summary`, or `verification`",
      "`task`, `reviewer`, or `controller`",
      "nonempty unique task IDs with `no_code_reason: null`",
      "empty task-ID array with a nonempty no-code reason",
      "resolve exactly once against `tasks`",
      "nonnegative integers",
    ];

    for (const original of [usage, execution]) {
      const source = original.replace(/\s+/gu, " ");
      for (const term of requiredContractTerms) {
        expect(source).toContain(term);
      }
    }
  });

  it("blocks zero-status malformed and channel-violating path-backed success before every consumer", async () => {
    const [usage, execution] = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/inspect-plan-projection-usage.md",
      ),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);

    for (const original of [usage, execution]) {
      const source = original.replace(/\s+/gu, " ");
      expect(source).toContain("zero-status malformed or unknown success");
      expect(source).toContain("extra stdout bytes");
      expect(source).toContain("nonempty success stderr");
      expect(source).toContain("`BLOCKED/NEEDS_CONTEXT`");
      expect(source).toContain("no repair, fallback, or partial use");
    }
    expect(execution.replace(/\s+/gu, " ")).toContain(
      "before skip evaluation, inline execution, implementer/reviewer dispatch, or final review",
    );
  });

  it("keeps identifier, surface, and range parity in the path-backed result contract", async () => {
    const [usage, execution] = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/inspect-plan-projection-usage.md",
      ),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
    ]);
    const requiredConstraints = [
      "UPPER-ASCII-KEBAB grammar",
      "`^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`",
      "nonempty array of nonempty unique strings",
      "zero-based, end-exclusive integer offsets",
      "`0 <= projection.start < projection.end <= input.length`",
      "`projection.start <= entry.start < entry.end <= projection.end`",
      "`0 <= task.start < task.end <= input.length`",
      "bad identifier, empty affected surfaces, or invalid range",
    ];

    for (const original of [usage, execution]) {
      const source = original.replace(/\s+/gu, " ");
      for (const constraint of requiredConstraints) {
        expect(source).toContain(constraint);
      }
      expect(source).toContain("`BLOCKED/NEEDS_CONTEXT`");
    }
    expect(usage.replace(/\s+/gu, " ")).toContain(
      "before every path-backed consumer",
    );
    expect(execution.replace(/\s+/gu, " ")).toContain(
      "before skip evaluation, inline execution, implementer/reviewer dispatch, or final review",
    );
  });

  it("documents exact source spans and the closed runtime failure contract", async () => {
    const usage = (
      await readRepoFile(
        "skills/play-subagent-execution/references/inspect-plan-projection-usage.md",
      )
    ).replace(/\s+/gu, " ");
    const spanTerms = [
      "`projection.start` is the start offset of the literal `## Execution Projection` H2 heading",
      "`projection.end` is the start offset of the peer `## Tasks` H2 heading, excluding that terminator",
      "Each entry's `start` and `end` are the mdast `listItem.position` offsets for the complete projection entry",
      "Each task's `start` is the start offset of its canonical `### Task` H3 heading",
      "its `end` is the start offset of the next canonical Task H3 or the first following H2 section, whichever comes first; otherwise it is `input.length`",
    ];
    const failureCodes = [
      "plan-path-invalid",
      "plan-unreadable",
      "execution-projection-missing",
      "execution-projection-duplicate",
      "tasks-section-missing",
      "task-heading-before-tasks",
      "projection-entry-missing",
      "projection-entry-field-invalid",
      "entry-id-duplicate",
      "task-id-invalid",
      "task-id-duplicate",
      "task-reference-unknown",
    ];

    for (const term of spanTerms) expect(usage).toContain(term);
    for (const code of failureCodes) expect(usage).toContain(`\`${code}\``);
    expect(usage).toContain(
      "Failure from the typed runtime operation writes nothing to stdout, writes exactly one newline-terminated JSON object with exactly `ok: false`, `code`, and `message` to stderr, and exits nonzero",
    );
    expect(usage).toContain("first finding in source order");
    expect(usage).toContain("does not constrain message prose");
    expect(usage).toContain("does not define precedence for equal offsets");
  });

  it("preserves direct-inline intake and controller-owned record resolution", async () => {
    const execution = await readRepoFile(
      "skills/play-subagent-execution/SKILL.md",
    );
    const inlineStart = execution.indexOf(
      "### Inline content (preserved for direct invocations)",
    );
    const inline = execution.slice(inlineStart);

    expect(inlineStart).toBeGreaterThanOrEqual(0);
    expect(inline).not.toContain("inspect-plan-projection");
    expect(execution).toContain(
      "each field only against\nits declared record kind",
    );
    expect(execution).toContain(
      "Do not\ndiscover records merely because they mention a selected Entry ID",
    );
  });

  it("links the proportionality ADR from navigation and its execution consumer", async () => {
    const [map, skipDispatch] = await Promise.all([
      readRepoFile("MAP.md"),
      readRepoFile(
        "docs/adr/adr-0015-skip-dispatch-for-trivial-single-task-plans.md",
      ),
    ]);
    const adrPath =
      "docs/adr/adr-0035-behavioral-planning-contract-proportionality.md";

    expect(map).toContain(`(${adrPath})`);
    expect(skipDispatch).toContain("ADR-0035");
  });
});
