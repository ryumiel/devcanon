import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import {
  RuntimePathError,
  assertNoSymlinkOrReparsePoint,
  normalizeRuntimePath,
  parseRuntimeDirectoryPath,
  requireAbsoluteRuntimePath,
  requireDirectEphemeralChild,
} from "./paths.js";

const symlinkAvailable = await canCreateSymlinks();

describe("runtime path utilities", () => {
  it("normalizes POSIX paths while preserving the root", () => {
    expect(normalizeRuntimePath("/tmp/../var//x", "posix")).toMatchObject({
      normalized: "/var/x",
      root: "/",
      segments: ["var", "x"],
      isAbsolute: true,
      comparable: "/var/x",
    });
  });

  it("preserves literal backslashes in normalized POSIX path segments", () => {
    expect(
      normalizeRuntimePath("/tmp/literal\\backslash/component", "posix"),
    ).toMatchObject({
      segments: ["tmp", "literal\\backslash", "component"],
    });
  });

  it("normalizes Windows paths with case-folded comparable text", () => {
    expect(
      normalizeRuntimePath("C:\\Users\\ME\\..\\Agent\\file.TXT", "win32"),
    ).toMatchObject({
      normalized: "C:\\Users\\Agent\\file.TXT",
      root: "C:\\",
      segments: ["Users", "Agent", "file.TXT"],
      isAbsolute: true,
      comparable: "c:/users/agent/file.txt",
    });
  });

  it("rejects relative paths when absolute paths are required", () => {
    expect(() => requireAbsoluteRuntimePath("relative/path", "posix")).toThrow(
      RuntimePathError,
    );
  });

  it("parses runtime directories with raw POSIX traversal authority", () => {
    expect(
      parseRuntimeDirectoryPath("/tmp/runtime\\..\\literal", "posix"),
    ).toMatchObject({
      original: "/tmp/runtime\\..\\literal",
      rawSegments: ["tmp", "runtime\\..\\literal"],
      inspectionPath: "/tmp/runtime\\..\\literal",
    });
    expect(() =>
      parseRuntimeDirectoryPath("/tmp/runtime/scripts/..", "posix"),
    ).toThrow("runtime path must not contain a parent-directory component");
    expect(
      parseRuntimeDirectoryPath("/tmp/..runtime", "posix").rawSegments,
    ).toContain("..runtime");
  });

  it("parses Win32 drive, UNC, and extended UNC spellings before normalization", () => {
    for (const input of [
      "D:/runtime/mixed\\segments",
      "D:\\runtime/mixed\\segments",
      "\\\\server\\share\\runtime",
      "\\\\?\\UNC\\server\\share\\runtime",
    ]) {
      expect(parseRuntimeDirectoryPath(input, "win32")).toMatchObject({
        original: input,
        platform: "win32",
        isAbsolute: true,
      });
    }
    expect(() =>
      parseRuntimeDirectoryPath("D:\\runtime/mixed\\..", "win32"),
    ).toThrow("runtime path must not contain a parent-directory component");
    expect(
      parseRuntimeDirectoryPath("D:\\runtime\\..name", "win32").rawSegments,
    ).toContain("..name");
  });

  it("derives final-component inspection spellings without changing execution input", () => {
    expect(parseRuntimeDirectoryPath("/.", "posix")).toMatchObject({
      original: "/.",
      inspectionPath: "/",
    });
    expect(parseRuntimeDirectoryPath("/tmp/runtime/.", "posix")).toMatchObject({
      original: "/tmp/runtime/.",
      inspectionPath: "/tmp/runtime",
    });
    expect(
      parseRuntimeDirectoryPath("D:\\runtime\\.\\", "win32"),
    ).toMatchObject({
      original: "D:\\runtime\\.\\",
      inspectionPath: "D:\\runtime",
    });
    expect(parseRuntimeDirectoryPath("C:\\.", "win32")).toMatchObject({
      original: "C:\\.",
      inspectionPath: "C:\\",
    });
    expect(
      parseRuntimeDirectoryPath("relative/runtime", "posix"),
    ).toMatchObject({
      original: "relative/runtime",
      isAbsolute: false,
    });
  });

  it("accepts only direct .ephemeral child paths", () => {
    expect(requireDirectEphemeralChild(".ephemeral/result.json")).toEqual({
      ok: true,
      path: ".ephemeral/result.json",
      filename: "result.json",
    });
    expect(requireDirectEphemeralChild(".ephemeral/..hidden")).toEqual({
      ok: true,
      path: ".ephemeral/..hidden",
      filename: "..hidden",
    });
    expect(() =>
      requireDirectEphemeralChild(".ephemeral/nested/result.json"),
    ).toThrow(RuntimePathError);
    expect(() =>
      requireDirectEphemeralChild(".ephemeral\\result.json"),
    ).toThrow(RuntimePathError);
    expect(() => requireDirectEphemeralChild("result.json")).toThrow(
      RuntimePathError,
    );
    expect(() => requireDirectEphemeralChild(".ephemeral/../x")).toThrow(
      RuntimePathError,
    );
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked paths under the trusted root",
    async () => {
      const tempDir = await createTempDir();
      try {
        const root = path.join(tempDir, "root");
        const target = path.join(root, "target");
        await mkdir(root);
        await mkdir(target);
        await writeFile(path.join(target, "payload.txt"), "payload");
        await symlink(target, path.join(root, "linked"));

        await expect(
          assertNoSymlinkOrReparsePoint(
            root,
            path.join(root, "linked", "payload.txt"),
          ),
        ).rejects.toThrow(RuntimePathError);
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked trusted root before accepting children",
    async () => {
      const tempDir = await createTempDir();
      try {
        const realRoot = path.join(tempDir, "real-root");
        const root = path.join(tempDir, "root");
        await mkdir(realRoot);
        await writeFile(path.join(realRoot, "payload.txt"), "payload");
        await symlink(realRoot, root);

        await expect(
          assertNoSymlinkOrReparsePoint(root, path.join(root, "payload.txt")),
        ).rejects.toThrow(RuntimePathError);
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );

  it("accepts child names that begin with two dots", async () => {
    const tempDir = await createTempDir();
    try {
      const root = path.join(tempDir, "root");
      const childDir = path.join(root, "..hidden");
      const target = path.join(childDir, "payload.txt");
      await mkdir(childDir, { recursive: true });
      await writeFile(target, "payload");

      await expect(
        assertNoSymlinkOrReparsePoint(root, target),
      ).resolves.toBeUndefined();
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
