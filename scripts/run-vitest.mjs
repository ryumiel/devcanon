import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const vitest = fileURLToPath(
  new URL("vitest.mjs", import.meta.resolve("vitest/package.json")),
);
const child = spawn(process.execPath, [vitest, ...process.argv.slice(2)], {
  detached: !windows,
  stdio: "inherit",
});
const signals = windows
  ? ["SIGINT", "SIGTERM", "SIGBREAK"]
  : ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
let cancellation;
let forceTimer;

function signalGroup(signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code === "ESRCH") return;
    // macOS can report EPERM during exit while only zombies remain in the group.
    if (error.code === "EPERM") {
      const processes = spawnSync("/bin/ps", ["-axo", "pgid=,stat="], {
        encoding: "utf8",
      });
      if (
        processes.status === 0 &&
        !processes.stdout.split("\n").some((line) => {
          const [group, state] = line.trim().split(/\s+/);
          return Number(group) === child.pid && !state?.startsWith("Z");
        })
      ) {
        return;
      }
    }
    throw error;
  }
}

const handlers = signals.map((signal) => {
  const cancel = () => {
    cancellation ??= signal;
    if (windows) {
      if (child.pid === undefined) return;
      const taskkill = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      );
      const result = spawnSync(
        taskkill,
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "ignore",
          timeout: 2000,
          windowsHide: true,
        },
      );
      if (result.error || result.status !== 0) {
        console.error(
          "Could not cancel the Vitest process tree with taskkill.",
        );
      }
      return;
    }
    if (forceTimer) {
      signalGroup("SIGKILL");
    } else {
      signalGroup(signal);
      forceTimer = setTimeout(() => signalGroup("SIGKILL"), 1000);
    }
  };
  process.on(signal, cancel);
  return [signal, cancel];
});

function finish() {
  clearTimeout(forceTimer);
  for (const [signal, handler] of handlers) process.off(signal, handler);
}

child.once("error", (error) => {
  finish();
  console.error(`Could not start Vitest: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  // The leader can exit before its workers, including after a direct signal.
  if (!windows) signalGroup("SIGKILL");
  finish();
  const exitSignal = cancellation ?? signal;
  process.exitCode = exitSignal ? 128 + constants.signals[exitSignal] : code;
});
