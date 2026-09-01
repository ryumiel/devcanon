import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_CAPABILITY_PROFILES,
  cleanupTempDir,
  createLightweightDevcanonRuntimeFixture,
  createTempDir,
  validateLightweightDevcanonRuntimeFixture,
} from "./fixtures.js";

describe("lightweight devcanon-runtime fixture validation", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupTempDir));
  });

  it.each([
    [
      "missing capability profiles",
      `${JSON.stringify({ schema: "devcanon/runtime-config/v1" })}\n`,
    ],
    [
      "invalid capability profiles",
      `${JSON.stringify({
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {},
      })}\n`,
    ],
    [
      "duplicate capability profile keys",
      `{"schema":"devcanon/runtime-config/v1","capabilityProfiles":${JSON.stringify(CANONICAL_CAPABILITY_PROFILES)},"capabilityProfiles":{}}\n`,
    ],
    [
      "extra catalog keys",
      `${JSON.stringify({
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: CANONICAL_CAPABILITY_PROFILES,
        extra: true,
      })}\n`,
    ],
  ])("delegates %s to the real validator", async (_name, catalog) => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const skillsDir = path.join(tempDir, "skills");
    const runtimeDir = path.join(skillsDir, "devcanon-runtime");
    await createLightweightDevcanonRuntimeFixture(skillsDir);
    await writeFile(
      path.join(runtimeDir, "config", "runtime-config.json"),
      catalog,
      "utf-8",
    );
    const refusal = new Error("real runtime validation refused fixture");
    const validateReal = vi.fn(async () => {
      throw refusal;
    });

    await expect(
      validateLightweightDevcanonRuntimeFixture(runtimeDir, validateReal),
    ).rejects.toBe(refusal);
    expect(validateReal).toHaveBeenCalledOnce();
    expect(validateReal).toHaveBeenCalledWith(runtimeDir);
  });
});
