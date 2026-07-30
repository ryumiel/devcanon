import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  enrollExecutable,
  enrollPathIdentity,
  enrollWorkingDirectory,
  parseWindowsPresentation,
} from "./pr-review-root-identity.js";

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
    await symlink(child, link, "dir");

    try {
      const enrolledRoot = await enrollPathIdentity(root, "directory");
      const inside = `${link}${path.sep}..${path.sep}child`;
      await expect(
        enrollWorkingDirectory(enrolledRoot, inside),
      ).rejects.toThrow(/symbolic|link|component/i);

      await rm(link);
      await symlink(outside, link, "dir");
      const outsideSpelling = `${link}${path.sep}..${path.sep}child`;
      await expect(
        enrollWorkingDirectory(enrolledRoot, outsideSpelling),
      ).rejects.toThrow(/symbolic|link|component/i);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("uses only Windows-equivalent volume comparison and preserves original spellings", () => {
    const drive = parseWindowsPresentation("C:\\Root\\Child");
    const driveAlias = parseWindowsPresentation("\\\\?\\c:/Root/Child");
    const unc = parseWindowsPresentation("\\\\Server\\Share\\Root");
    const uncAlias = parseWindowsPresentation("\\\\?\\UNC\\server/share/Root");
    const componentCase = parseWindowsPresentation("c:\\root\\Child");

    expect(drive.original).toBe("C:\\Root\\Child");
    expect(drive.volumeKey).toBe(driveAlias.volumeKey);
    expect(drive.components).toEqual(["Root", "Child"]);
    expect(driveAlias.components).toEqual(["Root", "Child"]);
    expect(unc.volumeKey).toBe(uncAlias.volumeKey);
    expect(unc.components).toEqual(["Root"]);
    expect(uncAlias.components).toEqual(["Root"]);
    expect(componentCase.components).not.toEqual(drive.components);

    for (const value of [
      "\\\\.\\C:\\Root",
      "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1",
      "\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\Root",
      "\\\\?\\Device\\NamedPipe\\x",
    ]) {
      expect(() => parseWindowsPresentation(value)).toThrow(
        /namespace|presentation/i,
      );
    }
  });

  test("preserves all unique redaction variants for a logical alias", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "devcanon-redaction-"));
    const root = path.join(parent, "root");
    await mkdir(root);
    const logical = `${root}${path.sep}.`;

    try {
      const enrolled = await enrollPathIdentity(logical, "directory");
      const working = await enrollWorkingDirectory(enrolled, logical);
      const values = working.redactionVariants.map((value) =>
        new TextDecoder().decode(value),
      );

      expect(values).toContain(logical);
      expect(values).toContain(root);
      expect(new Set(values).size).toBe(values.length);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform !== "win32")(
    "enrolls only a POSIX executable regular file and rejects a non-executable alias",
    async () => {
      const parent = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-executable-"),
      );
      const executable = path.join(parent, "fixture-command");
      const logical = `${parent}${path.sep}.${path.sep}fixture-command`;
      await writeFile(executable, "#!/bin/sh\nexit 0\n");

      try {
        await chmod(executable, 0o755);
        const enrolled = await enrollExecutable(logical);
        expect(enrolled.identity.logical).toBe(logical);
        expect(
          enrolled.redactionVariants.map((value) =>
            new TextDecoder().decode(value),
          ),
        ).toContain(logical);
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
      const wrongExtension = path.join(parent, "fixture.cmd");
      await writeFile(wrongExtension, "not an executable");

      try {
        await expect(enrollExecutable(process.execPath)).resolves.toMatchObject(
          {
            identity: { type: "file" },
          },
        );
        await expect(enrollExecutable(wrongExtension)).rejects.toThrow(
          /\.exe|\.com/i,
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
});
