import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();
const helperScript = path.join(
  process.cwd(),
  "skills/write-linear-project-description/scripts/prepare-project-description-draft.sh",
);

async function makeWorkspace(): Promise<string> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-linear-description-draft-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

async function runHelper(cwd: string, env: NodeJS.ProcessEnv = {}) {
  return execFileAsync("bash", [helperScript], {
    cwd,
    env: {
      ...process.env,
      PROJECT_KEY: "project-atlas",
      TARGET_FIELDS: "description",
      REPLACE_EXISTING: "false",
      ...env,
    },
  });
}

describe("write-linear-project-description draft helper", () => {
  it("prepares and prints the description draft path without writing content", async () => {
    const cwd = await makeWorkspace();
    try {
      const { stdout } = await runHelper(cwd);

      expect(stdout.trim()).toBe(
        ".ephemeral/project-atlas-project-description-draft.md",
      );
      await expect(
        readFile(
          path.join(
            cwd,
            ".ephemeral/project-atlas-project-description-draft.md",
          ),
          "utf-8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("prepares content and both-field draft paths", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, { TARGET_FIELDS: "content" }),
      ).resolves.toMatchObject({
        stdout: ".ephemeral/project-atlas-project-content-brief-draft.md\n",
      });

      await expect(
        runHelper(cwd, { TARGET_FIELDS: "both" }),
      ).resolves.toMatchObject({
        stdout:
          ".ephemeral/project-atlas-project-description-draft.md\n.ephemeral/project-atlas-project-content-brief-draft.md\n",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for missing and unsafe inputs", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(runHelper(cwd, { PROJECT_KEY: "" })).rejects.toMatchObject({
        stderr: expect.stringContaining("PROJECT_KEY is required"),
      });
      await expect(runHelper(cwd, { TARGET_FIELDS: "" })).rejects.toMatchObject(
        {
          stderr: expect.stringContaining("TARGET_FIELDS is required"),
        },
      );
      await expect(
        runHelper(cwd, { PROJECT_KEY: "../atlas" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("unsafe PROJECT_KEY"),
      });
      await expect(
        runHelper(cwd, { TARGET_FIELDS: "summary" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("invalid TARGET_FIELDS"),
      });
      await expect(
        runHelper(cwd, { REPLACE_EXISTING: "maybe" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("invalid REPLACE_EXISTING"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects execution from a repository subdirectory before preparing local paths", async () => {
    const cwd = await makeWorkspace();
    const subdir = path.join(cwd, "subdir");
    try {
      await mkdir(path.join(subdir, ".ephemeral"), { recursive: true });

      await expect(runHelper(subdir)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "prepare-project-description-draft.sh must run from the repository root",
        ),
      });
      await expect(
        readFile(
          path.join(
            subdir,
            ".ephemeral/project-atlas-project-description-draft.md",
          ),
          "utf-8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects existing directories and non-replaceable regular-file collisions", async () => {
    const cwd = await makeWorkspace();
    const target = path.join(
      cwd,
      ".ephemeral/project-atlas-project-description-draft.md",
    );
    try {
      await mkdir(target);
      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining("draft path is a directory"),
      });

      await rm(target, { recursive: true, force: true });
      await writeFile(target, "existing draft\n");
      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining("draft path already exists"),
      });

      await expect(
        runHelper(cwd, { REPLACE_EXISTING: "true" }),
      ).resolves.toMatchObject({
        stdout: ".ephemeral/project-atlas-project-description-draft.md\n",
      });
      expect(await readFile(target, "utf-8")).toBe("existing draft\n");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("does not emit partial output when a later both-field target fails", async () => {
    const cwd = await makeWorkspace();
    const contentTarget = path.join(
      cwd,
      ".ephemeral/project-atlas-project-content-brief-draft.md",
    );
    try {
      await writeFile(contentTarget, "existing content draft\n");

      await expect(
        runHelper(cwd, { TARGET_FIELDS: "both" }),
      ).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("draft path already exists"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked .ephemeral and target-file hazards",
    async () => {
      const cwd = await makeWorkspace();
      try {
        const outside = path.join(cwd, "outside-draft.md");
        const target = path.join(
          cwd,
          ".ephemeral/project-atlas-project-description-draft.md",
        );
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, target);

        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining("draft must not be a symlink"),
        });
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");

        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await mkdir(path.join(cwd, "real-ephemeral"));
        await symlink(
          path.join(cwd, "real-ephemeral"),
          path.join(cwd, ".ephemeral"),
          "dir",
        );

        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining(
            ".ephemeral must be a directory, not a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});
