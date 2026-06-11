import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedSkill } from "../models/types.js";
import { pathExists } from "../utils/fs.js";
import { renderAll } from "./pipeline.js";

async function copyRuntimeFixture(skillsDir: string): Promise<void> {
  await cp(
    path.resolve("skills/devcanon-runtime"),
    path.join(skillsDir, "devcanon-runtime"),
    { recursive: true },
  );
}

describe("devcanon-runtime rendering", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("renders the support runtime beside consumer skills without user-facing invocation metadata", async () => {
    await copyRuntimeFixture(config.library.skillsDir);
    await createSkillFixture(config.library.skillsDir, "consumer-skill");

    await renderAll(config, true);

    const claudeRuntimeDir = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "devcanon-runtime",
    );
    const codexRuntimeDir = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "devcanon-runtime",
    );
    const codexConsumerDir = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "consumer-skill",
    );

    expect(await pathExists(claudeRuntimeDir)).toBe(true);
    expect(await pathExists(codexRuntimeDir)).toBe(true);
    expect(await pathExists(codexConsumerDir)).toBe(true);
    expect(path.dirname(codexRuntimeDir)).toBe(path.dirname(codexConsumerDir));

    const claudeSkill = await readFile(
      path.join(claudeRuntimeDir, "SKILL.md"),
      "utf-8",
    );
    expect(claudeSkill).toContain("user-invocable: false");
    expect(claudeSkill).toContain("disable-model-invocation: true");

    const codexSidecar = await readFile(
      path.join(codexRuntimeDir, "agents", "openai.yaml"),
      "utf-8",
    );
    expect(codexSidecar).toContain("allow_implicit_invocation: false");
    const runtimeScriptPath = path.join(
      codexRuntimeDir,
      "scripts",
      "devcanon-runtime.sh",
    );
    expect(await pathExists(runtimeScriptPath)).toBe(true);
    expect(await readFile(runtimeScriptPath, "utf-8")).toContain(
      "resolve-entrypoint",
    );
  });

  it("includes runtime files in rendered content hashes", async () => {
    await copyRuntimeFixture(config.library.skillsDir);

    const first = await renderAll(config, false);
    const firstRuntime = first.outputs.find(
      (output): output is RenderedSkill =>
        output.type === "skill" &&
        output.target === "codex" &&
        output.name === "devcanon-runtime",
    );
    expect(firstRuntime).toBeDefined();

    await writeFile(
      path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
      "#!/usr/bin/env bash\nset -euo pipefail\necho changed\n",
      "utf-8",
    );

    const second = await renderAll(config, false);
    const secondRuntime = second.outputs.find(
      (output): output is RenderedSkill =>
        output.type === "skill" &&
        output.target === "codex" &&
        output.name === "devcanon-runtime",
    );
    expect(secondRuntime).toBeDefined();
    expect(secondRuntime?.contentHash).not.toBe(firstRuntime?.contentHash);
  });
});
