import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { hashDirectory } from "./hash.js";

describe("hashDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("returns a 64-char hex SHA-256 for a single file", async () => {
    await writeFile(path.join(tempDir, "hello.txt"), "hello", "utf-8");
    const hash = await hashDirectory(tempDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic — same directory hashed twice yields identical result", async () => {
    await writeFile(path.join(tempDir, "file.txt"), "content", "utf-8");
    const hash1 = await hashDirectory(tempDir);
    const hash2 = await hashDirectory(tempDir);
    expect(hash1).toBe(hash2);
  });

  it("changes when a file is added", async () => {
    await writeFile(path.join(tempDir, "a.txt"), "aaa", "utf-8");
    const hashBefore = await hashDirectory(tempDir);

    await writeFile(path.join(tempDir, "b.txt"), "bbb", "utf-8");
    const hashAfter = await hashDirectory(tempDir);

    expect(hashAfter).not.toBe(hashBefore);
  });

  it("changes when file content is modified", async () => {
    await writeFile(path.join(tempDir, "data.txt"), "original", "utf-8");
    const hashBefore = await hashDirectory(tempDir);

    await writeFile(path.join(tempDir, "data.txt"), "modified", "utf-8");
    const hashAfter = await hashDirectory(tempDir);

    expect(hashAfter).not.toBe(hashBefore);
  });

  it("produces the same hash regardless of file creation order", async () => {
    // Create b.txt then a.txt in first dir
    const dir1 = await createTempDir();
    await writeFile(path.join(dir1, "b.txt"), "B", "utf-8");
    await writeFile(path.join(dir1, "a.txt"), "A", "utf-8");

    // Create a.txt then b.txt in second dir
    const dir2 = await createTempDir();
    await writeFile(path.join(dir2, "a.txt"), "A", "utf-8");
    await writeFile(path.join(dir2, "b.txt"), "B", "utf-8");

    const hash1 = await hashDirectory(dir1);
    const hash2 = await hashDirectory(dir2);

    expect(hash1).toBe(hash2);

    await cleanupTempDir(dir1);
    await cleanupTempDir(dir2);
  });

  it("includes files in nested subdirectories", async () => {
    await writeFile(path.join(tempDir, "root.txt"), "root", "utf-8");
    const hashBefore = await hashDirectory(tempDir);

    await mkdir(path.join(tempDir, "sub"), { recursive: true });
    await writeFile(path.join(tempDir, "sub", "nested.txt"), "nested", "utf-8");
    const hashAfter = await hashDirectory(tempDir);

    expect(hashAfter).not.toBe(hashBefore);
  });

  it("excludes .DS_Store and Thumbs.db from the hash", async () => {
    await writeFile(path.join(tempDir, "real.txt"), "data", "utf-8");
    const hashBefore = await hashDirectory(tempDir);

    await writeFile(path.join(tempDir, ".DS_Store"), "mac junk", "utf-8");
    await writeFile(path.join(tempDir, "Thumbs.db"), "win junk", "utf-8");
    const hashAfter = await hashDirectory(tempDir);

    expect(hashAfter).toBe(hashBefore);
  });

  it("returns SHA-256 of empty input for an empty directory", async () => {
    const hash = await hashDirectory(tempDir);
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces different hashes when same content is in different filenames", async () => {
    const dir1 = await createTempDir();
    await writeFile(path.join(dir1, "alpha.txt"), "same", "utf-8");

    const dir2 = await createTempDir();
    await writeFile(path.join(dir2, "beta.txt"), "same", "utf-8");

    const hash1 = await hashDirectory(dir1);
    const hash2 = await hashDirectory(dir2);

    expect(hash1).not.toBe(hash2);

    await cleanupTempDir(dir1);
    await cleanupTempDir(dir2);
  });
});
