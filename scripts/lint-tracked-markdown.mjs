#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { getRequestedMarkdownFiles } from "./select-markdown-files.mjs";

const files = getRequestedMarkdownFiles(process.argv.slice(2));

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "markdownlint-cli2", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
