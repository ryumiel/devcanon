import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createTempDir,
  makeAgentYaml,
  makeConfigYaml,
} from "../../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../../__test-helpers__/logger.js";
import { runGit } from "../../runtime/git.js";
import { doctorAction } from "./doctor.js";

describe("doctorAction", () => {
  let tempDir: string;
  let configPath: string;
  let agentsDir: string;
  let infos: string[];
  let testLogger: TestLoggerResult;
  let restore: () => void;
  let priorExitCode: typeof process.exitCode;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    configPath = await createConfigFile(
      tempDir,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
      }),
    );
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    infos = testLogger.infos;
    restore = installed.restore;
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = priorExitCode;
    restore();
    await cleanupTempDir(tempDir);
  });

  it("reports agents-valid ok for agents using a neutral capability", async () => {
    await createAgentFixture(
      agentsDir,
      "reviewer",
      makeAgentYaml("reviewer", {
        capability: "balanced",
        claude: { tools: ["Read"] },
        codex: { sandbox_mode: "read-only" },
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

  it("reports primary checkout managed-worktree drift when invoked from a managed worktree", async () => {
    await initRepo(tempDir);
    const linkedWorktree = path.join(tempDir, ".worktrees", "linked");
    await runGit(["worktree", "add", "-b", "linked", linkedWorktree, "HEAD"], {
      cwd: tempDir,
    });
    await mkdir(path.join(linkedWorktree, "skills"), { recursive: true });
    await mkdir(path.join(linkedWorktree, "agents"), { recursive: true });
    const linkedConfigPath = await createConfigFile(
      linkedWorktree,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
      }),
    );
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
          opts: () => ({ config: linkedConfigPath, json: false }),
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
          ),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "legacy v1",
      "version: 1\n",
      "Config invalid: Config version 1 is no longer supported.",
    ],
    [
      "incomplete v2",
      makeConfigYaml({ capabilityProfiles: {} }),
      "Config invalid: Invalid config: Required, Required, Required",
    ],
  ])(
    "records %s config failure and skips every config-dependent check",
    async (_label, invalidConfig, expectedMessage) => {
      await writeFile(configPath, invalidConfig, "utf-8");

      await expect(
        doctorAction(
          {},
          {
            parent: {
              opts: () => ({ config: configPath, json: true }),
            },
          },
        ),
      ).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
      expect(testLogger.jsons).toHaveLength(1);
      const results = testLogger.jsons[0] as Array<{
        name: string;
        status: string;
        message: string;
      }>;
      expect(results).toEqual([
        {
          name: "node-version",
          status: "ok",
          message: `Node ${process.versions.node}`,
        },
        {
          name: "config-found",
          status: "ok",
          message: "Config file found",
        },
        {
          name: "config-valid",
          status: "error",
          message: expectedMessage,
        },
      ]);
      expect(infos).toHaveLength(3);
      expect(infos[0]).toContain("node-version:");
      expect(infos[1]).toContain("config-found:");
      expect(infos[2]).toContain("config-valid:");
    },
  );
});

async function initRepo(repoDir: string): Promise<void> {
  await runGit(["init", "--initial-branch=main"], { cwd: repoDir });
  await runGit(["config", "user.name", "Test User"], { cwd: repoDir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), "test\n");
  await runGit(["add", "README.md"], { cwd: repoDir });
  await runGit(["commit", "-m", "test: initial"], { cwd: repoDir });
}
