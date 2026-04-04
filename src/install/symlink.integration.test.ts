import { lstat, mkdir, readlink, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { createSymlink } from "./symlink.js";

const symlinkAvailable = await canCreateSymlinks();

describe("createSymlink", () => {
  let tempDir: string;
  let loggerCleanup: { restore: () => void };

  beforeEach(async () => {
    tempDir = await createTempDir();
    loggerCleanup = installTestLogger();
  });

  afterEach(async () => {
    loggerCleanup.restore();
    await cleanupTempDir(tempDir);
  });

  it.skipIf(!symlinkAvailable)(
    "creates a file symlink pointing to the target",
    async () => {
      const target = path.join(tempDir, "target.txt");
      await writeFile(target, "hello", "utf-8");

      const linkPath = path.join(tempDir, "link.txt");
      await createSymlink(target, linkPath, false);

      const stat = await lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(target);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "creates a directory symlink pointing to the target",
    async () => {
      const target = path.join(tempDir, "target-dir");
      await mkdir(target);

      const linkPath = path.join(tempDir, "link-dir");
      await createSymlink(target, linkPath, true);

      const stat = await lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(target);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "replaces an existing symlink with a new target",
    async () => {
      const oldTarget = path.join(tempDir, "old-target.txt");
      const newTarget = path.join(tempDir, "new-target.txt");
      await writeFile(oldTarget, "old", "utf-8");
      await writeFile(newTarget, "new", "utf-8");

      const linkPath = path.join(tempDir, "link.txt");
      await symlink(oldTarget, linkPath, "file");

      await createSymlink(newTarget, linkPath, false);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(newTarget);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "replaces an existing regular file at link path",
    async () => {
      const target = path.join(tempDir, "target.txt");
      await writeFile(target, "target content", "utf-8");

      const linkPath = path.join(tempDir, "existing-file.txt");
      await writeFile(linkPath, "existing content", "utf-8");

      await createSymlink(target, linkPath, false);

      const stat = await lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(target);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "replaces an existing directory at link path",
    async () => {
      const target = path.join(tempDir, "target-dir");
      await mkdir(target);

      const linkPath = path.join(tempDir, "existing-dir");
      await mkdir(linkPath);
      await writeFile(
        path.join(linkPath, "child.txt"),
        "child content",
        "utf-8",
      );

      await createSymlink(target, linkPath, true);

      const stat = await lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(target);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "creates symlink when link path does not exist yet",
    async () => {
      const target = path.join(tempDir, "target.txt");
      await writeFile(target, "content", "utf-8");

      const linkPath = path.join(tempDir, "nonexistent-link.txt");

      await createSymlink(target, linkPath, false);

      const stat = await lstat(linkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const resolved = await readlink(linkPath);
      expect(resolved).toBe(target);
    },
  );

  it.skipIf(symlinkAvailable)(
    "throws EPERM when symlinks are not available",
    async () => {
      const target = path.join(tempDir, "target.txt");
      await writeFile(target, "content", "utf-8");

      const linkPath = path.join(tempDir, "link.txt");

      try {
        await createSymlink(target, linkPath, false);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe("EPERM");
      }
    },
  );
});
