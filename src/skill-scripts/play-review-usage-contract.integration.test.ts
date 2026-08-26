import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const usageDocument = path.join(
  process.cwd(),
  "skills/play-review/references/review-artifacts-usage.md",
);

describe("review-artifacts usage contract", () => {
  it("documents runnable native PowerShell shapes for Phase 7 operations", async () => {
    const usage = await readFile(usageDocument, "utf8");
    const powershellBlock = usage.match(/```powershell\n([\s\S]*?)\n```/u)?.[1];

    expect(powershellBlock).toBeDefined();
    expect(powershellBlock).not.toContain("<operation>");
    expect(powershellBlock).toContain('$env:HEAD_SHA = "<review-head-sha>"');
    expect(powershellBlock).toContain(
      '$env:FINDINGS_FILE = ".ephemeral/<branch>-<review-head-sha>-findings.json"',
    );
    expect(powershellBlock).toContain("validate-findings");
    expect(powershellBlock).toContain(
      '$env:JUDGMENT_REQUIRED_FINDING_INDEXES = "0,2"',
    );
    expect(powershellBlock).toContain("prepare-judgment-nits");
  });
});
