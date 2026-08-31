#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const { DEBUG: _debug, NODE_OPTIONS, ...runtimeEnvironment } = process.env;
if (NODE_OPTIONS !== undefined) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        env: runtimeEnvironment,
        stdio: "inherit",
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.signal !== null) {
        process.kill(process.pid, result.signal);
    }
    else {
        process.exitCode = result.status ?? 1;
    }
}
else {
    const { runRuntimeCommand } = await import("./command.js");
    const result = await runRuntimeCommand(process.argv.slice(2));
    if (result.stdout.length > 0) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr.length > 0) {
        process.stderr.write(result.stderr);
    }
    process.exitCode = result.exitCode;
}
