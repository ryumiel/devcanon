#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./run.js";

void runCli(
  "source-build",
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
