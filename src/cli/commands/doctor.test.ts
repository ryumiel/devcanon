import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createTempDir,
  makeAgentYaml,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { runGit } from "../../runtime/git.js";
import { doctorAction } from "./doctor.js";

describe("doctorAction", () => {
  let tempDir: string;
  let configPath: string;
  let agentsDir: string;
  let infos: string[];
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    configPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "modelTiers:",
        "  standard:",
        "    claude:",
        "      model: claude-sonnet-4-6",
        "      effort: medium",
        "    codex:",
        "      model: gpt-5.4",
        "      reasoning_effort: medium",
      ].join("\n"),
    );
    const installed = installTestLogger();
    infos = installed.testLogger.infos;
    restore = installed.restore;
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("reports agents-valid ok for agents using configured model tiers", async () => {
    await createAgentFixture(
      agentsDir,
      "reviewer",
      makeAgentYaml("reviewer", {
        claude: { model: "{{model:standard}}", tools: ["Read"] },
        codex: { model: "{{model:standard}}", sandbox_mode: "read-only" },
      }),
    );

    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some((entry) => entry.includes("agents-valid: 1 agent(s) valid")),
    ).toBe(true);
  });

  it("reports managed-worktrees ok when no worktree directory exists", async () => {
    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some((entry) =>
        entry.includes(
          "managed-worktrees: No managed .worktrees directory found.",
        ),
      ),
    ).toBe(true);
  });

  it("reports managed-worktrees warnings for orphaned entries", async () => {
    await initRepo(tempDir);
    const orphan = path.join(tempDir, ".worktrees", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(
      path.join(orphan, ".git"),
      "gitdir: ../../.git/worktrees/orphan\n",
      "utf-8",
    );

    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some(
        (entry) =>
          entry.includes(
            "managed-worktrees: Managed worktree drift detected",
          ) &&
          entry.includes(
            ".worktrees/orphan is not registered in git worktree metadata.",
          ) &&
          entry.includes("separate cleanup workflow"),
      ),
    ).toBe(true);
  });
});

async function initRepo(repoDir: string): Promise<void> {
  await runGit(["init", "--initial-branch=main"], { cwd: repoDir });
  await runGit(["config", "user.name", "Test User"], { cwd: repoDir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), "test\n");
  await runGit(["add", "README.md"], { cwd: repoDir });
  await runGit(["commit", "-m", "test: initial"], { cwd: repoDir });
}
