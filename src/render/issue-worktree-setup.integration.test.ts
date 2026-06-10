import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { pathExists } from "../utils/fs.js";
import { renderAll } from "./pipeline.js";

describe("issue-worktree-setup render packaging", () => {
  it("mirrors the setup-worktree helper scripts byte-for-byte", async () => {
    const rootDir = await createTempDir();
    try {
      const repoRoot = process.cwd();
      const sourceSkillDir = path.join(
        repoRoot,
        "skills",
        "issue-worktree-setup",
      );
      const helperScripts = ["setup-worktree.sh", "setup-worktree.ps1"];
      const sourceScripts = new Map<string, string>();
      for (const helperScript of helperScripts) {
        sourceScripts.set(
          helperScript,
          await readFile(
            path.join(sourceSkillDir, "scripts", helperScript),
            "utf-8",
          ),
        );
      }
      const fixtureSkillDir = path.join(
        rootDir,
        "skills",
        "issue-worktree-setup",
      );
      const fixtureScriptsDir = path.join(fixtureSkillDir, "scripts");

      await mkdir(fixtureScriptsDir, { recursive: true });
      await writeFile(
        path.join(fixtureSkillDir, "SKILL.md"),
        await readFile(path.join(sourceSkillDir, "SKILL.md"), "utf-8"),
        "utf-8",
      );
      for (const [helperScript, sourceScript] of sourceScripts) {
        await writeFile(
          path.join(fixtureScriptsDir, helperScript),
          sourceScript,
          "utf-8",
        );
      }

      const config = makeResolvedConfig(rootDir, {
        library: {
          skillsDir: path.join(rootDir, "skills"),
          agentsDir: path.join(rootDir, "agents"),
          generatedDir: path.join(rootDir, "generated"),
        },
      });
      await mkdir(config.library.agentsDir, { recursive: true });

      await renderAll(config, true, false);

      for (const target of ["claude", "codex"] as const) {
        for (const [helperScript, sourceScript] of sourceScripts) {
          const generatedScriptPath = path.join(
            config.library.generatedDir,
            target,
            "skills",
            "issue-worktree-setup",
            "scripts",
            helperScript,
          );

          expect(await pathExists(generatedScriptPath)).toBe(true);
          expect(await readFile(generatedScriptPath, "utf-8")).toBe(
            sourceScript,
          );
        }
      }
    } finally {
      await cleanupTempDir(rootDir);
    }
  });
});
