import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { ResolvedConfig } from "../config/schema.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";
import { renderAll } from "./pipeline.js";

describe("renderAll", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restore = installed.restore;
    // Create skills and agents directories expected by makeResolvedConfig
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("produces 4 outputs for 1 agent + 1 skill with both targets enabled", async () => {
    await createSkillFixture(config.library.skillsDir, "my-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "my-agent",
      makeAgentYaml("my-agent"),
    );

    const result = await renderAll(config, false);

    expect(result.outputs).toHaveLength(4);
    const types = result.outputs.map((o) => `${o.target}:${o.type}`).sort();
    expect(types).toEqual([
      "claude:agent",
      "claude:skill",
      "codex:agent",
      "codex:skill",
    ]);
  });

  it("writes agent files to generatedDir when writeToGenerated is true", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, true);

    const agentOutputs = result.outputs.filter(
      (o) => o.type === "agent" && o.generatedPath,
    );
    for (const output of agentOutputs) {
      expect(await pathExists(output.generatedPath!)).toBe(true);
    }
  });

  it("does not write files to disk when writeToGenerated is false", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    await renderAll(config, false);

    const generatedDir = config.library.generatedDir;
    expect(await pathExists(generatedDir)).toBe(false);
  });

  it("returns only claude outputs when targetFilter is 'claude'", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, false, false, "claude");

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.every((o) => o.target === "claude")).toBe(true);
  });

  it("excludes codex outputs when codex target is disabled", async () => {
    const disabledConfig = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
    });
    await createSkillFixture(disabledConfig.library.skillsDir, "s1");
    await createAgentFixture(
      disabledConfig.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(disabledConfig, false);

    expect(result.outputs.every((o) => o.target === "claude")).toBe(true);
    expect(result.outputs.some((o) => o.target === "codex")).toBe(false);
  });

  it("produces deterministic 64-char hex contentHash for skills", async () => {
    await createSkillFixture(config.library.skillsDir, "hash-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result1 = await renderAll(config, false);
    const result2 = await renderAll(config, false);

    const skillOutputs1 = result1.outputs.filter((o) => o.type === "skill");
    const skillOutputs2 = result2.outputs.filter((o) => o.type === "skill");

    for (const output of skillOutputs1) {
      expect(output.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Deterministic: same inputs produce same hashes
    expect(skillOutputs1.map((o) => o.contentHash)).toEqual(
      skillOutputs2.map((o) => o.contentHash),
    );
  });

  it("agent outputs have non-null content containing rendered text", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, false);

    const agentOutputs = result.outputs.filter((o) => o.type === "agent");
    expect(agentOutputs.length).toBeGreaterThan(0);
    for (const output of agentOutputs) {
      expect(output.content).not.toBeNull();
      expect(output.content!.length).toBeGreaterThan(0);
      expect(output.content).toContain("a1");
    }
  });

  it("returns empty outputs when no skills and no agents exist", async () => {
    const result = await renderAll(config, false);

    expect(result.outputs).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it("propagates strict mode to agent validation", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "strict-agent",
      makeAgentYaml("strict-agent") + "\nunknown_field: oops",
    );

    await expect(renderAll(config, false, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("unknown_field");
        return true;
      },
    );
  });
});
