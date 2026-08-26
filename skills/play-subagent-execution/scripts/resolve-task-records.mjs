#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  accessSync,
  lstatSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const usagePath = path.resolve(
  path.dirname(scriptPath),
  "../references/resolve-task-records-usage.md",
);
const taskIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

function isRecordId(value) {
  return typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function diagnosticValue(value) {
  return JSON.stringify(value);
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) fail(`missing required environment variable: ${name}`);
  return value;
}

function printHelp() {
  if (process.argv.length !== 3) {
    fail("--help does not accept additional arguments");
  }
  try {
    const stat = lstatSync(usagePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`usage document missing or unreadable: ${usagePath}`);
    }
    accessSync(usagePath, constants.R_OK);
    process.stdout.write(readFileSync(usagePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("usage document")) {
      throw error;
    }
    fail(`usage document missing or unreadable: ${usagePath}`);
  }
}

if (process.argv[2] === "--help") {
  printHelp();
  process.exit(0);
}
if (process.argv.length !== 2) fail("positional arguments are not accepted");

function rejectNonemptyStdin() {
  if (process.stdin.isTTY) return;
  const stdin = new Uint8Array(1);
  try {
    if (readSync(0, stdin, 0, 1, null) !== 0) fail("stdin is not accepted");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EAGAIN") {
      fail("stdin emptiness could not be established");
    }
    fail("failed to validate stdin");
  }
}

rejectNonemptyStdin();

function requireRepositoryRoot() {
  let repositoryRoot;
  try {
    repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("failed to determine git repository root");
  }

  let cwdReal;
  let rootReal;
  try {
    cwdReal = realpathSync(process.cwd());
    rootReal = realpathSync(repositoryRoot);
  } catch {
    fail("failed to resolve git repository root");
  }
  if (cwdReal !== rootReal) {
    fail("resolve-task-records.mjs must run from the repository root");
  }
  return rootReal;
}

function validatePlanPath(repositoryRoot, planPath) {
  if (
    planPath.includes("..") ||
    !/^\.ephemeral\/[^\\/]*-plan\.md$/.test(planPath)
  ) {
    fail(`plan path validation failed: ${diagnosticValue(planPath)}`);
  }

  const ephemeralPath = path.join(repositoryRoot, ".ephemeral");
  const absolutePlanPath = path.join(repositoryRoot, planPath);
  try {
    const ephemeralStat = lstatSync(ephemeralPath);
    if (!ephemeralStat.isDirectory() || ephemeralStat.isSymbolicLink()) {
      fail(".ephemeral must be a directory, not a symlink");
    }
    const planStat = lstatSync(absolutePlanPath);
    if (!planStat.isFile() || planStat.isSymbolicLink()) {
      fail(`plan missing or not a regular file: ${diagnosticValue(planPath)}`);
    }
    accessSync(absolutePlanPath, constants.R_OK);
  } catch (error) {
    if (error instanceof Error && /^(\.ephemeral|plan )/.test(error.message)) {
      throw error;
    }
    fail(`plan missing or unreadable: ${diagnosticValue(planPath)}`);
  }
  return absolutePlanPath;
}

function visibleLines(markdown) {
  const result = [];
  const sourceLines = markdown.split(/\r?\n/);
  let fence;
  let htmlComment = false;
  let inlineCodeEnd;
  for (const [index, sourceText] of sourceLines.entries()) {
    let text = sourceText;
    if (!fence) {
      if (inlineCodeEnd && index < inlineCodeEnd.line) continue;
      let visible = inlineCodeEnd ? " " : "";
      let cursor = inlineCodeEnd?.end ?? 0;
      inlineCodeEnd = undefined;
      while (cursor < text.length) {
        if (htmlComment) {
          const end = text.indexOf("-->", cursor);
          if (end === -1) {
            cursor = text.length;
            continue;
          }
          htmlComment = false;
          cursor = end + 3;
          continue;
        }
        const start = text.indexOf("<!--", cursor);
        const codeStart = nextUnescapedBacktick(text, cursor);
        if (codeStart !== -1 && (start === -1 || codeStart < start)) {
          const runLength = backtickRunLength(text, codeStart);
          const codeEnd = matchingBacktickRunEnd(
            text,
            codeStart + runLength,
            runLength,
          );
          if (codeEnd !== -1) {
            visible += text.slice(cursor, codeEnd);
            cursor = codeEnd;
            continue;
          }
          const multilineEnd =
            /^(?:### (?:Boundary row|Task)|(?:- )?\*\*)/.test(text)
              ? undefined
              : matchingBacktickRunAcrossLines(sourceLines, index, runLength);
          if (multilineEnd) {
            visible += text.slice(cursor);
            cursor = text.length;
            inlineCodeEnd = multilineEnd;
            continue;
          }
          visible += text.slice(cursor, codeStart + runLength);
          cursor = codeStart + runLength;
          continue;
        }
        if (start === -1) {
          visible += text.slice(cursor);
          cursor = text.length;
          continue;
        }
        visible += text.slice(cursor, start);
        htmlComment = true;
        cursor = start + 4;
      }
      text = visible;
    }
    const marker = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (marker) {
      const char = marker[1][0];
      const length = marker[1].length;
      if (!fence) {
        inlineCodeEnd = undefined;
        htmlComment = false;
        fence = { char, length };
      } else if (
        fence.char === char &&
        length >= fence.length &&
        marker[2].trim() === ""
      ) {
        fence = undefined;
      }
      continue;
    }
    if (!fence && text.trim() !== "") result.push({ index, text });
  }
  return result;
}

function nextUnescapedBacktick(text, from) {
  let cursor = from;
  while (cursor < text.length) {
    const next = text.indexOf("`", cursor);
    if (next === -1) return -1;
    let precedingBackslashes = 0;
    for (let index = next - 1; index >= 0 && text[index] === "\\"; index--) {
      precedingBackslashes++;
    }
    if (precedingBackslashes % 2 === 0) return next;
    cursor = next + 1;
  }
  return -1;
}

function backtickRunLength(text, start) {
  let end = start;
  while (text[end] === "`") end++;
  return end - start;
}

function matchingBacktickRunEnd(text, start, runLength) {
  let cursor = start;
  while (cursor < text.length) {
    const candidate = text.indexOf("`", cursor);
    if (candidate === -1) return -1;
    const candidateLength = backtickRunLength(text, candidate);
    if (candidateLength === runLength) return candidate + candidateLength;
    cursor = candidate + candidateLength;
  }
  return -1;
}

function matchingBacktickRunAcrossLines(lines, startLine, runLength) {
  for (let line = startLine + 1; line < lines.length; line++) {
    const text = lines[line];
    const end = matchingBacktickRunEnd(text, 0, runLength);
    if (end !== -1) return { line, end };
  }
  return undefined;
}

function inlineCodeIdentifier(text, prefix) {
  if (!text.startsWith(prefix)) return undefined;
  const inlineCode = text.slice(prefix.length);
  const opener = /^`+/.exec(inlineCode)?.[0];
  if (!opener) return undefined;
  const end = matchingBacktickRunEnd(inlineCode, opener.length, opener.length);
  if (end !== inlineCode.length) return undefined;
  let id = inlineCode.slice(opener.length, end - opener.length);
  if (id.startsWith(" ") && id.endsWith(" ") && /[^ ]/.test(id)) {
    id = id.slice(1, -1);
  }
  return isRecordId(id) ? id : undefined;
}

function section(lines, heading) {
  const starts = lines.filter(({ text }) => text === `## ${heading}`);
  if (starts.length > 1) fail(`duplicate plan section: ${heading}`);
  if (starts.length === 0) return [];
  const start = starts[0].index;
  const end =
    lines.find(({ index, text }) => index > start && /^## /.test(text))
      ?.index ?? Number.POSITIVE_INFINITY;
  return lines.filter(({ index }) => index > start && index < end);
}

function duplicateIds(ids, kind) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id))
      fail(`ambiguous ${kind} identifier: ${JSON.stringify(id)}`);
    seen.add(id);
  }
  return seen;
}

function parseTask(lines, taskId) {
  const taskSection = section(lines, "Tasks");
  if (taskSection.length === 0) fail("missing or empty Tasks section");
  const headings = taskSection.filter(({ text }) =>
    /^### Task(?:\s|$)/.test(text),
  );
  if (headings.length === 0) fail("Tasks section contains no task records");

  const records = headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? Number.POSITIVE_INFINITY;
    const recordLines = taskSection.filter(
      (line) => line.index > heading.index && line.index < end,
    );
    const idFields = recordLines.filter(({ text }) =>
      text.startsWith("**Task ID:**"),
    );
    if (idFields.length !== 1) {
      fail(
        `task record requires exactly one Task ID field near line ${heading.index + 1}`,
      );
    }
    const idMatch = /^\*\*Task ID:\*\* ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)$/.exec(
      idFields[0].text,
    );
    if (!idMatch) fail(`malformed Task ID near line ${idFields[0].index + 1}`);
    return { id: idMatch[1], lines: recordLines };
  });

  duplicateIds(
    records.map((record) => record.id),
    "Task ID",
  );
  const matches = records.filter((record) => record.id === taskId);
  if (matches.length !== 1)
    fail(`Task ID must resolve exactly once: ${taskId}`);
  return matches[0];
}

function parseReferenceField(task, label) {
  const prefix = `**${label}:**`;
  const fields = task.lines.filter(({ text }) => text.startsWith(prefix));
  if (fields.length !== 1) {
    fail(`${label} field must occur exactly once for task ${task.id}`);
  }
  const fieldIndex = task.lines.findIndex(
    ({ index }) => index === fields[0].index,
  );
  let serialized = "";
  let started = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let lineIndex = fieldIndex; lineIndex < task.lines.length; lineIndex++) {
    const text =
      lineIndex === fieldIndex
        ? task.lines[lineIndex].text.slice(prefix.length)
        : task.lines[lineIndex].text;
    for (
      let characterIndex = 0;
      characterIndex < text.length;
      characterIndex++
    ) {
      const character = text[characterIndex];
      if (!started) {
        if (/\s/.test(character)) continue;
        if (character !== "[") {
          fail(`${label} field contains invalid JSON for task ${task.id}`);
        }
        started = true;
        depth = 1;
        serialized += character;
        continue;
      }

      serialized += character;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "[") depth++;
      else if (character === "]") {
        depth--;
        if (depth === 0) {
          if (text.slice(characterIndex + 1).trim() !== "") {
            fail(`${label} field contains invalid JSON for task ${task.id}`);
          }
          break;
        }
      }
    }
    if (started && depth === 0) break;
    if (started) serialized += "\n";
  }
  if (!started || depth !== 0 || inString) {
    fail(`${label} field contains invalid JSON for task ${task.id}`);
  }
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    fail(`${label} field contains invalid JSON for task ${task.id}`);
  }
  if (!Array.isArray(value))
    fail(`${label} field must be a JSON array for task ${task.id}`);
  const seen = new Set();
  for (const id of value) {
    if (!isRecordId(id)) {
      fail(`${label} field contains an invalid identifier for task ${task.id}`);
    }
    if (seen.has(id))
      fail(
        `${label} field contains a duplicate identifier: ${JSON.stringify(id)}`,
      );
    seen.add(id);
  }
  return value;
}

function recordIdentifiers(lines, tasksStart) {
  const preTasks = lines.filter(({ index }) => index < tasksStart);
  const boundaryIds = preTasks
    .map(({ text }) => inlineCodeIdentifier(text, "### Boundary row "))
    .filter((id) => id !== undefined);

  const supplementLines = section(lines, "Supporting-Owner Supplements");
  const supplementIds = supplementLines
    .filter(({ text }) => text.startsWith("- **Governing Entry ID:**"))
    .map(({ text, index }) => {
      const id = inlineCodeIdentifier(text, "- **Governing Entry ID:** ");
      if (id === undefined) {
        fail(
          `malformed supporting-owner supplement identifier near line ${index + 1}`,
        );
      }
      return id;
    });

  return {
    boundaryIds: duplicateIds(boundaryIds, "boundary row"),
    supplementIds: duplicateIds(supplementIds, "supporting-owner supplement"),
  };
}

function resolveRequested(requested, declared, other, kind, taskId) {
  for (const id of requested) {
    if (declared.has(id)) continue;
    if (other.has(id))
      fail(
        `cross-kind ${kind} identifier for task ${JSON.stringify(taskId)}: ${JSON.stringify(id)}`,
      );
    fail(
      `unknown or stale ${kind} identifier for task ${JSON.stringify(taskId)}: ${JSON.stringify(id)}`,
    );
  }
}

const repositoryRoot = requireRepositoryRoot();
const planPath = requireEnvironment("PLAN_PATH");
const absolutePlanPath = validatePlanPath(repositoryRoot, planPath);
const expectedDigest = requireEnvironment("EXPECTED_PLAN_DIGEST");
if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
  fail("EXPECTED_PLAN_DIGEST must be lowercase 64-hex SHA-256");
}

let planBytes;
try {
  planBytes = readFileSync(absolutePlanPath);
} catch {
  fail(`plan missing or unreadable: ${diagnosticValue(planPath)}`);
}
const actualDigest = createHash("sha256").update(planBytes).digest("hex");
if (actualDigest !== expectedDigest) fail("reviewed plan digest mismatch");
let planText;
try {
  planText = new TextDecoder("utf-8", { fatal: true }).decode(planBytes);
} catch {
  fail("plan is not valid UTF-8");
}
const taskId = requireEnvironment("TASK_ID");
if (!taskIdPattern.test(taskId))
  fail(`invalid Task ID: ${diagnosticValue(taskId)}`);

const lines = visibleLines(planText);
const tasksHeadings = lines.filter(({ text }) => text === "## Tasks");
if (tasksHeadings.length !== 1) fail("plan requires exactly one Tasks section");
const task = parseTask(lines, taskId);
const boundaryRowIds = parseReferenceField(task, "Boundary rows");
const supportingOwnerSupplementIds = parseReferenceField(
  task,
  "Supporting-owner supplements",
);
const definitions = recordIdentifiers(lines, tasksHeadings[0].index);

resolveRequested(
  boundaryRowIds,
  definitions.boundaryIds,
  definitions.supplementIds,
  "boundary row",
  taskId,
);
resolveRequested(
  supportingOwnerSupplementIds,
  definitions.supplementIds,
  definitions.boundaryIds,
  "supporting-owner supplement",
  taskId,
);

process.stdout.write(
  `${JSON.stringify({
    schema: "play-subagent-execution/task-record-resolution/v1",
    task_id: taskId,
    boundary_row_ids: boundaryRowIds,
    supporting_owner_supplement_ids: supportingOwnerSupplementIds,
  })}\n`,
);
