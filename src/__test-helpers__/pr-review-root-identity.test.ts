import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
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
} from "./pr-review-root-identity.js";

describe("pr-review root identity", () => {
  test("enrolls logical, normalized, physical, and stable directory identity", async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-root-identity-"),
    );
    const root = path.join(parent, "root");
    await mkdir(root);

    try {
      const identity = await enrollPathIdentity(
        path.join(root, "."),
        "directory",
      );

      expect(identity.logical).toBe(path.join(root, "."));
      expect(identity.normalized).toBe(root);
      expect(identity.physical).toBe(await realpath(root));
      expect(identity.type).toBe("directory");
      expect(typeof identity.device).toBe("bigint");
      expect(typeof identity.file).toBe("bigint");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("accepts only a component-contained physical working directory", async () => {
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
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("fails closed when a working-directory component is a symbolic link", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "devcanon-root-link-"));
    const root = path.join(parent, "root");
    const outside = path.join(parent, "outside");
    const link = path.join(root, "link");
    await Promise.all([mkdir(root), mkdir(outside)]);
    await symlink(outside, link, "dir");

    try {
      const enrolledRoot = await enrollPathIdentity(root, "directory");
      await expect(enrollWorkingDirectory(enrolledRoot, link)).rejects.toThrow(
        /symbolic|link/i,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("enrolls only an absolute executable regular file with POSIX execute permission", async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-executable-"),
    );
    const executable = path.join(parent, "fixture-command");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");

    try {
      await chmod(executable, 0o755);
      await expect(enrollExecutable(executable)).resolves.toMatchObject({
        identity: { physical: await realpath(executable), type: "file" },
      });
      await expect(enrollExecutable("fixture-command")).rejects.toThrow(
        /absolute/i,
      );
      await expect(
        enrollExecutable(path.join(parent, "missing")),
      ).rejects.toThrow(/executable|path/i);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
