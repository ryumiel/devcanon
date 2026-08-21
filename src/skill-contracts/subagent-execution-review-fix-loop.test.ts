import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const LIFECYCLE =
  "skills/play-subagent-execution/references/lifecycle-status-policy.md";
const PROPORTIONALITY =
  "skills/play-review-response/references/finding-proportionality.md";
const OWNERSHIP_SENTENCE =
  "Findings are evidence; mutation disposition belongs to the controller.";

describe("subagent-execution review-fix loop owner", () => {
  it("consumes proportional findings before D12 with a bounded preview and controller-only disposition", async () => {
    const [lifecycle, proportionality] = await Promise.all([
      readRepoFile(LIFECYCLE),
      readRepoFile(PROPORTIONALITY),
    ]);

    expect(lifecycle).toContain(
      "../../play-review-response/references/finding-proportionality.md",
    );
    expect(proportionality).toContain("classify it as exactly one of:");
    expect(lifecycle).toContain(
      "Writing Skills remains the sole classification authority",
    );
    expect(lifecycle).toContain("private, transient, same-controller");
    expect(lifecycle).toContain("impact preview");

    for (const disposition of [
      /smallest authorized\s+production correction/,
      /existing proof owner/,
      /separate-work non-mutating caller handoff/,
      /concise rejection and no\s+mutation/,
    ]) {
      expect(lifecycle).toMatch(disposition);
    }
    expect(lifecycle).toContain("Unclear classification or authority");
    expect(lifecycle).toContain("gate failure returning existing `BLOCKED`");
    expect(lifecycle.indexOf("impact preview")).toBeLessThan(
      lifecycle.indexOf("Only after this separation"),
    );
  });

  it("bounds failed authorized correction waves, including approval and materially revised-contract resumption", async () => {
    const lifecycle = await readRepoFile(LIFECYCLE);

    expect(lifecycle).toMatch(
      /Rounds 1 and 2 may each permit one\s+bounded fix/,
    );
    expect(lifecycle).toContain("Round 3 returns existing `BLOCKED`");
    expect(lifecycle).toMatch(
      /materially unchanged unresolved finding\s+family may stop earlier/,
    );
    expect(lifecycle).toMatch(
      /finding-bound, current-head\/current-route\/current-contract\/current-evidence,\s+single-use/,
    );
    expect(lifecycle).toMatch(
      /exactly one identified D12 attempt without clearing\s+history or resetting count/,
    );
    expect(lifecycle).toMatch(
      /failed fresh\s+wave after that extra attempt blocks before any further D12/,
    );
    expect(lifecycle).toMatch(
      /Revised-contract resumption instead requires material authoritative scope or\s+acceptance change/,
    );
    expect(lifecycle).toContain(
      "reset only existing current-episode fixup count to `0`",
    );
    expect(lifecycle).toMatch(
      /Cosmetic wording or still-unauthorized evidence cannot reset or\s+dispatch/,
    );
  });

  it("keeps D14/D15 fresh, source-immutable, same-head, provisional, final, and invalidated after fixes", async () => {
    const [lifecycle, specPrompt, qualityPrompt] = await Promise.all([
      readRepoFile(LIFECYCLE),
      readRepoFile(
        "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
      ),
      readRepoFile(
        "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
      ),
    ]);

    expect(lifecycle).toContain(
      "D14 and D15 use independent fresh one-shot sessions",
    );
    expect(lifecycle).toContain(
      "one complete same-head required reviewer wave",
    );
    expect(lifecycle).toContain("D15 stays provisional until");
    expect(lifecycle).toContain(
      "Quality is final only after the same-head D14 gate",
    );
    expect(lifecycle).toContain("Every fix commit invalidates both verdicts");
    expect(lifecycle).toContain(
      "fresh one-shot reviewers against the new same task head",
    );

    for (const prompt of [specPrompt, qualityPrompt]) {
      expect(prompt).toContain("source-immutable");
      expect(prompt.match(new RegExp(OWNERSHIP_SENTENCE, "g"))).toHaveLength(1);
      expect(prompt).not.toContain("controller owns disposition");
      expect(prompt).not.toContain("Do not classify findings for mutation");
    }
  });
});
