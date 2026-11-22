import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const runner = path.resolve("scripts/run-vitest.mjs");

interface TestProcesses {
  leader: number;
  worker: number;
  descendant: number;
}

async function readTestProcesses(directory: string, index: number) {
  try {
    return JSON.parse(
      await readFile(path.join(directory, `ready-${index}`), "utf8"),
    ) as TestProcesses;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

async function liveProcessStates(pids: number[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "stat=",
      "-p",
      pids.join(","),
    ]);
    // An exited orphan can remain a zombie until the OS reaps it.
    return stdout
      .trim()
      .split(/\s+/)
      .filter((state) => state && !state.startsWith("Z"));
  } catch (error) {
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
}

function stopProcessGroup(group: number): void {
  try {
    process.kill(-group, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

it.skipIf(process.platform === "win32").each([
  { target: "launcher", signal: "SIGTERM", exitCode: 143 },
  { target: "Vitest leader", signal: "SIGKILL", exitCode: 137 },
] as const)(
  "terminates all fork workers and their children when the $target receives $signal",
  async ({ target, signal, exitCode }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "devcanon-vitest-"));
    const config = path.join(directory, "vitest.config.mjs");
    let launcher: ReturnType<typeof spawn> | undefined;
    let leader: number | undefined;
    let closed: Promise<unknown> | undefined;
    try {
      await writeFile(
        config,
        'export default { test: { globals: true, pool: "forks" } };\n',
      );
      for (const index of [0, 1]) {
        await writeFile(
          path.join(directory, `worker-${index}.test.mjs`),
          `import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

test("keep the process tree active", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  writeFileSync("pending-${index}", JSON.stringify({
    leader: process.ppid,
    worker: process.pid,
    descendant: child.pid,
  }));
  renameSync("pending-${index}", "ready-${index}");
  await setTimeout(15_000);
}, 20_000);
`,
        );
      }
      launcher = spawn(
        process.execPath,
        [runner, "run", "--config", config, "--maxWorkers=2"],
        {
          cwd: directory,
          env: { ...process.env, VITEST_MAX_FORKS: "2", VITEST_MIN_FORKS: "1" },
          stdio: "ignore",
        },
      );
      closed = new Promise((resolve, reject) => {
        launcher?.once("error", reject);
        launcher?.once("close", (code, exitSignal) =>
          resolve({ code, exitSignal }),
        );
      });
      // An early process error must still be awaited if no worker starts.
      void closed.catch(() => {});
      const readWorkers = () =>
        Promise.all([0, 1].map((index) => readTestProcesses(directory, index)));
      await expect
        .poll(readWorkers, { timeout: 5000 })
        .toEqual([expect.any(Object), expect.any(Object)]);
      const [first, second] = await readWorkers();
      if (!first || !second || launcher.pid === undefined) {
        throw new Error("Vitest did not report both fork workers");
      }
      leader = first.leader;
      expect(second.leader).toBe(leader);
      expect(first.worker).not.toBe(second.worker);
      const pids = [
        leader,
        first.worker,
        second.worker,
        first.descendant,
        second.descendant,
      ];
      expect(await liveProcessStates(pids)).toHaveLength(pids.length);

      process.kill(target === "launcher" ? launcher.pid : leader, signal);

      await expect
        .poll(() => liveProcessStates(pids), { timeout: 4000 })
        .toEqual([]);
      await expect(closed).resolves.toEqual({
        code: exitCode,
        exitSignal: null,
      });
    } finally {
      // Keep cleanup local even when an assertion fails before both workers start.
      const group =
        leader ??
        (await readTestProcesses(directory, 0))?.leader ??
        (await readTestProcesses(directory, 1))?.leader;
      if (group === undefined) {
        // Let the launcher clean up the detached group before it exits.
        launcher?.kill("SIGTERM");
      } else {
        stopProcessGroup(group);
        launcher?.kill("SIGKILL");
      }
      await closed?.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
);
