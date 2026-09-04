import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("analysis boundary", () => {
  it("keeps producer modules independent of analysis", async () => {
    const sourceRoot = path.resolve(import.meta.dirname, "..");
    const producers = [
      "render/pipeline.ts",
      "render/skill.ts",
      "render/packaged-shell.ts",
      "validate/skills.ts",
      "validate/agents.ts",
    ];
    for (const producer of producers) {
      await expect(
        readFile(path.join(sourceRoot, producer), "utf8"),
      ).resolves.not.toMatch(/from ["'][^"']*analysis\//u);
    }
  });
});
