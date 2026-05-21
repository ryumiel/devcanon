import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
const snapshotHelperScript = path.join(
  process.cwd(),
  "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
);
const snapshotValidatorScript = path.join(
  process.cwd(),
  "skills/play-subagent-execution/scripts/validate-snapshot-manifest.sh",
);

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function commandPath(command: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", [
    "-c",
    `command -v ${command}`,
  ]);
  return stdout.trim();
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await commandPath(command);
    return true;
  } catch {
    return false;
  }
}

async function nodeExecutablePath(command: string): Promise<string> {
  if (process.platform !== "win32") {
    return commandPath(command);
  }
  const { stdout } = await execFileAsync("where", [command]);
  return stdout.split(/\r?\n/)[0].trim();
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writeCommandWrapper(binDir: string, command: string) {
  const wrapperPath = path.join(binDir, command);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${shellSingleQuote(await commandPath(command))} "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(wrapperPath, 0o755);
}

async function initializeGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
}

async function createTempGitRepo(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "devcanon-snapshot-"));
  await initializeGitRepo(tempDir);
  return tempDir;
}

async function gitHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
  });
  return stdout.trim();
}

async function commitChanges(
  cwd: string,
  message: string,
  addArgs = ["."],
): Promise<string> {
  await execFileAsync("git", ["add", ...addArgs], { cwd });
  await execFileAsync("git", ["commit", "-m", message], { cwd });
  return gitHead(cwd);
}

async function runSnapshotHelper(
  cwd: string,
  baseSha: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [snapshotHelperScript], {
    cwd,
    env: {
      ...process.env,
      BASE_SHA: baseSha,
      SNAPSHOT_TASK_ID: "Task 1",
      ...env,
    },
  });
}

async function runSnapshotValidator(
  cwd: string,
  baseSha: string,
  snapshotFile: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [snapshotValidatorScript], {
    cwd,
    env: {
      ...process.env,
      BASE_SHA: baseSha,
      SNAPSHOT_FILE: snapshotFile,
      ...env,
    },
  });
}

async function readSnapshot<T>(cwd: string, headSha: string): Promise<T> {
  return JSON.parse(
    await readFile(
      path.join(cwd, `.ephemeral/snapshot-${headSha}.json`),
      "utf-8",
    ),
  ) as T;
}

async function writeSnapshotFixture(): Promise<{
  tempDir: string;
  baseSha: string;
  headSha: string;
  snapshotFile: string;
}> {
  const tempDir = await createTempGitRepo();
  await writeFile(path.join(tempDir, "file.md"), "old\n");
  const baseSha = await commitChanges(tempDir, "chore: baseline");
  await writeFile(path.join(tempDir, "file.md"), "new\n");
  const headSha = await commitChanges(tempDir, "feat: update file");
  await runSnapshotHelper(tempDir, baseSha);
  return {
    tempDir,
    baseSha,
    headSha,
    snapshotFile: `.ephemeral/snapshot-${headSha}.json`,
  };
}

async function mutateSnapshotFixture(
  tempDir: string,
  headSha: string,
  mutate: (snapshot: Record<string, unknown>) => void,
): Promise<void> {
  const snapshotPath = path.join(
    tempDir,
    `.ephemeral/snapshot-${headSha}.json`,
  );
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf-8")) as Record<
    string,
    unknown
  >;
  mutate(snapshot);
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

describe("play-subagent-execution snapshot helper", () => {
  it.skipIf(!jqAvailable)(
    "executes the canonical snapshot helper for changed file classes",
    async () => {
      const helperSource = await readFile(snapshotHelperScript, "utf-8");
      expect(helperSource).toContain("implementer/snapshot/v1");
      expect(helperSource).toContain(
        '[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink"',
      );
      expect(helperSource).toContain(
        'SNAPSHOT_WORK_DIR=$(mktemp -d ".ephemeral/.snapshot-${HEAD_SHA}-work.XXXXXX")',
      );
      expect(helperSource).toContain(
        'SNAPSHOT_TMP=$(mktemp "$SNAPSHOT_WORK_DIR/snapshot.XXXXXX")',
      );
      expect(helperSource).toContain('mv -f "$SNAPSHOT_TMP" "$SNAPSHOT_FILE"');
      expect(helperSource).toContain(
        '[ -d "$SNAPSHOT_FILE" ] && { echo "snapshot path is a directory: $SNAPSHOT_FILE"',
      );
      expect(helperSource).toContain(
        '[ -f "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE is not a regular file"',
      );
      expect(helperSource).toContain(
        '[ -s "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE"',
      );
      expect(helperSource).toContain("sha256_stream");
      expect(helperSource).toContain("base64_file");
      expect(helperSource).toContain("base64_stream");
      expect(helperSource).toContain("content_round_trips_through_jq");
      expect(helperSource).toContain("path_round_trips_through_jq");
      expect(helperSource).toContain("jq -rj");
      expect(helperSource).toContain("@base64");
      expect(helperSource).toContain('git cat-file blob "HEAD:$path"');
      expect(helperSource).toContain('git ls-tree HEAD -- ":(literal)$path"');
      expect(helperSource).toContain("non-regular changed path is unsupported");
      expect(helperSource).toContain(
        "unsupported non-UTF-8 repo-relative path",
      );
      expect(helperSource).toContain("sha256sum");

      const tempDir = await createTempGitRepo();
      const outsideTarget = path.join(tempDir, "outside-target");
      try {
        await writeFile(path.join(tempDir, "modified.md"), "old\n");
        await writeFile(path.join(tempDir, "deleted.md"), "remove me\n");
        await writeFile(
          path.join(tempDir, "deleted-binary.bin"),
          Buffer.from([0, 1, 2, 0, 3]),
        );
        await writeFile(
          path.join(tempDir, ".gitattributes"),
          "*.invalid diff\n",
        );
        const baseSha = await commitChanges(tempDir, "chore: baseline");

        const modifiedContent = "new\ncontent\n";
        const addedContent = "line without newline";
        const quotedPath = "quoted-\u00e9.md";
        const quotedContent = "path uses unicode\n";
        const thresholdContent = "x".repeat(64000);
        const largeContent = "x".repeat(64001);
        const binaryContent = Buffer.from([0, 1, 2, 0, 3]);
        const invalidUtf8Content = Buffer.from([0xff, 0xfe, 0x41, 0x0a]);
        await writeFile(path.join(tempDir, "modified.md"), modifiedContent);
        await writeFile(path.join(tempDir, "added file.md"), addedContent);
        await writeFile(path.join(tempDir, quotedPath), quotedContent);
        await writeFile(path.join(tempDir, "threshold.txt"), thresholdContent);
        await writeFile(path.join(tempDir, "large.txt"), largeContent);
        await writeFile(path.join(tempDir, "binary.bin"), binaryContent);
        await writeFile(
          path.join(tempDir, "invalid-utf8.invalid"),
          invalidUtf8Content,
        );
        await rm(path.join(tempDir, "deleted.md"));
        await rm(path.join(tempDir, "deleted-binary.bin"));
        const headSha = await commitChanges(tempDir, "feat: update files", [
          "-A",
        ]);
        const snapshotFile = `.ephemeral/snapshot-${headSha}.json`;

        await mkdir(path.join(tempDir, ".ephemeral"));
        if (symlinkAvailable) {
          await writeFile(outsideTarget, "do not overwrite\n");
          await symlink(outsideTarget, path.join(tempDir, snapshotFile));
        }

        const { stdout } = await runSnapshotHelper(tempDir, baseSha);
        expect(stdout.trim()).toBe(`Snapshot written to ${snapshotFile}.`);
        if (symlinkAvailable) {
          expect(await readFile(outsideTarget, "utf-8")).toBe(
            "do not overwrite\n",
          );
        }

        type SnapshotFile = {
          path: string;
          status: string;
          lines: number;
          bytes: number;
          sha256: string;
          content?: string;
          skipped?: string;
        };
        const snapshot = await readSnapshot<{
          schema: string;
          task_id: string;
          head_sha: string;
          files: SnapshotFile[];
        }>(tempDir, headSha);
        const filesByPath = new Map(
          snapshot.files.map((file) => [file.path, file]),
        );

        expect(snapshot.schema).toBe("implementer/snapshot/v1");
        expect(snapshot.task_id).toBe("Task 1");
        expect(snapshot.head_sha).toBe(headSha);
        expect(snapshot.files).toHaveLength(9);

        expect(filesByPath.get("modified.md")).toMatchObject({
          status: "modified",
          lines: 2,
          bytes: Buffer.byteLength(modifiedContent),
          sha256: sha256(modifiedContent),
          content: modifiedContent,
        });
        expect(filesByPath.get("modified.md")).not.toHaveProperty("skipped");

        expect(filesByPath.get("added file.md")).toMatchObject({
          status: "added",
          lines: 1,
          bytes: Buffer.byteLength(addedContent),
          sha256: sha256(addedContent),
          content: addedContent,
        });

        expect(filesByPath.get(quotedPath)).toMatchObject({
          status: "added",
          lines: 1,
          bytes: Buffer.byteLength(quotedContent),
          sha256: sha256(quotedContent),
          content: quotedContent,
        });

        expect(filesByPath.get("threshold.txt")).toMatchObject({
          status: "added",
          lines: 1,
          bytes: Buffer.byteLength(thresholdContent),
          sha256: sha256(thresholdContent),
          content: thresholdContent,
        });
        expect(filesByPath.get("threshold.txt")).not.toHaveProperty("skipped");

        expect(filesByPath.get("deleted.md")).toEqual({
          path: "deleted.md",
          status: "deleted",
          lines: 0,
          bytes: 0,
          sha256: "",
        });
        expect(filesByPath.get("deleted-binary.bin")).toEqual({
          path: "deleted-binary.bin",
          status: "deleted",
          lines: 0,
          bytes: 0,
          sha256: "",
        });

        expect(filesByPath.get("binary.bin")).toMatchObject({
          status: "added",
          bytes: binaryContent.byteLength,
          sha256: sha256(binaryContent),
          skipped: "binary",
        });
        expect(filesByPath.get("binary.bin")).not.toHaveProperty("content");

        expect(filesByPath.get("invalid-utf8.invalid")).toMatchObject({
          status: "added",
          bytes: invalidUtf8Content.byteLength,
          sha256: sha256(invalidUtf8Content),
          skipped: "binary",
        });
        expect(filesByPath.get("invalid-utf8.invalid")).not.toHaveProperty(
          "content",
        );

        expect(filesByPath.get("large.txt")).toMatchObject({
          status: "added",
          lines: 1,
          bytes: Buffer.byteLength(largeContent),
          sha256: sha256(largeContent),
          skipped: "size>64KB",
        });
        expect(filesByPath.get("large.txt")).not.toHaveProperty("content");
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "keeps helper scratch files under the repo-scoped snapshot directory",
    async () => {
      const tempDir = await createTempGitRepo();
      const systemTempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-system-tmp-"),
      );
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        const baseSha = await commitChanges(tempDir, "chore: baseline");
        await writeFile(path.join(tempDir, "file.md"), "new\n");
        await commitChanges(tempDir, "feat: update file");

        await runSnapshotHelper(tempDir, baseSha, { TMPDIR: systemTempDir });

        expect(await readdir(systemTempDir)).toEqual([]);
        expect(await readdir(path.join(tempDir, ".ephemeral"))).toHaveLength(1);
      } finally {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(systemTempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects empty snapshot diffs",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "file.md"), "unchanged\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        await expect(
          runSnapshotHelper(tempDir, headStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot has no changed files"),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects changed symlink paths before reading linked content",
    async () => {
      const helperSource = await readFile(snapshotHelperScript, "utf-8");
      expect(helperSource).toContain("symlink changed path is unsupported");

      const tempDir = await createTempGitRepo();
      const outsideTarget = path.join(tempDir, "outside-target.md");
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        await writeFile(outsideTarget, "outside content must not be read\n");
        await symlink(outsideTarget, path.join(tempDir, "link.md"));
        await execFileAsync("git", ["add", "link.md"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: add symlink"], {
          cwd: tempDir,
        });

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "symlink changed path is unsupported for implementer/snapshot/v1: link.md",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(process.platform !== "linux" || !jqAvailable)(
    "rejects non-UTF-8 changed paths before JSON encoding",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        const baseSha = await commitChanges(tempDir, "chore: baseline");

        await execFileAsync(
          "bash",
          [
            "-c",
            "printf 'bad\\n' > $'bad\\xff.md' && git add -A && git commit -m 'feat: add invalid path'",
          ],
          { cwd: tempDir },
        );

        await expect(runSnapshotHelper(tempDir, baseSha)).rejects.toMatchObject(
          {
            stderr: expect.stringContaining(
              "unsupported non-UTF-8 repo-relative path for implementer/snapshot/v1",
            ),
          },
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "rejects changed paths that start with parent-directory components",
    async () => {
      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const binDir = await mkdtemp(path.join(os.tmpdir(), "devcanon-git-"));
      const fakeGit = path.join(binDir, "git");
      try {
        await writeFile(
          fakeGit,
          `#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ]; then
  exit 0
fi

if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'
  exit 0
fi

if [ "$1" = "diff" ]; then
  case " $* " in
    *" --name-status "*) printf 'A\\0../file\\0'; exit 0 ;;
    *" --numstat "*) printf '1\\t0\\t../file\\0'; exit 0 ;;
  esac
fi

echo "unexpected git invocation: $*" >&2
exit 1
`,
          { mode: 0o755 },
        );
        await chmod(fakeGit, 0o755);

        await expect(
          runSnapshotHelper(
            tempDir,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            {
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "unsupported repo-relative path for implementer/snapshot/v1: ../file",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(binDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects committed non-regular HEAD entries",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        const baseSha = await commitChanges(tempDir, "chore: baseline");
        await execFileAsync(
          "git",
          [
            "update-index",
            "--add",
            "--cacheinfo",
            "160000",
            baseSha,
            "submodule",
          ],
          { cwd: tempDir },
        );
        await execFileAsync("git", ["commit", "-m", "feat: add gitlink"], {
          cwd: tempDir,
        });

        await expect(runSnapshotHelper(tempDir, baseSha)).rejects.toMatchObject(
          {
            stderr: expect.stringContaining(
              "non-regular changed path is unsupported for implementer/snapshot/v1: submodule",
            ),
          },
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects committed HEAD symlinks even when the working-tree path is replaced",
    async () => {
      const tempDir = await createTempGitRepo();
      const outsideTarget = path.join(tempDir, "outside-target.md");
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        await writeFile(outsideTarget, "outside content must not be read\n");
        await symlink(outsideTarget, path.join(tempDir, "link.md"));
        await execFileAsync("git", ["add", "link.md"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: add symlink"], {
          cwd: tempDir,
        });
        await rm(path.join(tempDir, "link.md"));
        await writeFile(
          path.join(tempDir, "link.md"),
          "mutable working-tree replacement\n",
        );

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "symlink changed path is unsupported for implementer/snapshot/v1: link.md",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "treats pathspec-looking changed filenames as literal HEAD paths",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        const magicPath = ":(glob)*.md";
        const magicContent = "literal pathspec-looking name\n";
        await writeFile(path.join(tempDir, magicPath), magicContent);
        await execFileAsync("git", ["add", "--", `./${magicPath}`], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["commit", "-m", "feat: add pathspec-looking file"],
          {
            cwd: tempDir,
          },
        );
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;

        await runSnapshotHelper(tempDir, baseStdout.trim());

        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as {
          files: Array<{ path: string; content: string }>;
        };
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: magicPath,
            content: magicContent,
          }),
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "replaces a preexisting snapshot hardlink without truncating its target",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        await writeFile(path.join(tempDir, "file.md"), "new\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = path.join(
          tempDir,
          `.ephemeral/snapshot-${headStdout.trim()}.json`,
        );
        const hardlinkTarget = path.join(tempDir, "hardlink-target.json");
        await mkdir(path.dirname(snapshotFile), { recursive: true });
        await writeFile(hardlinkTarget, "do not truncate\n");
        await link(hardlinkTarget, snapshotFile);

        await runSnapshotHelper(tempDir, baseStdout.trim());

        expect(await readFile(hardlinkTarget, "utf-8")).toBe(
          "do not truncate\n",
        );
        expect(await readFile(snapshotFile, "utf-8")).toContain(
          '"schema": "implementer/snapshot/v1"',
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects a directory at the target snapshot path before reporting success",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        await writeFile(path.join(tempDir, "file.md"), "new\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;
        await mkdir(path.join(tempDir, snapshotFile), { recursive: true });

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stdout: "",
          stderr: expect.stringContaining(
            `snapshot path is a directory: ${snapshotFile}`,
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "snapshots committed HEAD content when the working-tree file is replaced",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        await writeFile(path.join(tempDir, "file.md"), "committed\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;
        const hardlinkTarget = path.join(tempDir, "hardlink-source.md");
        await writeFile(hardlinkTarget, "outside secret\n");
        await rm(path.join(tempDir, "file.md"));
        await link(hardlinkTarget, path.join(tempDir, "file.md"));

        await runSnapshotHelper(tempDir, baseStdout.trim());

        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as {
          files: Array<{ path: string; content: string; sha256: string }>;
        };
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: "file.md",
            content: "committed\n",
            sha256: sha256("committed\n"),
          }),
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects changed paths with symlinked parent directories before reading content",
    async () => {
      const tempDir = await createTempGitRepo();
      const outsideDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-target-"),
      );
      try {
        await mkdir(path.join(tempDir, "dir"));
        await writeFile(path.join(tempDir, "dir/file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        await writeFile(path.join(tempDir, "dir/file.md"), "committed\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });

        await writeFile(
          path.join(outsideDir, "file.md"),
          "outside content must not be read\n",
        );
        await rm(path.join(tempDir, "dir"), { recursive: true, force: true });
        await symlink(outsideDir, path.join(tempDir, "dir"));

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "symlink changed path is unsupported for implementer/snapshot/v1: dir/file.md",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(outsideDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects unsupported type-change status",
    async () => {
      const tempDir = await createTempGitRepo();
      const outsideDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-target-"),
      );
      const outsideTarget = path.join(outsideDir, "outside-target.md");
      try {
        await writeFile(path.join(tempDir, "type-change.md"), "regular\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        await rm(path.join(tempDir, "type-change.md"));
        await writeFile(outsideTarget, "outside content must not be read\n");
        await symlink(outsideTarget, path.join(tempDir, "type-change.md"));
        await execFileAsync("git", ["add", "-A"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: change file type"], {
          cwd: tempDir,
        });

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "unsupported git diff status T for type-change.md",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(outsideDir);
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "preserves tab-padded binary paths",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        const binaryPath = "\tbin";
        const trailingTabBinaryPath = "bin\t";
        const binaryContent = Buffer.from([0, 1, 2, 0, 3]);
        await writeFile(path.join(tempDir, binaryPath), binaryContent);
        await writeFile(
          path.join(tempDir, trailingTabBinaryPath),
          binaryContent,
        );
        await execFileAsync("git", ["add", "-A"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: add binary"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;

        await runSnapshotHelper(tempDir, baseStdout.trim());

        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as {
          files: Array<{ path: string; skipped?: string; content?: string }>;
        };
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: binaryPath,
            skipped: "binary",
          }),
        );
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: trailingTabBinaryPath,
            skipped: "binary",
          }),
        );
        expect(
          snapshot.files.find((file) => file.path === binaryPath),
        ).not.toHaveProperty("content");
        expect(
          snapshot.files.find((file) => file.path === trailingTabBinaryPath),
        ).not.toHaveProperty("content");
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it("documents sha256sum fallback in the helper source", async () => {
    expect(await readFile(snapshotHelperScript, "utf-8")).toContain(
      "sha256sum",
    );
  });
  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "skips large Git-text files before jq rawfile content transport",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );

        const largeContent = "x".repeat(64001);
        await writeFile(path.join(tempDir, "large.txt"), largeContent);
        await execFileAsync("git", ["add", "large.txt"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: add large text"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;

        const fakeBin = path.join(tempDir, "fake-bin");
        await mkdir(fakeBin);
        const hasherCommand = (await commandAvailable("shasum"))
          ? "shasum"
          : "sha256sum";
        const requiredCommands = [
          "git",
          "awk",
          "wc",
          "tr",
          "grep",
          "cat",
          "base64",
          "mktemp",
          "rm",
          "mkdir",
          "mv",
          hasherCommand,
        ];
        for (const command of requiredCommands) {
          await writeCommandWrapper(fakeBin, command);
        }
        const jqWrapper = path.join(fakeBin, "jq");
        await writeFile(
          jqWrapper,
          `#!/bin/sh\nprev=\nfor arg in "$@"; do\n  if [ "$prev" = "--rawfile" ] && [ "$arg" = "content" ]; then\n    echo "unexpected jq --rawfile content" >&2\n    exit 99\n  fi\n  prev=$arg\ndone\nexec ${shellSingleQuote(await commandPath("jq"))} "$@"\n`,
          { mode: 0o755 },
        );
        await chmod(jqWrapper, 0o755);

        await execFileAsync(
          await nodeExecutablePath("bash"),
          [snapshotHelperScript],
          {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              PATH: fakeBin,
              SNAPSHOT_TASK_ID: "Task 1",
            },
          },
        );

        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as {
          files: Array<{ path: string; skipped?: string; content?: string }>;
        };
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: "large.txt",
            skipped: "size>64KB",
          }),
        );
        expect(
          snapshot.files.find((file) => file.path === "large.txt"),
        ).not.toHaveProperty("content");
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );
  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "uses sha256sum when shasum is unavailable",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        await writeFile(path.join(tempDir, "file.md"), "new\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const snapshotFile = `.ephemeral/snapshot-${headStdout.trim()}.json`;

        const fakeBin = path.join(tempDir, "fake-bin");
        await mkdir(fakeBin);
        const requiredCommands = [
          "git",
          "jq",
          "awk",
          "wc",
          "tr",
          "grep",
          "cat",
          "base64",
          "mktemp",
          "rm",
          "mkdir",
          "mv",
        ];
        for (const command of requiredCommands) {
          await writeCommandWrapper(fakeBin, command);
        }
        const fallbackHasher = path.join(fakeBin, "sha256sum");
        await writeFile(
          fallbackHasher,
          "#!/bin/sh\ncat >/dev/null\nprintf 'fallback-sha256  -\\n'\n",
          { mode: 0o755 },
        );
        await chmod(fallbackHasher, 0o755);

        await execFileAsync(
          await nodeExecutablePath("bash"),
          [snapshotHelperScript],
          {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              PATH: fakeBin,
              SNAPSHOT_TASK_ID: "Task 1",
            },
          },
        );

        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as { files: Array<{ path: string; sha256: string }> };
        expect(snapshot.files).toContainEqual(
          expect.objectContaining({
            path: "file.md",
            sha256: "fallback-sha256",
          }),
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when jq is unavailable",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        const fakeBin = path.join(tempDir, "fake-bin");
        await mkdir(fakeBin);
        const requiredExceptJq = [
          "git",
          "awk",
          "wc",
          "tr",
          "grep",
          "cat",
          "base64",
          "mktemp",
          "rm",
          "mkdir",
          "mv",
        ];
        for (const command of requiredExceptJq) {
          await writeCommandWrapper(fakeBin, command);
        }

        await expect(
          execFileAsync(
            await nodeExecutablePath("bash"),
            [snapshotHelperScript],
            {
              cwd: tempDir,
              env: {
                ...process.env,
                BASE_SHA: "0000000000000000000000000000000000000000",
                PATH: fakeBin,
                SNAPSHOT_TASK_ID: "Task 1",
              },
            },
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "jq is required to write implementer/snapshot/v1",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects a symlinked snapshot directory",
    async () => {
      const tempDir = await createTempGitRepo();
      const outsideDir = path.join(tempDir, "outside");
      try {
        await writeFile(path.join(tempDir, "file.md"), "old\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
          cwd: tempDir,
        });
        const { stdout: baseStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        await writeFile(path.join(tempDir, "file.md"), "new\n");
        await execFileAsync("git", ["add", "."], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update file"], {
          cwd: tempDir,
        });

        await mkdir(outsideDir);
        await symlink(outsideDir, path.join(tempDir, ".ephemeral"));

        await expect(
          runSnapshotHelper(tempDir, baseStdout.trim()),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            ".ephemeral must be a directory, not a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "uses HEAD-only snapshot paths across detached and unsafe branch names",
    async () => {
      async function writeSnapshotOnCurrentBranch(
        branchSetup: (tempDir: string) => Promise<void>,
      ) {
        const tempDir = await createTempGitRepo();
        try {
          await writeFile(path.join(tempDir, "file.md"), "old\n");
          await execFileAsync("git", ["add", "."], { cwd: tempDir });
          await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
            cwd: tempDir,
          });
          await branchSetup(tempDir);
          const { stdout: baseStdout } = await execFileAsync(
            "git",
            ["rev-parse", "HEAD"],
            {
              cwd: tempDir,
            },
          );
          await writeFile(path.join(tempDir, "file.md"), "new\n");
          await execFileAsync("git", ["add", "."], { cwd: tempDir });
          await execFileAsync("git", ["commit", "-m", "feat: update file"], {
            cwd: tempDir,
          });

          const { stdout } = await runSnapshotHelper(
            tempDir,
            baseStdout.trim(),
          );
          return stdout.trim();
        } finally {
          await cleanupTempDir(tempDir);
        }
      }

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync(
            "git",
            ["checkout", "-b", "feature/snapshot+recipe"],
            {
              cwd: tempDir,
            },
          );
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/snapshot-[0-9a-f]{40}\.json\.$/,
      );

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync("git", ["checkout", "-b", "feature/a.+.b"], {
            cwd: tempDir,
          });
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/snapshot-[0-9a-f]{40}\.json\.$/,
      );

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync("git", ["checkout", "--detach", "HEAD"], {
            cwd: tempDir,
          });
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/snapshot-[0-9a-f]{40}\.json\.$/,
      );

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync("git", ["checkout", "-b", "!!!"], {
            cwd: tempDir,
          });
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/snapshot-[0-9a-f]{40}\.json\.$/,
      );
    },
    30_000,
  );
});

describe("play-subagent-execution snapshot validator", () => {
  it.skipIf(!jqAvailable)(
    "validates a requested snapshot against controller-computed git state",
    async () => {
      const { tempDir, baseSha, headSha, snapshotFile } =
        await writeSnapshotFixture();
      try {
        const { stdout, stderr } = await runSnapshotValidator(
          tempDir,
          baseSha,
          snapshotFile,
        );

        expect(stderr).toBe("");
        expect(stdout).toContain("SNAPSHOT_STATUS=valid\n");
        expect(stdout).toContain(`SNAPSHOT_FILE=${snapshotFile}\n`);
        expect(stdout).toContain(`SNAPSHOT_HEAD_SHA=${headSha}\n`);
        expect(stdout).toContain("SNAPSHOT_CHANGED_FILE_COUNT=1\n");
        expect(stdout).not.toContain("new\n");
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects malformed, nested, and missing snapshot notice paths",
    async () => {
      const { tempDir, baseSha, headSha } = await writeSnapshotFixture();
      try {
        await expect(
          runSnapshotValidator(
            tempDir,
            baseSha,
            `.ephemeral/nested/snapshot-${headSha}.json`,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot path must be flat"),
        });

        await expect(
          runSnapshotValidator(tempDir, baseSha, "../snapshot.json"),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot path validation failed"),
        });

        await expect(
          runSnapshotValidator(
            tempDir,
            baseSha,
            ".ephemeral/snapshot-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "snapshot missing or not a regular file",
          ),
        });

        const mismatchedPath =
          ".ephemeral/snapshot-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json";
        await writeFile(
          path.join(tempDir, mismatchedPath),
          await readFile(
            path.join(tempDir, `.ephemeral/snapshot-${headSha}.json`),
            "utf-8",
          ),
        );

        await expect(
          runSnapshotValidator(tempDir, baseSha, mismatchedPath),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot path head mismatch"),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects symlinked snapshot files before reading them",
    async () => {
      const { tempDir, baseSha, snapshotFile } = await writeSnapshotFixture();
      const outsideTarget = path.join(tempDir, "outside-snapshot.json");
      try {
        await rm(path.join(tempDir, snapshotFile));
        await writeFile(
          outsideTarget,
          '{"schema":"implementer/snapshot/v1"}\n',
        );
        await symlink(outsideTarget, path.join(tempDir, snapshotFile));

        await expect(
          runSnapshotValidator(tempDir, baseSha, snapshotFile),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot must not be a symlink"),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects directories at snapshot paths before parsing JSON",
    async () => {
      const { tempDir, baseSha, snapshotFile } = await writeSnapshotFixture();
      try {
        await rm(path.join(tempDir, snapshotFile));
        await mkdir(path.join(tempDir, snapshotFile));

        await expect(
          runSnapshotValidator(tempDir, baseSha, snapshotFile),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "snapshot missing or not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects schema and head-sha mismatches",
    async () => {
      const schemaFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          schemaFixture.tempDir,
          schemaFixture.headSha,
          (snapshot) => {
            snapshot.schema = "implementer/snapshot/v2";
          },
        );

        await expect(
          runSnapshotValidator(
            schemaFixture.tempDir,
            schemaFixture.baseSha,
            schemaFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot schema mismatch"),
        });
      } finally {
        await cleanupTempDir(schemaFixture.tempDir);
      }

      const headFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          headFixture.tempDir,
          headFixture.headSha,
          (snapshot) => {
            snapshot.head_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
          },
        );

        await expect(
          runSnapshotValidator(
            headFixture.tempDir,
            headFixture.baseSha,
            headFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot head_sha mismatch"),
        });
      } finally {
        await cleanupTempDir(headFixture.tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects unsafe, duplicate, extra, missing, and status-mismatched file entries",
    async () => {
      const unsafeFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          unsafeFixture.tempDir,
          unsafeFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files[0].path = "../file.md";
          },
        );

        await expect(
          runSnapshotValidator(
            unsafeFixture.tempDir,
            unsafeFixture.baseSha,
            unsafeFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "snapshot entry path validation failed",
          ),
        });
      } finally {
        await cleanupTempDir(unsafeFixture.tempDir);
      }

      const duplicateFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          duplicateFixture.tempDir,
          duplicateFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files.push({ ...files[0] });
          },
        );

        await expect(
          runSnapshotValidator(
            duplicateFixture.tempDir,
            duplicateFixture.baseSha,
            duplicateFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot contains duplicate entry"),
        });
      } finally {
        await cleanupTempDir(duplicateFixture.tempDir);
      }

      const extraFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          extraFixture.tempDir,
          extraFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files.push({ ...files[0], path: "extra.md" });
          },
        );

        await expect(
          runSnapshotValidator(
            extraFixture.tempDir,
            extraFixture.baseSha,
            extraFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot changed-file set mismatch"),
        });
      } finally {
        await cleanupTempDir(extraFixture.tempDir);
      }

      const missingFixture = await createTempGitRepo();
      try {
        await writeFile(path.join(missingFixture, "file-a.md"), "old a\n");
        await writeFile(path.join(missingFixture, "file-b.md"), "old b\n");
        const baseSha = await commitChanges(missingFixture, "chore: baseline");
        await writeFile(path.join(missingFixture, "file-a.md"), "new a\n");
        await writeFile(path.join(missingFixture, "file-b.md"), "new b\n");
        const headSha = await commitChanges(
          missingFixture,
          "feat: update files",
        );
        const snapshotFile = `.ephemeral/snapshot-${headSha}.json`;
        await runSnapshotHelper(missingFixture, baseSha);
        await mutateSnapshotFixture(missingFixture, headSha, (snapshot) => {
          const files = snapshot.files as Array<Record<string, unknown>>;
          snapshot.files = files.slice(0, 1);
        });

        await expect(
          runSnapshotValidator(missingFixture, baseSha, snapshotFile),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot changed-file set mismatch"),
        });
      } finally {
        await cleanupTempDir(missingFixture);
      }

      const statusFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          statusFixture.tempDir,
          statusFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files[0].status = "added";
          },
        );

        await expect(
          runSnapshotValidator(
            statusFixture.tempDir,
            statusFixture.baseSha,
            statusFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot changed-file set mismatch"),
        });
      } finally {
        await cleanupTempDir(statusFixture.tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "rejects malformed v1 file entry shapes",
    async () => {
      const missingMetadataFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          missingMetadataFixture.tempDir,
          missingMetadataFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            snapshot.task_id = 42;
            files[0] = {
              path: files[0].path,
              status: files[0].status,
            };
          },
        );

        await expect(
          runSnapshotValidator(
            missingMetadataFixture.tempDir,
            missingMetadataFixture.baseSha,
            missingMetadataFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot schema mismatch"),
        });
      } finally {
        await cleanupTempDir(missingMetadataFixture.tempDir);
      }

      const mutualExclusionFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          mutualExclusionFixture.tempDir,
          mutualExclusionFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files[0].skipped = "binary";
          },
        );

        await expect(
          runSnapshotValidator(
            mutualExclusionFixture.tempDir,
            mutualExclusionFixture.baseSha,
            mutualExclusionFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot schema mismatch"),
        });
      } finally {
        await cleanupTempDir(mutualExclusionFixture.tempDir);
      }

      const deletedContentFixture = await writeSnapshotFixture();
      try {
        await mutateSnapshotFixture(
          deletedContentFixture.tempDir,
          deletedContentFixture.headSha,
          (snapshot) => {
            const files = snapshot.files as Array<Record<string, unknown>>;
            files[0] = {
              ...files[0],
              status: "deleted",
              lines: 0,
              bytes: 0,
              sha256: "",
              content: "deleted content",
            };
          },
        );

        await expect(
          runSnapshotValidator(
            deletedContentFixture.tempDir,
            deletedContentFixture.baseSha,
            deletedContentFixture.snapshotFile,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("snapshot schema mismatch"),
        });
      } finally {
        await cleanupTempDir(deletedContentFixture.tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects non-deleted snapshot entries whose committed HEAD path is not a regular file",
    async () => {
      const tempDir = await createTempGitRepo();
      const outsideTarget = path.join(tempDir, "outside-target.md");
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        const baseSha = await commitChanges(tempDir, "chore: baseline");
        await writeFile(outsideTarget, "outside content must not be trusted\n");
        await symlink(outsideTarget, path.join(tempDir, "link.md"));
        const headSha = await commitChanges(tempDir, "feat: add symlink", [
          "link.md",
        ]);
        const snapshotFile = `.ephemeral/snapshot-${headSha}.json`;
        await mkdir(path.join(tempDir, ".ephemeral"));
        await writeFile(
          path.join(tempDir, snapshotFile),
          `${JSON.stringify(
            {
              schema: "implementer/snapshot/v1",
              task_id: "Task 1",
              head_sha: headSha,
              files: [
                {
                  path: "link.md",
                  status: "added",
                  lines: 1,
                  bytes: 13,
                  sha256:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  content: "fake content\n",
                },
              ],
            },
            null,
            2,
          )}\n`,
        );

        await expect(
          runSnapshotValidator(tempDir, baseSha, snapshotFile),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "snapshot entry path is not a regular HEAD blob",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );

  it.skipIf(!jqAvailable)(
    "accepts newline-bearing paths that the producer wrote byte-faithfully",
    async () => {
      const tempDir = await createTempGitRepo();
      try {
        await writeFile(path.join(tempDir, "baseline.md"), "old\n");
        const baseSha = await commitChanges(tempDir, "chore: baseline");
        const newlinePath = "newline-ending-\n";
        await writeFile(path.join(tempDir, newlinePath), "newline path\n");
        const headSha = await commitChanges(tempDir, "feat: add newline path");
        const snapshotFile = `.ephemeral/snapshot-${headSha}.json`;

        await runSnapshotHelper(tempDir, baseSha);

        await expect(
          runSnapshotValidator(tempDir, baseSha, snapshotFile),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining("SNAPSHOT_STATUS=valid\n"),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    30_000,
  );
});
