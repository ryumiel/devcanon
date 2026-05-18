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
const helperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/review-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const nitsFile = `.ephemeral/topic-${headSha}-nits-pending.json`;

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-review-artifacts-"),
  );
  await mkdir(path.join(dir, ".ephemeral"));
  return dir;
}

async function writeEnvelope(cwd: string, relPath: string): Promise<void> {
  await writeFile(
    path.join(cwd, relPath),
    JSON.stringify({
      schema: "play-review/findings/v1",
      findings: [],
      carry_forward: [],
    }),
  );
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: { ...process.env, HEAD_SHA: headSha, ...env },
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

describe("play-review review artifact helper", () => {
  it("validates findings and nits envelopes", async () => {
    const cwd = await makeWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      await writeEnvelope(cwd, nitsFile);

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("derives and prepares the nits-pending write path", async () => {
    const cwd = await makeWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      const { stdout } = await runHelper(cwd, "derive-nits-pending", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(nitsFile);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("computes and prepares the findings write path from BRANCH_NAME", async () => {
    const cwd = await makeWorkspace();
    try {
      const { stdout } = await runHelper(cwd, "prepare-findings-write", {
        BRANCH_NAME: "topic",
      });
      expect(stdout.trim()).toBe(findingsFile);

      const branchSlugCases = [
        ["Feature/ABC.1_2", "Feature-ABC.1_2"],
        ["!!!", "unnamed"],
        [".hidden", "unnamed"],
        ["-flag", "unnamed"],
      ] as const;
      for (const [branchName, slug] of branchSlugCases) {
        await expect(
          runHelper(cwd, "prepare-findings-write", {
            BRANCH_NAME: branchName,
          }),
        ).resolves.toMatchObject({
          stdout: `.ephemeral/${slug}-${headSha}-findings.json\n`,
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("prepares an explicit findings write path and removes a symlinked leaf", async () => {
    const cwd = await makeWorkspace();
    const outside = path.join(cwd, "outside-target");
    try {
      if (symlinkAvailable) {
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, path.join(cwd, findingsFile));
      }

      const { stdout } = await runHelper(cwd, "prepare-findings-write", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(findingsFile);
      if (symlinkAvailable) {
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");
        await expect(lstat(path.join(cwd, findingsFile))).rejects.toMatchObject(
          {
            code: "ENOENT",
          },
        );
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed paths, nesting, traversal, schema mismatch, and head mismatch", async () => {
    const cwd = await makeWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      await mkdir(path.join(cwd, ".ephemeral/nested"));
      await writeFile(
        path.join(cwd, ".ephemeral/bad-findings.json"),
        JSON.stringify({
          schema: "wrong/v1",
          findings: [],
          carry_forward: [],
        }),
      );

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: "findings.json" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path validation failed"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/nested/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/topic/.ephemeral/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/../bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE:
            ".ephemeral/topic-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-nits-file", {
          NITS_FILE: ".ephemeral/bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked .ephemeral directory",
    async () => {
      const cwd = await makeWorkspace();
      const outside = path.join(cwd, "outside-ephemeral");
      try {
        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await mkdir(outside);
        await symlink(outside, path.join(cwd, ".ephemeral"));

        await expect(
          runHelper(cwd, "prepare-findings-write", {
            FINDINGS_FILE: findingsFile,
          }),
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

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked leaf files when reading",
    async () => {
      const cwd = await makeWorkspace();
      const outside = path.join(cwd, "outside-findings.json");
      try {
        await writeEnvelope(cwd, findingsFile);
        await writeEnvelope(cwd, "outside-findings.json");
        await rm(path.join(cwd, findingsFile));
        await symlink(outside, path.join(cwd, findingsFile));

        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file must not be a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects missing files and directory targets", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });

      await mkdir(path.join(cwd, findingsFile));
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });
      await expect(
        runHelper(cwd, "prepare-findings-write", {
          FINDINGS_FILE: findingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path is a directory"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unreadable files where the platform enforces chmod permissions", async () => {
    const cwd = await makeWorkspace();
    const absoluteFindingsFile = path.join(cwd, findingsFile);
    try {
      await writeEnvelope(cwd, findingsFile);
      await chmod(absoluteFindingsFile, 0o000);
      try {
        await readFile(absoluteFindingsFile);
        return;
      } catch {
        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file missing or unreadable",
          ),
        });
      }
    } finally {
      await chmod(absoluteFindingsFile, 0o600).catch(() => undefined);
      await cleanupTempDir(cwd);
    }
  });

  it("rejects non-regular findings write targets when mkfifo is available", async () => {
    if (!(await commandAvailable("mkfifo"))) {
      return;
    }

    const cwd = await makeWorkspace();
    try {
      await execFileAsync("mkfifo", [path.join(cwd, findingsFile)]);

      await expect(
        runHelper(cwd, "prepare-findings-write", {
          FINDINGS_FILE: findingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings path exists but is not a regular file",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects non-regular derived nits-pending targets when mkfifo is available", async () => {
    if (!(await commandAvailable("mkfifo"))) {
      return;
    }

    const cwd = await makeWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      await execFileAsync("mkfifo", [path.join(cwd, nitsFile)]);

      await expect(
        runHelper(cwd, "derive-nits-pending", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "nits pending path exists but is not a regular file",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
