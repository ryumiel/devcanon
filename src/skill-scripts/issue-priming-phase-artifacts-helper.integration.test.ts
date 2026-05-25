import { execFile } from "node:child_process";
import {
  chmod,
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
  "skills/issue-priming-workflow/scripts/phase-artifacts.sh",
);

async function makeWorkspace(): Promise<string> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-phase-artifacts-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await mkdir(path.join(cwd, ".ephemeral"));
  await writeFile(
    path.join(cwd, ".ephemeral/2026-05-25-123-issue-body.md"),
    "# Issue\n",
  );
  await writeFile(
    path.join(cwd, ".ephemeral/2026-05-25-123-comment-evidence.md"),
    "# Comments\n",
  );
  await writeFile(
    path.join(cwd, ".ephemeral/2026-05-25-123-research.md"),
    "# Research\n",
  );
  await writeFile(
    path.join(cwd, ".ephemeral/2026-05-25-topic-design.md"),
    "# Design\n",
  );
  await writeFile(
    path.join(cwd, ".ephemeral/2026-05-25-topic-plan.md"),
    "# Plan\n",
  );
  return cwd;
}

async function runHelper(cwd: string, kind: string, artifactPath: string) {
  return execFileAsync(
    "bash",
    [helperScript, "validate-read", kind, artifactPath],
    { cwd },
  );
}

describe("issue-priming phase-artifacts helper", () => {
  it("validates direct-child phase artifact paths for each expected kind", async () => {
    const cwd = await makeWorkspace();
    try {
      for (const [kind, artifactPath] of [
        ["issue-body", ".ephemeral/2026-05-25-123-issue-body.md"],
        ["comment-evidence", ".ephemeral/2026-05-25-123-comment-evidence.md"],
        ["research", ".ephemeral/2026-05-25-123-research.md"],
        ["design", ".ephemeral/2026-05-25-topic-design.md"],
        ["plan", ".ephemeral/2026-05-25-topic-plan.md"],
      ] as const) {
        await expect(runHelper(cwd, kind, artifactPath)).resolves.toMatchObject(
          { stdout: "" },
        );
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for malformed, nested, traversal, missing, and directory paths", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, "issue-body", "issue-body.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("issue body path validation failed"),
      });
      await expect(
        runHelper(cwd, "design", ".ephemeral/nested/topic-design.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested design path rejected"),
      });
      await expect(
        runHelper(cwd, "plan", ".ephemeral/topic..bad-plan.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("path traversal"),
      });
      await expect(
        runHelper(cwd, "research", ".ephemeral/missing-research.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "research missing or not a regular file",
        ),
      });
      await mkdir(path.join(cwd, ".ephemeral/directory-design.md"));
      await expect(
        runHelper(cwd, "design", ".ephemeral/directory-design.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("design missing or not a regular file"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects execution from a repository subdirectory before validating local .ephemeral paths", async () => {
    const cwd = await makeWorkspace();
    const subdir = path.join(cwd, "subdir");
    try {
      await mkdir(path.join(subdir, ".ephemeral"), { recursive: true });
      await writeFile(
        path.join(subdir, ".ephemeral/2026-05-25-topic-plan.md"),
        "# Subdir Plan\n",
      );

      await expect(
        runHelper(subdir, "plan", ".ephemeral/2026-05-25-topic-plan.md"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "phase-artifacts.sh must run from the repository root",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked .ephemeral and leaf artifacts",
    async () => {
      const cwd = await makeWorkspace();
      try {
        const outside = path.join(cwd, "outside.md");
        await writeFile(outside, "# Outside\n");
        await rm(path.join(cwd, ".ephemeral/2026-05-25-topic-plan.md"));
        await symlink(
          outside,
          path.join(cwd, ".ephemeral/2026-05-25-topic-plan.md"),
        );

        await expect(
          runHelper(cwd, "plan", ".ephemeral/2026-05-25-topic-plan.md"),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("plan must not be a symlink"),
        });

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

        await expect(
          runHelper(cwd, "plan", ".ephemeral/2026-05-25-topic-plan.md"),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            ".ephemeral must be a directory, not a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects unreadable artifacts when permissions can represent unreadable files", async () => {
    const cwd = await makeWorkspace();
    const artifact = path.join(cwd, ".ephemeral/2026-05-25-topic-design.md");
    try {
      await chmod(artifact, 0o000);
      try {
        await readFile(artifact);
        return;
      } catch {
        await expect(
          runHelper(cwd, "design", ".ephemeral/2026-05-25-topic-design.md"),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("design missing or unreadable"),
        });
      } finally {
        await chmod(artifact, 0o644);
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
