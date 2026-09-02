#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runBootstrapCli } from "./bootstrap-cli.js";
import { runRuntimeCli } from "./cli.js";

const [selector, ...arguments_] = process.argv.slice(2);

switch (selector) {
  case "runtime":
    await runRuntimeCli(arguments_, {
      entrypoint: fileURLToPath(import.meta.url),
      arguments: ["runtime", ...arguments_],
    });
    break;
  case "bootstrap":
    await runBootstrapCli(arguments_);
    break;
  default:
    process.stderr.write(
      "runtime bundle selector must be runtime or bootstrap\n",
    );
    process.exitCode = 1;
}
