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
  "skills/issue-priming-workflow/scripts/write-assumptions-comment.sh",
);

async function makeWorkspace(): Promise<string> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-assumptions-comment-"),
  );
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

async function runHelper(cwd: string, env: NodeJS.ProcessEnv = {}) {
  return execFileAsync("bash", [helperScript], {
    cwd,
    env: { ...process.env, ISSUE_IDENTIFIER: "ENG-123", ...env },
  });
}

describe("issue-priming assumptions comment helper", () => {
  it("prepares and prints the repo-relative assumptions comment path", async () => {
    const cwd = await makeWorkspace();
    try {
      const { stdout } = await runHelper(cwd);

      expect(stdout.trim()).toBe(".ephemeral/eng-123-assumptions-comment.md");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("slugs issue identifiers without writing assumptions content", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: "#167" }),
      ).resolves.toMatchObject({
        stdout: ".ephemeral/167-assumptions-comment.md\n",
      });
      await expect(
        readFile(path.join(cwd, ".ephemeral/167-assumptions-comment.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for missing inputs, traversal slugs, nested paths, and directory targets", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: "" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("ISSUE_IDENTIFIER is required"),
      });
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: ".." }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("path traversal"),
      });
      await expect(
        runHelper(cwd, {
          ASSUMPTIONS_COMMENT_FILE:
            ".ephemeral/nested/eng-123-assumptions-comment.md",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "assumptions_comment_file must be a direct child of .ephemeral",
        ),
      });

      await mkdir(path.join(cwd, ".ephemeral/eng-123-assumptions-comment.md"));
      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "assumptions comment path is a directory",
        ),
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
        const outside = path.join(cwd, "outside-assumptions.md");
        const target = path.join(
          cwd,
          ".ephemeral/eng-123-assumptions-comment.md",
        );
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, target);

        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "assumptions comment must not be a symlink",
          ),
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
