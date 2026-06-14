import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
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
const jqAvailable = await commandAvailable("jq");
const mkfifoAvailable = await commandAvailable("mkfifo");
const helperScript = path.join(
  process.cwd(),
  "skills/issue-priming-workflow/scripts/write-auto-handoff.sh",
);
const planPath = ".ephemeral/2026-05-18-example-plan.md";

async function initializeRepo(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-auto-handoff-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, ".ephemeral"));
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  await writeFile(path.join(cwd, planPath), "# Plan\n");
  return cwd;
}

async function headSha(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
  });
  return stdout.trim();
}

async function runHelper(cwd: string, env: NodeJS.ProcessEnv = {}) {
  return execFileAsync("bash", [helperScript], {
    cwd,
    env: { ...process.env, PLAN_PATH: planPath, ...env },
  });
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!jqAvailable)("issue-priming auto-handoff helper", () => {
  it("writes the auto-handoff artifact for a valid plan path", async () => {
    const cwd = await initializeRepo();
    try {
      const head = await headSha(cwd);
      const expectedPath = `.ephemeral/issue-priming-auto-handoff-${head}.json`;
      const { stdout } = await runHelper(cwd);
      expect(stdout.trim()).toBe(expectedPath);

      const artifact = JSON.parse(
        await readFile(path.join(cwd, expectedPath), "utf-8"),
      );
      expect(artifact).toEqual({
        schema: "issue-priming/auto-handoff/v1",
        phase: "issue-priming-workflow:6",
        mode: "auto",
        plan_path: planPath,
        head_sha: head,
        phase7_branch_review_fix_required: true,
        phase7_rerun_after_commits: true,
        phase7_final_approval_summary_notice_required: true,
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed, nested, traversal, missing, and directory plan paths", async () => {
    const cwd = await initializeRepo();
    try {
      await expect(
        runHelper(cwd, { PLAN_PATH: "plan.md" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("plan path validation failed"),
      });
      await expect(
        runHelper(cwd, { PLAN_PATH: ".ephemeral/nested/example-plan.md" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested plan path rejected"),
      });
      await expect(
        runHelper(cwd, { PLAN_PATH: ".ephemeral/../example-plan.md" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested plan path rejected"),
      });
      await expect(
        runHelper(cwd, { PLAN_PATH: ".ephemeral/missing-plan.md" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("plan missing or not a regular file"),
      });
      await mkdir(path.join(cwd, ".ephemeral/directory-plan.md"));
      await expect(
        runHelper(cwd, { PLAN_PATH: ".ephemeral/directory-plan.md" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("plan missing or not a regular file"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects execution from a repository subdirectory before validating local .ephemeral paths", async () => {
    const cwd = await initializeRepo();
    const subdir = path.join(cwd, "subdir");
    try {
      await mkdir(path.join(subdir, ".ephemeral"), { recursive: true });
      await writeFile(path.join(subdir, planPath), "# Subdir Plan\n");
      const head = await headSha(cwd);
      const subdirTarget = path.join(
        subdir,
        `.ephemeral/issue-priming-auto-handoff-${head}.json`,
      );

      await expect(runHelper(subdir)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "write-auto-handoff.sh must run from the repository root",
        ),
      });
      await expect(lstat(subdirTarget)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)("rejects symlinked .ephemeral", async () => {
    const cwd = await initializeRepo();
    const ephemeral = path.join(cwd, ".ephemeral");
    const realEphemeral = path.join(cwd, "real-ephemeral");
    try {
      await rm(ephemeral, { recursive: true, force: true });
      await mkdir(realEphemeral);
      await symlink(realEphemeral, ephemeral, "dir");
      await writeFile(
        path.join(realEphemeral, path.basename(planPath)),
        "# Plan\n",
      );

      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          ".ephemeral must be a directory, not a symlink",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)("rejects symlinked plan files", async () => {
    const cwd = await initializeRepo();
    const outside = path.join(cwd, "outside-plan.md");
    try {
      await writeFile(outside, "# Outside\n");
      await rm(path.join(cwd, planPath));
      await symlink(outside, path.join(cwd, planPath));

      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining("plan must not be a symlink"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unreadable plan files when permissions can represent unreadable files", async () => {
    const cwd = await initializeRepo();
    const absolutePlanPath = path.join(cwd, planPath);
    try {
      await chmod(absolutePlanPath, 0o000);
      try {
        await readFile(absolutePlanPath);
        return;
      } catch {
        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining("plan missing or unreadable"),
        });
      } finally {
        await chmod(absolutePlanPath, 0o644);
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects target-file symlink hazards without overwriting outside targets",
    async () => {
      const cwd = await initializeRepo();
      try {
        const head = await headSha(cwd);
        const target = `.ephemeral/issue-priming-auto-handoff-${head}.json`;
        const outside = path.join(cwd, "outside-target");
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, path.join(cwd, target));
        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining("auto handoff must not be a symlink"),
        });
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects directory auto-handoff output targets", async () => {
    const cwd = await initializeRepo();
    try {
      const head = await headSha(cwd);
      const target = `.ephemeral/issue-priming-auto-handoff-${head}.json`;
      await mkdir(path.join(cwd, target));

      await expect(runHelper(cwd)).rejects.toMatchObject({
        stderr: expect.stringContaining("auto handoff path is a directory"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!mkfifoAvailable)(
    "rejects FIFO auto-handoff output targets",
    async () => {
      const cwd = await initializeRepo();
      try {
        const head = await headSha(cwd);
        const target = `.ephemeral/issue-priming-auto-handoff-${head}.json`;
        await execFileAsync("mkfifo", [path.join(cwd, target)]);

        await expect(runHelper(cwd)).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "auto handoff path exists but is not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});
