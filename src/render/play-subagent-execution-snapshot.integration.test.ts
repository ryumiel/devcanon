import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
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

describe("play-subagent-execution snapshot helper", () => {
  it.skipIf(!jqAvailable)(
    "executes the canonical snapshot helper for changed file classes",
    async () => {
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );
      const helperSource = await readFile(helperScript, "utf-8");
      expect(helperSource).toContain("implementer/snapshot/v1");
      expect(helperSource).toContain(
        '[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink"',
      );
      expect(helperSource).toContain(
        'SNAPSHOT_TMP=$(mktemp ".ephemeral/.${BRANCH_SLUG}-${HEAD_SHA}-snapshot.XXXXXX")',
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
      expect(helperSource).toContain("content_round_trips_through_jq");
      expect(helperSource).toContain("jq -rj");
      expect(helperSource).toContain("@base64");
      expect(helperSource).toContain('git cat-file blob "HEAD:$path"');
      expect(helperSource).toContain('git ls-tree HEAD -- ":(literal)$path"');
      expect(helperSource).toContain("sha256sum");

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideTarget = path.join(tempDir, "outside-target");
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

        await writeFile(path.join(tempDir, "modified.md"), "old\n");
        await writeFile(path.join(tempDir, "deleted.md"), "remove me\n");
        await writeFile(
          path.join(tempDir, ".gitattributes"),
          "*.invalid diff\n",
        );
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
        const baseSha = baseStdout.trim();

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
        await execFileAsync("git", ["add", "-A"], { cwd: tempDir });
        await execFileAsync("git", ["commit", "-m", "feat: update files"], {
          cwd: tempDir,
        });
        const { stdout: headStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          {
            cwd: tempDir,
          },
        );
        const headSha = headStdout.trim();
        const snapshotFile = `.ephemeral/main-${headSha}-snapshot.json`;

        await mkdir(path.join(tempDir, ".ephemeral"));
        if (symlinkAvailable) {
          await writeFile(outsideTarget, "do not overwrite\n");
          await symlink(outsideTarget, path.join(tempDir, snapshotFile));
        }

        const { stdout } = await execFileAsync("bash", [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseSha,
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });
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
        const snapshot = JSON.parse(
          await readFile(path.join(tempDir, snapshotFile), "utf-8"),
        ) as {
          schema: string;
          task_id: string;
          head_sha: string;
          files: SnapshotFile[];
        };
        const filesByPath = new Map(
          snapshot.files.map((file) => [file.path, file]),
        );

        expect(snapshot.schema).toBe("implementer/snapshot/v1");
        expect(snapshot.task_id).toBe("Task 1");
        expect(snapshot.head_sha).toBe(headSha);
        expect(snapshot.files).toHaveLength(8);

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
    "rejects empty snapshot diffs",
    async () => {
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );
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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: headStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );
      const helperSource = await readFile(helperScript, "utf-8");
      expect(helperSource).toContain("symlink changed path is unsupported");

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideTarget = path.join(tempDir, "outside-target.md");
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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

  it.skipIf(!symlinkAvailable || !jqAvailable)(
    "rejects committed HEAD symlinks even when the working-tree path is replaced",
    async () => {
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideTarget = path.join(tempDir, "outside-target.md");
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
        await execFileAsync("git", ["add", "--", magicPath], { cwd: tempDir });
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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;

        await execFileAsync("bash", [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
          `.ephemeral/main-${headStdout.trim()}-snapshot.json`,
        );
        const hardlinkTarget = path.join(tempDir, "hardlink-target.json");
        await mkdir(path.dirname(snapshotFile), { recursive: true });
        await writeFile(hardlinkTarget, "do not truncate\n");
        await link(hardlinkTarget, snapshotFile);

        await execFileAsync("bash", [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;
        await mkdir(path.join(tempDir, snapshotFile), { recursive: true });

        await expect(
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;
        const hardlinkTarget = path.join(tempDir, "hardlink-source.md");
        await writeFile(hardlinkTarget, "outside secret\n");
        await rm(path.join(tempDir, "file.md"));
        await link(hardlinkTarget, path.join(tempDir, "file.md"));

        await execFileAsync("bash", [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-target-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-target-"),
      );
      const outsideTarget = path.join(outsideDir, "outside-target.md");
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );

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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );
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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;

        await execFileAsync("bash", [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
    const repoRoot = process.cwd();
    const helperScript = path.join(
      repoRoot,
      "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
    );

    expect(await readFile(helperScript, "utf-8")).toContain("sha256sum");
  });
  it.skipIf(process.platform === "win32" || !jqAvailable)(
    "skips large Git-text files before jq rawfile content transport",
    async () => {
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );
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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;

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

        await execFileAsync(await nodeExecutablePath("bash"), [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            PATH: fakeBin,
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );
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
        const snapshotFile = `.ephemeral/main-${headStdout.trim()}-snapshot.json`;

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

        await execFileAsync(await nodeExecutablePath("bash"), [helperScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            BASE_SHA: baseStdout.trim(),
            PATH: fakeBin,
            SNAPSHOT_TASK_ID: "Task 1",
          },
        });

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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
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
          execFileAsync(await nodeExecutablePath("bash"), [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: "0000000000000000000000000000000000000000",
              PATH: fakeBin,
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-snapshot-"),
      );
      const outsideDir = path.join(tempDir, "outside");
      try {
        await execFileAsync("git", ["init", "--initial-branch=main"], {
          cwd: tempDir,
        });
        await execFileAsync("git", ["config", "user.name", "Test User"], {
          cwd: tempDir,
        });
        await execFileAsync(
          "git",
          ["config", "user.email", "test@example.com"],
          {
            cwd: tempDir,
          },
        );
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
          execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          }),
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
    "uses canonical branch slug fallbacks for detached and unsafe branch names",
    async () => {
      const repoRoot = process.cwd();
      const helperScript = path.join(
        repoRoot,
        "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
      );

      async function writeSnapshotOnCurrentBranch(
        branchSetup: (tempDir: string) => Promise<void>,
      ) {
        const tempDir = await mkdtemp(
          path.join(os.tmpdir(), "devcanon-snapshot-"),
        );
        try {
          await execFileAsync("git", ["init", "--initial-branch=main"], {
            cwd: tempDir,
          });
          await execFileAsync("git", ["config", "user.name", "Test User"], {
            cwd: tempDir,
          });
          await execFileAsync(
            "git",
            ["config", "user.email", "test@example.com"],
            {
              cwd: tempDir,
            },
          );
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

          const { stdout } = await execFileAsync("bash", [helperScript], {
            cwd: tempDir,
            env: {
              ...process.env,
              BASE_SHA: baseStdout.trim(),
              SNAPSHOT_TASK_ID: "Task 1",
            },
          });
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
        /^Snapshot written to \.ephemeral\/feature-snapshotrecipe-[0-9a-f]{40}-snapshot\.json\.$/,
      );

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync("git", ["checkout", "--detach", "HEAD"], {
            cwd: tempDir,
          });
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/detached-[0-9a-f]{40}-snapshot\.json\.$/,
      );

      await expect(
        writeSnapshotOnCurrentBranch(async (tempDir) => {
          await execFileAsync("git", ["checkout", "-b", "!!!"], {
            cwd: tempDir,
          });
        }),
      ).resolves.toMatch(
        /^Snapshot written to \.ephemeral\/unnamed-[0-9a-f]{40}-snapshot\.json\.$/,
      );
    },
    30_000,
  );
});
