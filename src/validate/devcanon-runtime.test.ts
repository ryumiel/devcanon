import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { renderAll } from "../render/pipeline.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";

describe("devcanon-runtime source validation", () => {
  let tempDir: string;
  let config: ReturnType<typeof makeResolvedConfig>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each(["SKILL.md", path.join("agents", "openai.yaml")])(
    "rejects forbidden runtime metadata %s before generated output is mutated",
    async (forbiddenPath) => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const sentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "sentinel",
        "marker.txt",
      );
      await mkdir(path.dirname(sentinel), { recursive: true });
      await mkdir(path.dirname(path.join(runtimeDir, forbiddenPath)), {
        recursive: true,
      });
      await writeFile(
        path.join(runtimeDir, forbiddenPath),
        "forbidden\n",
        "utf-8",
      );
      await writeFile(sentinel, "unchanged\n", "utf-8");

      await expect(renderAll(config, true)).rejects.toThrow(UserError);
      await expect(renderAll(config, true)).rejects.toThrow(
        new RegExp(
          `must not contain ${forbiddenPath.replace(/[\\/]/gu, "[\\\\/]")}`,
          "i",
        ),
      );
      expect(await pathExists(sentinel)).toBe(true);
    },
  );

  it("rejects a missing required runtime file before generated output is mutated", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const sentinel = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "sentinel",
      "marker.txt",
    );
    await mkdir(path.dirname(sentinel), { recursive: true });
    await rm(path.join(runtimeDir, "scripts", "devcanon-runtime.sh"));
    await writeFile(sentinel, "unchanged\n", "utf-8");

    await expect(renderAll(config, true)).rejects.toThrow(UserError);
    await expect(renderAll(config, true)).rejects.toThrow(
      /support skill is incomplete/i,
    );
    expect(await pathExists(sentinel)).toBe(true);
  });
});
