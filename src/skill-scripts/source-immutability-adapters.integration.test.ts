import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const runtimeSkill = path.join(repoRoot, "skills/devcanon-runtime");
const adapterSkills = [
  "issue-priming-workflow",
  "play-agent-dispatch",
  "play-planning",
  "play-review",
  "play-skill-authoring",
  "play-subagent-execution",
  "pr-merge",
] as const;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-adapter-guard-"));
  tempDirs.push(cwd);
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.name", "Test User");
  await git(cwd, "config", "user.email", "test@example.com");
  await writeFile(path.join(cwd, ".gitignore"), ".ephemeral/\n");
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await git(cwd, "add", ".gitignore", "README.md");
  await git(cwd, "commit", "-m", "chore: baseline");
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

function sourceAdapter(skill: string): string {
  return path.join(
    repoRoot,
    "skills",
    skill,
    "scripts",
    "source-immutability.sh",
  );
}

describe("source-immutability workflow adapters", () => {
  it.each(adapterSkills)(
    "%s forwards capture, verify, cleanup, arguments, and process output through the sibling runtime layout",
    async (skill) => {
      const cwd = await workspace();
      const adapter = sourceAdapter(skill);
      const handoff = `.ephemeral/${skill}.json`;
      const captured = await execFileAsync(
        "bash",
        [adapter, "capture", "--handoff", handoff],
        {
          cwd,
        },
      );
      expect(captured.stderr).toBe("");
      expect(captured.stdout).toMatch(
        /^\.ephemeral\/\.devcanon-source-immutability-[0-9a-f]{32}\.json\n$/u,
      );
      const baseline = captured.stdout.trim();
      await writeFile(path.join(cwd, handoff), "payload\n");

      await expect(
        execFileAsync(
          "bash",
          [adapter, "verify", "--baseline", baseline, "--handoff", handoff],
          { cwd },
        ),
      ).resolves.toMatchObject({ stdout: "unchanged\n", stderr: "" });
      await expect(
        execFileAsync(
          "bash",
          [adapter, "cleanup", "--baseline", baseline, "--handoff", handoff],
          { cwd },
        ),
      ).resolves.toMatchObject({ stdout: "cleaned\n", stderr: "" });
    },
  );

  it.each(adapterSkills)(
    "%s honors DEVCANON_RUNTIME_DIR and forwards failure stderr and exit code",
    async (skill) => {
      const cwd = await workspace();
      const bundle = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-runtime-override-"),
      );
      tempDirs.push(bundle);
      const copiedRuntime = path.join(bundle, "devcanon-runtime");
      await cp(runtimeSkill, copiedRuntime, { recursive: true });

      await expect(
        execFileAsync("bash", [sourceAdapter(skill), "verify"], {
          cwd,
          env: { ...process.env, DEVCANON_RUNTIME_DIR: copiedRuntime },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: "verify requires --baseline\n",
      });
    },
  );
});
