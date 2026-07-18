import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  inspectManifest,
  recoverInvalidManifest,
} from "../install/manifest.js";

const execFileAsync = promisify(execFile);

function countLiteralOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function terminalLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((line) => line.length > 0);
}

describe("CLI entrypoint", () => {
  it("uses devcanon as the program name in help output", async () => {
    const result = await execFileAsync(
      "pnpm",
      ["exec", "tsx", "src/cli/index.ts", "sync", "--help"],
      {
        cwd: process.cwd(),
        shell: process.platform === "win32",
      },
    );

    expect(result.stdout).toContain("Usage: devcanon");
    expect(result.stdout).toContain("--reconcile-manifest");
  });

  it("parses reconciliation through the public CLI and returns UserError exit 1 for bound foreign records", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "devcanon-cli-"));
    try {
      const configPath = path.join(tempDir, "devcanon.config.yaml");
      const agentsDir = path.join(tempDir, "agents");
      const manifestPath = path.join(tempDir, "manifest.json");
      const claudeAgentsHome = path.join(tempDir, "home", "claude", "agents");
      const claudeSkillsHome = path.join(tempDir, "home", "claude", "skills");
      const codexAgentsHome = path.join(tempDir, "home", "codex", "agents");
      const codexSkillsHome = path.join(tempDir, "home", "codex", "skills");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "helper.yaml"),
        "name: helper\ndescription: helper\ninstructions: help\nskills: []\n",
        "utf-8",
      );
      await writeFile(
        configPath,
        [
          "version: 2",
          "capabilityProfiles:",
          "  efficient: { claude: claude-haiku-4-5-20251001, codex: gpt-5.6-luna }",
          "  balanced: { claude: claude-sonnet-5, codex: gpt-5.6-terra }",
          "  frontier: { claude: claude-opus-4-8, codex: gpt-5.6-sol }",
          "library:",
          `  skillsDir: ${path.join(tempDir, "skills")}`,
          `  agentsDir: ${agentsDir}`,
          `  generatedDir: ${path.join(tempDir, "generated")}`,
          "manifest:",
          `  path: ${manifestPath}`,
          "targets:",
          `  claude: { enabled: true, skillsHome: ${claudeSkillsHome}, agentsHome: ${claudeAgentsHome}, installMode: copy }`,
          `  codex: { enabled: false, skillsHome: ${codexSkillsHome}, agentsHome: ${codexAgentsHome}, installMode: copy }`,
          "defaults: { installMode: copy, overwritePolicy: overwrite-managed, cleanManagedOutputs: true }",
          "platform: { windowsSymlinkFallback: copy }",
          "",
        ].join("\n"),
        "utf-8",
      );
      const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
      await mkdir(path.dirname(foreignPath), { recursive: true });
      const legacyManifest = `${JSON.stringify(
        {
          version: 1,
          managedBy: "devcanon",
          lastSync: new Date().toISOString(),
          records: [
            {
              target: "claude",
              type: "agent",
              sourcePath: path.join(agentsDir, "helper.yaml"),
              generatedPath: null,
              installedPath: path.join(claudeAgentsHome, "helper.md"),
              installMode: "copy",
              contentHash: "old",
              timestamp: new Date().toISOString(),
            },
            {
              target: "claude",
              type: "agent",
              sourcePath: path.join(agentsDir, "foreign.yaml"),
              generatedPath: null,
              installedPath: foreignPath,
              installMode: "copy",
              contentHash: "foreign",
              timestamp: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      )}\n`;
      await writeFile(manifestPath, legacyManifest, "utf-8");

      const summary = await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "src/cli/index.ts",
          "--config",
          configPath,
          "sync",
          "--reconcile-manifest",
        ],
        { cwd: process.cwd(), shell: process.platform === "win32" },
      );
      expect(summary.stdout).toContain(
        "Manifest reconciliation: 1 retained, 1 removed.",
      );
      await rm(path.join(claudeAgentsHome, "helper.md"), { force: true });
      await writeFile(manifestPath, legacyManifest, "utf-8");

      const reconciled = await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "src/cli/index.ts",
          "--config",
          configPath,
          "--json",
          "sync",
          "--reconcile-manifest",
        ],
        { cwd: process.cwd(), shell: process.platform === "win32" },
      );
      const json = JSON.parse(reconciled.stdout) as {
        reconciliation: { retained: unknown[]; removed: unknown[] };
      };
      expect(json.reconciliation.retained).toHaveLength(1);
      expect(json.reconciliation.removed).toHaveLength(1);

      const bound = JSON.parse(await readFile(manifestPath, "utf-8"));
      bound.records[0].installedPath = foreignPath;
      bound.records[0].name = "helper";
      await writeFile(
        manifestPath,
        `${JSON.stringify(bound, null, 2)}\n`,
        "utf-8",
      );
      let failure: { code?: number; stderr?: string } | undefined;
      try {
        await execFileAsync(
          "pnpm",
          [
            "exec",
            "tsx",
            "src/cli/index.ts",
            "--config",
            configPath,
            "sync",
            "--reconcile-manifest",
          ],
          { cwd: process.cwd(), shell: process.platform === "win32" },
        );
      } catch (error) {
        failure = error as { code?: number; stderr?: string };
      }
      expect(failure?.code).toBe(1);
      expect(failure?.stderr).toContain(
        "Bound manifest contains foreign records",
      );
      expect(failure?.stderr).not.toContain("Unexpected error");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each(["sync", "uninstall"] as const)(
    "renders the real primary recovery cause before sibling-lock guidance for %s",
    async (command) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "devcanon-cli-"));
      try {
        const configPath = path.join(tempDir, "devcanon.config.yaml");
        const manifestPath = path.join(tempDir, "manifest.json");
        const lockPath = `${manifestPath}.lock`;
        const lockAction = `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${lockPath}.`;
        const claudeAgentsHome = path.join(tempDir, "home", "claude", "agents");
        const claudeSkillsHome = path.join(tempDir, "home", "claude", "skills");
        const codexAgentsHome = path.join(tempDir, "home", "codex", "agents");
        const codexSkillsHome = path.join(tempDir, "home", "codex", "skills");
        await writeFile(
          configPath,
          [
            "version: 2",
            "capabilityProfiles:",
            "  efficient: { claude: claude-haiku-4-5-20251001, codex: gpt-5.6-luna }",
            "  balanced: { claude: claude-sonnet-5, codex: gpt-5.6-terra }",
            "  frontier: { claude: claude-opus-4-8, codex: gpt-5.6-sol }",
            "library:",
            `  skillsDir: ${path.join(tempDir, "skills")}`,
            `  agentsDir: ${path.join(tempDir, "agents")}`,
            `  generatedDir: ${path.join(tempDir, "generated")}`,
            "manifest:",
            `  path: ${manifestPath}`,
            "targets:",
            `  claude: { enabled: true, skillsHome: ${claudeSkillsHome}, agentsHome: ${claudeAgentsHome}, installMode: copy }`,
            `  codex: { enabled: false, skillsHome: ${codexSkillsHome}, agentsHome: ${codexAgentsHome}, installMode: copy }`,
            "defaults: { installMode: copy, overwritePolicy: overwrite-managed, cleanManagedOutputs: true }",
            "platform: { windowsSymlinkFallback: copy }",
            "",
          ].join("\n"),
          "utf-8",
        );
        await writeFile(lockPath, "other manifest operation", "utf-8");

        const inspection = await inspectManifest(manifestPath);
        const recovery = await recoverInvalidManifest(inspection);
        expect(recovery.completed).toBe(false);
        if (recovery.completed || !(recovery.cause instanceof Error)) {
          throw new Error("Expected a real primary lock recovery Error");
        }
        const primaryCause = recovery.cause;
        const primaryCauseSegment = `Primary cause: ${primaryCause.message}`;
        const recoveryStackMarker = "inspectAbsentManifest";
        expect(primaryCause.stack).toContain(recoveryStackMarker);

        let failure:
          | { code?: number; stderr?: string; stdout?: string }
          | undefined;
        try {
          await execFileAsync(
            "pnpm",
            [
              "exec",
              "tsx",
              "src/cli/index.ts",
              "--config",
              configPath,
              command,
            ],
            { cwd: process.cwd(), shell: process.platform === "win32" },
          );
        } catch (error) {
          failure = error as {
            code?: number;
            stderr?: string;
            stdout?: string;
          };
        }

        const stderr = failure?.stderr ?? "";
        const categorySegment =
          "Manifest recovery did not complete (lock-unavailable; cleanup clean).";
        const expectedErrorLine = `Error: ${categorySegment} ${primaryCauseSegment}`;
        const expectedHintLine = `  Hint: ${lockAction}`;
        const lines = terminalLines(stderr);
        expect(failure?.code).toBe(1);
        expect(lines).toContain(expectedErrorLine);
        expect(countLiteralOccurrences(stderr, primaryCauseSegment)).toBe(1);
        expect(lines).toContain(expectedHintLine);
        expect(expectedErrorLine.indexOf(categorySegment)).toBeLessThan(
          expectedErrorLine.indexOf(primaryCauseSegment),
        );
        expect(lines.indexOf(expectedErrorLine)).toBeLessThan(
          lines.indexOf(expectedHintLine),
        );
        expect(countLiteralOccurrences(stderr, lockAction)).toBe(1);
        expect(stderr).not.toContain("Unexpected error");
        expect(stderr).not.toContain(String(primaryCause));
        expect(stderr).not.toContain(recoveryStackMarker);
        expect(stderr).not.toContain("\n    at ");
        expect(stderr).not.toContain(".bak");
        expect(failure?.stdout ?? "").not.toContain("Nothing to remove.");
        expect(await readFile(lockPath, "utf-8")).toBe(
          "other manifest operation",
        );
        await expect(lstat(manifestPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          lstat(path.join(tempDir, "generated")),
        ).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );
});
