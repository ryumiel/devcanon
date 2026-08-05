import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { writeTextAtomically } from "./artifacts.js";

const renameControl = vi.hoisted(() => ({ fail: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: [string, string]) => {
      if (renameControl.fail) {
        throw new Error("rename failed after temporary write");
      }
      return actual.rename(...args);
    },
  };
});

describe("runtime artifact utilities", () => {
  let tempDir: string;

  beforeEach(async () => {
    renameControl.fail = false;
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("writes through a sibling temporary file before replacing the target", async () => {
    const target = path.join(tempDir, ".ephemeral", "result.json");
    await mkdir(path.dirname(target));

    const result = await writeTextAtomically(target, '{"ok":true}\n');

    expect(result.path).toBe(target);
    expect(path.dirname(result.tempPath)).toBe(path.dirname(target));
    expect(await readFile(target, "utf-8")).toBe('{"ok":true}\n');
  });

  it("uses unique temporary files for concurrent writes to the same target", async () => {
    const target = path.join(tempDir, ".ephemeral", "result.json");
    await mkdir(path.dirname(target));

    const results = await Promise.all([
      writeTextAtomically(target, '{"winner":1}\n'),
      writeTextAtomically(target, '{"winner":2}\n'),
    ]);

    expect(new Set(results.map((result) => result.tempPath)).size).toBe(2);
    expect(['{"winner":1}\n', '{"winner":2}\n']).toContain(
      await readFile(target, "utf-8"),
    );
  });

  it("preserves the target and removes its temporary file when rename fails", async () => {
    const target = path.join(tempDir, ".ephemeral", "result.json");
    await mkdir(path.dirname(target));
    await writeFile(target, "before\n");
    renameControl.fail = true;

    await expect(writeTextAtomically(target, "after\n")).rejects.toThrow(
      "rename failed after temporary write",
    );
    await expect(readFile(target, "utf-8")).resolves.toBe("before\n");
    expect(await readdir(path.dirname(target))).toEqual(["result.json"]);
  });
});
