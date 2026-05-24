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
  "skills/issue-priming-workflow/scripts/write-research-brief.sh",
);

async function makeWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-research-brief-"));
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

async function runHelper(cwd: string, env: NodeJS.ProcessEnv = {}) {
  return execFileAsync("bash", [helperScript], {
    cwd,
    env: {
      ...process.env,
      ISSUE_IDENTIFIER: "ENG-123",
      ISSUE_PRIMING_TODAY: "2026-05-25",
      ...env,
    },
  });
}

describe("issue-priming research brief helper", () => {
  it("prepares and prints the repo-relative research brief path", async () => {
    const cwd = await makeWorkspace();
    try {
      const { stdout } = await runHelper(cwd);

      expect(stdout.trim()).toBe(".ephemeral/2026-05-25-eng-123-research.md");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("slugs issue identifiers for the research brief path without writing brief content", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: "#167" }),
      ).resolves.toMatchObject({
        stdout: ".ephemeral/2026-05-25-167-research.md\n",
      });
      await expect(
        readFile(path.join(cwd, ".ephemeral/2026-05-25-167-research.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for missing inputs, nested/traversal slugs, and directory targets", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: "" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("ISSUE_IDENTIFIER is required"),
      });
      await expect(
        runHelper(cwd, { ISSUE_PRIMING_TODAY: "2026/05/25" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "research brief path validation failed",
        ),
      });
      await expect(
        runHelper(cwd, { ISSUE_IDENTIFIER: ".." }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("path traversal"),
      });

      await mkdir(path.join(cwd, ".ephemeral/2026-05-25-eng-123-research.md"));
      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining("research brief path is a directory"),
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
        const outside = path.join(cwd, "outside-research.md");
        const target = path.join(
          cwd,
          ".ephemeral/2026-05-25-eng-123-research.md",
        );
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, target);

        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "research brief must not be a symlink",
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
