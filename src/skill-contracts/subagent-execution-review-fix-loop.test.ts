import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const LIFECYCLE =
  "skills/play-subagent-execution/references/lifecycle-status-policy.md";
const PROPORTIONALITY =
  "skills/play-review-response/references/finding-proportionality.md";

const REVIEW_GATE_CONTRACT = [
  "Only after this separation, preview, classification, current contract/head/route\nvalidation, and limit decision may authorized incremental context reach D12\nthrough the existing compatible-session or fresh-child route.",
  "separate-work non-mutating caller handoff",
  "Round 3 returns existing `BLOCKED`",
  "finding-bound, current-head/current-route/current-contract/current-evidence,\nsingle-use.",
  "Cosmetic wording or still-unauthorized evidence cannot reset or\ndispatch.",
  "no earlier verdict\nsurvives.",
];

function assertReviewGateContract(source: string): void {
  for (const anchor of REVIEW_GATE_CONTRACT) {
    expect(source).toContain(anchor);
  }
}

describe("subagent-execution review-fix loop owner", () => {
  it("consumes the portable four-way policy before D12 and retains bounded preview evidence", async () => {
    const [lifecycle, proportionality] = await Promise.all([
      readRepoFile(LIFECYCLE),
      readRepoFile(PROPORTIONALITY),
    ]);

    expect(lifecycle).toContain(
      "../../play-review-response/references/finding-proportionality.md",
    );
    expect(lifecycle).toContain(
      "Writing Skills remains the sole classification authority",
    );
    expect(proportionality).toContain("classify it as exactly one of:");

    for (const key of [
      "authoritative contract anchor",
      "reachable production path and meaningful bad outcome",
      "proposed files or modules",
      "new state or lifecycle ownership",
      "behavior changed or disabled",
      "proof and test growth",
      "why the existing correctness owner is insufficient, or that it remains",
    ]) {
      expect(lifecycle).toContain(key);
    }

    const join = lifecycle.indexOf("Join same-head results");
    const preview = lifecycle.indexOf("impact preview");
    const d12 = lifecycle.indexOf("Only after this separation");
    expect(join).toBeGreaterThanOrEqual(0);
    expect(preview).toBeGreaterThan(join);
    expect(d12).toBeGreaterThan(preview);
  });

  it("separates the four dispositions and fails unclear authority closed", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    for (const disposition of [
      "smallest authorized",
      "production correction.",
      "existing proof owner",
      "separate-work non-mutating caller handoff",
      "concise rejection and no",
    ]) {
      expect(lifecycle).toContain(disposition);
    }
    expect(lifecycle).toContain("Unclear classification or authority is a");
    expect(lifecycle).toContain("gate failure returning existing `BLOCKED`");
    expect(lifecycle).toContain("separate dispositions before");
    expect(lifecycle).toContain("mixed sets cannot carry unauthorized work");
  });

  it("counts only authorized correction waves and blocks the third before D12", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    expect(lifecycle).toContain(
      "requires an authorized production or proof correction.",
    );
    expect(lifecycle).toContain("existing current-episode fixup count `0`,");
    expect(lifecycle).toContain(
      "`1`, or `2` makes the newly observed failed wave",
    );
    expect(lifecycle).toContain("Record the failed wave before deciding");
    expect(lifecycle).toContain("Rounds 1 and 2 may each permit one");
    expect(lifecycle).toContain("Round 3 returns existing `BLOCKED`");
    expect(lifecycle).toContain("`review-loop-limit`");
    expect(lifecycle).toContain("changed SHA");
    expect(lifecycle).toContain("alone is not new evidence");
  });

  it("keeps single-use approval and materially revised-contract resumption bounded", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    expect(lifecycle).toContain(
      "finding-bound, current-head/current-route/current-contract/current-evidence,",
    );
    expect(lifecycle).toContain(
      "It authorizes exactly one identified D12 attempt without clearing",
    );
    expect(lifecycle).toContain("stale approval cannot revive");
    expect(lifecycle).toContain(
      "Revised-contract resumption instead requires material authoritative scope or",
    );
    expect(lifecycle).toContain(
      "acceptance change, refreshed extracted context",
    );
    expect(lifecycle).toContain("refreshed extracted context");
    expect(lifecycle).toContain("structural contract validation");
    expect(lifecycle).toContain(
      "reset only existing current-episode fixup count to `0`",
    );
    expect(lifecycle).toContain(
      "Cosmetic wording or still-unauthorized evidence cannot reset or",
    );
  });

  it("rejects one-dimensional mutations at the lifecycle owner's review gates", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    assertReviewGateContract(lifecycle);

    const mutants = [
      lifecycle.replace(
        "Only after this separation, preview, classification, current contract/head/route\nvalidation, and limit decision may authorized incremental context reach D12\nthrough the existing compatible-session or fresh-child route.",
        "Only after this separation, classification, current contract/head/route\nvalidation, and limit decision may authorized incremental context reach D12\nthrough the existing compatible-session or fresh-child route.",
      ),
      lifecycle.replace(
        "receives a concise\n  separate-work non-mutating caller handoff.",
        "may enter the active-task fix.",
      ),
      lifecycle.replace(
        "Round 3 returns existing `BLOCKED`",
        "Round 3 may permit one bounded fix",
      ),
      lifecycle.replace("single-use.", "reusable."),
      lifecycle.replace(
        "Cosmetic wording or still-unauthorized evidence cannot reset or\ndispatch.",
        "Cosmetic wording may reset and dispatch.",
      ),
      lifecycle.replace(
        "no earlier verdict\nsurvives.",
        "an earlier verdict survives.",
      ),
    ];

    for (const mutant of mutants) {
      expect(mutant).not.toBe(lifecycle);
      expect(() => assertReviewGateContract(mutant)).toThrow();
    }
  });

  it("preserves same-head D14/D15 finality, freshness, and invalidation", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    expect(lifecycle).toContain(
      "one complete same-head required reviewer wave",
    );
    expect(lifecycle).toContain("D15 stays provisional until");
    expect(lifecycle).toContain("the active-task D14 gate is satisfied");
    expect(lifecycle).toContain("all-non-mutating D14 dispositions");
    expect(lifecycle).toContain("dispositions satisfies that gate");
    expect(lifecycle).toContain("same-head provisional D15 candidates may");
    expect(lifecycle).toContain("Every fix commit invalidates both verdicts");
    expect(lifecycle).toContain(
      "fresh one-shot reviewers against the new same task head",
    );
  });

  it("keeps the skill and its reviewer and illustrative consumers linked to the lifecycle owner", async () => {
    const [skill, specPrompt, qualityPrompt, diagrams, example, redFlags] =
      await Promise.all([
        readRepoFile("skills/play-subagent-execution/SKILL.md"),
        readRepoFile(
          "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
        ),
        readRepoFile(
          "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
        ),
        readRepoFile(
          "skills/play-subagent-execution/references/process-diagrams.md",
        ),
        readRepoFile(
          "skills/play-subagent-execution/references/example-workflow.md",
        ),
        readRepoFile("skills/play-subagent-execution/references/red-flags.md"),
      ]);

    expect(skill).toContain(
      "proportionality disposition, review-loop limit, and",
    );
    for (const consumer of [specPrompt, qualityPrompt]) {
      expect(consumer).toContain(
        "Reviewers produce evidence; the controller owns disposition",
      );
    }
    expect(diagrams).toContain(
      "Classify independently and separate dispositions before grouping",
    );
    expect(example).toContain("bounded impact preview");
    expect(example).toContain("adjacent separate-work handoff");
    expect(redFlags).toMatch(
      /Treat reviewer findings as automatic mutation authority; they are evidence\s+only\./,
    );
    expect(redFlags).not.toContain(
      "Treat reviewer findings as evidence, not automatic mutation authority",
    );
  });

  it("keeps illustrative review findings ordered, classified, and routed consistently", async () => {
    const [diagrams, example] = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/process-diagrams.md",
      ),
      readRepoFile(
        "skills/play-subagent-execution/references/example-workflow.md",
      ),
    ]);

    const classification = example.indexOf(
      "Controller first retains a bounded impact preview",
    );
    expect(classification).toBeGreaterThanOrEqual(0);
    expect(example.slice(0, classification)).not.toContain(
      "routing target=Task 2 implementer",
    );
    expect(example).toMatch(
      /missing progress report is an\s+in-scope product blocker because the extracted Task 2 acceptance requires\s+progress reporting every 100 items/,
    );
    expect(example).toMatch(
      /`--json` flag is an\s+in-scope product\s+blocker because the extracted Task 2 contract authorizes only verify\/repair\s+modes/,
    );
    expect(example).toMatch(
      /magic-number suggestion is an adjacent independently releasable\s+defect/,
    );
    expect(example).not.toContain("extracted PROGRESS_INTERVAL constant");

    expect(diagrams).toContain(
      '"Bounded fix permitted?" -> "Mark task complete" [label="no; all-non-mutating dispositions satisfy active-task gate"];',
    );
    expect(diagrams).toContain(
      '"Bounded fix permitted?" -> "Stop: BLOCKED" [label="no; unclear authority or round 3/repeated family"];',
    );
  });
});
