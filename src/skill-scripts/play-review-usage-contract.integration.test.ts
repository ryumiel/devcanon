import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const usageDocument = path.join(
  process.cwd(),
  "skills/play-review/references/review-artifacts-usage.md",
);

async function readPowerShellBlock(): Promise<string> {
  const usage = await readFile(usageDocument, "utf8");
  const powershellBlock = usage.match(/```powershell\n([\s\S]*?)\n```/u)?.[1];
  expect(powershellBlock).toBeDefined();
  return powershellBlock ?? "";
}

describe("review-artifacts usage contract", () => {
  it("documents runnable native PowerShell shapes for Phase 7 operations", async () => {
    const powershellBlock = await readPowerShellBlock();

    expect(powershellBlock).not.toContain("<operation>");
    expect(powershellBlock).toContain('$env:HEAD_SHA = "<review-head-sha>"');
    expect(powershellBlock).toContain(
      '$env:FINDINGS_FILE = ".ephemeral/<branch>-<review-head-sha>-findings.json"',
    );
    expect(powershellBlock).toContain(
      '& $VerifiedBash (Join-Path $PlayReviewDir "scripts/review-artifacts.sh") validate-findings',
    );
    expect(powershellBlock).toContain(
      '$env:JUDGMENT_REQUIRED_FINDING_INDEXES = "0,2"',
    );
    expect(powershellBlock).toContain(
      '& $VerifiedBash (Join-Path $PlayReviewDir "scripts/review-artifacts.sh") prepare-judgment-nits',
    );
    expect(powershellBlock).not.toMatch(
      /(?:^|\n)\s*(?:&\s*)?bash(?:\.exe)?\b/iu,
    );
  });

  it.runIf(process.platform === "win32")(
    "parses the documented native PowerShell block without syntax errors",
    async () => {
      const powershellBlock = await readPowerShellBlock();
      await expect(
        execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:DEVCANON_REVIEW_ARTIFACTS_EXAMPLE, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
          ],
          {
            env: {
              ...process.env,
              DEVCANON_REVIEW_ARTIFACTS_EXAMPLE: powershellBlock,
            },
          },
        ),
      ).resolves.toMatchObject({ stderr: "" });
    },
  );
});
