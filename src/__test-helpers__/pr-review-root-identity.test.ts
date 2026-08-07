import { realpath as realpathCallback } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

import {
  enrollExecutable,
  enrollPathIdentity,
  enrollWorkingDirectory,
  parseWindowsPresentation,
} from "./pr-review-root-identity.js";

const realpathNative = promisify(realpathCallback.native);

describe("pr-review root identity", () => {
  test("enrolls distinct logical, normalized, physical, and stable directory identity", async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-root-identity-"),
    );
    const root = path.join(parent, "root");
    await mkdir(root);
    const logical = `${root}${path.sep}.`;

    try {
      const identity = await enrollPathIdentity(logical, "directory");

      expect(identity.logical).toBe(logical);
      expect(identity.normalized).toBe(root);
      expect(identity.physical).toBe(await realpath(root));
      expect(identity.type).toBe("directory");
      expect(typeof identity.device).toBe("bigint");
      expect(typeof identity.file).toBe("bigint");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("accepts only a component-contained generated-root working directory and detects replacement", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "devcanon-root-cwd-"));
    const root = path.join(parent, "root");
    const child = path.join(root, "child");
    const sibling = path.join(parent, "root-other");
    await Promise.all([mkdir(child, { recursive: true }), mkdir(sibling)]);

    try {
      const enrolledRoot = await enrollPathIdentity(root, "directory");

      await expect(
        enrollWorkingDirectory(enrolledRoot, child),
      ).resolves.toMatchObject({
        identity: { physical: await realpath(child), type: "directory" },
      });
      await expect(
        enrollWorkingDirectory(enrolledRoot, sibling),
      ).rejects.toThrow(/contained|root/i);

      await rename(root, path.join(parent, "replaced-root"));
      await mkdir(child, { recursive: true });
      await expect(enrollWorkingDirectory(enrolledRoot, child)).rejects.toThrow(
        /contained|root/i,
      );

      const bigintRoot = path.join(parent, "bigint-root");
      const bigintChild = path.join(bigintRoot, "child");
      const device = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      const file = device + 1n;
      await mkdir(bigintChild, { recursive: true });
      const physicalBigintRoot = await realpathNative(bigintRoot);
      const lstat = vi.mocked(fsPromises.lstat);
      const originalLstat = lstat.getMockImplementation();
      if (!originalLstat) throw new Error("lstat mock implementation missing");
      lstat.mockImplementation(async (...args) => {
        const observed = await originalLstat(...args);
        if (String(args[0]) !== physicalBigintRoot || args[1]?.bigint !== true)
          return observed;
        return Object.assign(
          Object.create(Object.getPrototypeOf(observed)),
          observed,
          { dev: device, ino: file },
        );
      });

      try {
        const bigintEnrolledRoot = await enrollPathIdentity(
          bigintRoot,
          "directory",
        );
        const bigintEnrolledWorkingDirectory = await enrollWorkingDirectory(
          bigintEnrolledRoot,
          bigintChild,
        );

        expect(bigintEnrolledRoot).toMatchObject({ device, file });
        expect(bigintEnrolledWorkingDirectory.identity.physical).toBe(
          await realpath(bigintChild),
        );
      } finally {
        lstat.mockImplementation(originalLstat);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("fails closed for raw symlink-plus-dot-dot components before normalization", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "devcanon-root-link-"));
    const root = path.join(parent, "root");
    const outside = path.join(parent, "outside");
    const child = path.join(root, "child");
    const link = path.join(root, "link");
    await Promise.all([mkdir(child, { recursive: true }), mkdir(outside)]);
    const linkKind = process.platform === "win32" ? "junction" : "dir";
    await symlink(child, link, linkKind);

    try {
      const enrolledRoot = await enrollPathIdentity(root, "directory");
      const spellings =
        process.platform === "win32"
          ? [
              `${link}\\..\\child`,
              `${link.replaceAll("\\", "/")}/../child`,
              `${link.replaceAll("\\", "/")}\\..\\child`,
            ]
          : [`${link}${path.sep}..${path.sep}child`];
      for (const inside of spellings) {
        await expect(
          enrollWorkingDirectory(enrolledRoot, inside),
        ).rejects.toThrow(/symbolic|link|component/i);
      }

      await rm(link);
      await symlink(outside, link, linkKind);
      for (const outsideSpelling of spellings) {
        await expect(
          enrollWorkingDirectory(enrolledRoot, outsideSpelling),
        ).rejects.toThrow(/symbolic|link|component/i);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("uses only Windows-equivalent volume comparison and preserves original spellings", () => {
    const drive = parseWindowsPresentation("C:\\Root\\Child");
    const driveAlias = parseWindowsPresentation("\\\\?\\c:/Root/Child");
    const unc = parseWindowsPresentation("\\\\Server\\Share\\Root");
    const uncAlias = parseWindowsPresentation("\\\\?\\UNC\\server/share/Root");
    const forwardUnc = parseWindowsPresentation("//server/share/Root");
    const mixedUnc = parseWindowsPresentation("/\\server/share/Root");
    const componentCase = parseWindowsPresentation("c:\\root\\Child");

    expect(drive.original).toBe("C:\\Root\\Child");
    expect(drive.volumeKey).toBe(driveAlias.volumeKey);
    expect(drive.components).toEqual(["Root", "Child"]);
    expect(driveAlias.components).toEqual(["Root", "Child"]);
    expect(unc.volumeKey).toBe(uncAlias.volumeKey);
    expect(unc.components).toEqual(["Root"]);
    expect(uncAlias.components).toEqual(["Root"]);
    expect(forwardUnc.volumeKey).toBe(unc.volumeKey);
    expect(mixedUnc.volumeKey).toBe(unc.volumeKey);
    expect(componentCase.components).not.toEqual(drive.components);

    for (const value of [
      "\\\\.\\C:\\Root",
      "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1",
      "\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\Root",
      "\\\\?\\Device\\NamedPipe\\x",
      "//?/C:/Root",
      "//server/",
      "///share/Root",
    ]) {
      expect(() => parseWindowsPresentation(value)).toThrow(
        /namespace|presentation/i,
      );
    }
    for (const value of [
      "",
      "C:\\Root\0Child",
      `C:\\${"x".repeat(8 * 1024)}`,
      null,
    ]) {
      expect(() => parseWindowsPresentation(value as string)).toThrow(
        /bounded|NUL-free/i,
      );
    }
  });

  test("preserves exact three-way redaction variants for a physical parent alias", async () => {
    const container = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-redaction-"),
    );
    const parent = path.join(container, "physical-parent");
    const aliasParent = path.join(container, "alias-parent");
    const root = path.join(parent, "root");
    await mkdir(root, { recursive: true });
    await symlink(
      parent,
      aliasParent,
      process.platform === "win32" ? "junction" : "dir",
    );
    const normalized = path.join(aliasParent, "root");
    const logical = `${normalized}${path.sep}.`;

    try {
      const enrolled = await enrollPathIdentity(logical, "directory");
      const working = await enrollWorkingDirectory(enrolled, logical);
      const values = working.redactionVariants.map((value) =>
        new TextDecoder().decode(value),
      );

      expect(enrolled.logical).toBe(logical);
      expect(enrolled.normalized).toBe(normalized);
      expect(enrolled.physical).toBe(await realpath(root));
      expect(new Set(values)).toEqual(
        new Set([logical, normalized, await realpath(root)]),
      );
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform !== "win32")(
    "enrolls only a POSIX executable regular file and rejects a non-executable alias",
    async () => {
      const parent = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-executable-"),
      );
      const aliasParent = path.join(parent, "alias-parent");
      const executable = path.join(parent, "fixture-command");
      const normalized = path.join(aliasParent, "fixture-command");
      const logical = `${aliasParent}${path.sep}.${path.sep}fixture-command`;

      try {
        await symlink(parent, aliasParent, "dir");
        await writeFile(executable, "#!/bin/sh\nexit 0\n");
        await chmod(executable, 0o755);
        const enrolled = await enrollExecutable(logical);
        expect(enrolled.identity.logical).toBe(logical);
        expect(enrolled.identity.normalized).toBe(normalized);
        expect(enrolled.identity.physical).toBe(await realpath(executable));
        expect(
          enrolled.redactionVariants.map((value) =>
            new TextDecoder().decode(value),
          ),
        ).toEqual(
          expect.arrayContaining([
            logical,
            normalized,
            await realpath(executable),
          ]),
        );
        await chmod(executable, 0o644);
        await expect(enrollExecutable(executable)).rejects.toThrow(/execute/i);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );

  test.runIf(process.platform === "win32")(
    "enrolls a real Windows executable and rejects a wrong extension",
    async () => {
      const parent = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-windows-executable-"),
      );
      const comExecutable = path.join(parent, "fixture.com");
      const wrongExtension = path.join(parent, "fixture.cmd");
      await copyFile(process.execPath, comExecutable);
      await writeFile(wrongExtension, "not an executable");

      try {
        await expect(enrollExecutable(process.execPath)).resolves.toMatchObject(
          {
            identity: { type: "file" },
          },
        );
        await expect(enrollExecutable(comExecutable)).resolves.toMatchObject({
          identity: { physical: await realpath(comExecutable), type: "file" },
        });
        await expect(enrollExecutable(wrongExtension)).rejects.toThrow(
          /\.exe|\.com/i,
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
});
