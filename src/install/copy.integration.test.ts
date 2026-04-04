import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { copyDirectory, copyFile } from "./copy.js";

describe("copyFile", () => {
  let tempDir: string;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const { restore } = installTestLogger();
    restoreLogger = restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("copies content correctly", async () => {
    const src = path.join(tempDir, "source.txt");
    const dst = path.join(tempDir, "dest.txt");
    await writeFile(src, "hello world", "utf-8");

    await copyFile(src, dst);

    const content = await readFile(dst, "utf-8");
    expect(content).toBe("hello world");
  });

  it("overwrites existing destination", async () => {
    const src = path.join(tempDir, "source.txt");
    const dst = path.join(tempDir, "dest.txt");
    await writeFile(src, "new content", "utf-8");
    await writeFile(dst, "old content", "utf-8");

    await copyFile(src, dst);

    const content = await readFile(dst, "utf-8");
    expect(content).toBe("new content");
  });

  it("throws ENOENT for nonexistent source", async () => {
    const src = path.join(tempDir, "nonexistent.txt");
    const dst = path.join(tempDir, "dest.txt");

    const error = await copyFile(src, dst).catch((e: unknown) => e);
    expect(error).toHaveProperty("code", "ENOENT");
  });
});

describe("copyDirectory", () => {
  let tempDir: string;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const { restore } = installTestLogger();
    restoreLogger = restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("copies entire tree recursively", async () => {
    const srcDir = path.join(tempDir, "src");
    const dstDir = path.join(tempDir, "dst");
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, "a.txt"), "aaa", "utf-8");
    await writeFile(path.join(srcDir, "b.txt"), "bbb", "utf-8");

    await copyDirectory(srcDir, dstDir);

    const aContent = await readFile(path.join(dstDir, "a.txt"), "utf-8");
    const bContent = await readFile(path.join(dstDir, "b.txt"), "utf-8");
    expect(aContent).toBe("aaa");
    expect(bContent).toBe("bbb");
  });

  it("replaces existing destination so old files are gone", async () => {
    const srcDir = path.join(tempDir, "src");
    const dstDir = path.join(tempDir, "dst");

    // Create destination with an old file
    await mkdir(dstDir, { recursive: true });
    await writeFile(path.join(dstDir, "old.txt"), "stale", "utf-8");

    // Create source with a new file only
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, "new.txt"), "fresh", "utf-8");

    await copyDirectory(srcDir, dstDir);

    const entries = (await readdir(dstDir)).sort();
    expect(entries).toEqual(["new.txt"]);
    const content = await readFile(path.join(dstDir, "new.txt"), "utf-8");
    expect(content).toBe("fresh");
  });

  it("preserves nested subdirectories", async () => {
    const srcDir = path.join(tempDir, "src");
    const dstDir = path.join(tempDir, "dst");
    await mkdir(path.join(srcDir, "level1", "level2"), { recursive: true });
    await writeFile(
      path.join(srcDir, "level1", "level2", "deep.txt"),
      "deep content",
      "utf-8",
    );

    await copyDirectory(srcDir, dstDir);

    const content = await readFile(
      path.join(dstDir, "level1", "level2", "deep.txt"),
      "utf-8",
    );
    expect(content).toBe("deep content");
  });

  it("throws ENOENT for nonexistent source", async () => {
    const srcDir = path.join(tempDir, "nonexistent");
    const dstDir = path.join(tempDir, "dst");

    const error = await copyDirectory(srcDir, dstDir).catch((e: unknown) => e);
    expect(error).toHaveProperty("code", "ENOENT");
  });
});
