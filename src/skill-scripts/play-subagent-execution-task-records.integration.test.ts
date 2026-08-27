import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helperPath = path.join(
  repositoryRoot,
  "skills/play-subagent-execution/scripts/resolve-task-records.mjs",
);
const ephemeralRoot = path.join(repositoryRoot, ".ephemeral");

const basePlan = `# Resolver fixture

## Supporting-Owner Supplements

- **Governing Entry ID:** \`EP-A\`
  - **Supporting owner:** owner-a
- **Governing Entry ID:** \`EP-B\`
  - **Supporting owner:** owner-b

## Boundary Contract Traceability

### Boundary row \`BR-A\`

- input-a

### Boundary row \`BR-B\`

- input-b

## Tasks

### Task 1: Resolve records

**Task ID:** TASK-A

**Boundary rows:** ["BR-B", "BR-A"]

**Supporting-owner supplements:** ["EP-A"]

**Contract tier:** FULL
`;

const createdPaths: string[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths
      .splice(0)
      .map((target) => rm(target, { force: true, recursive: true })),
  );
  await Promise.all(tempDirs.splice(0).map((target) => cleanupTempDir(target)));
});

function digest(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function markdownCodeSpan(value: string): string {
  const longestRun = Math.max(
    0,
    ...[...value.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding = value.startsWith("`") || value.endsWith("`");
  return `${delimiter}${needsPadding ? ` ${value} ` : value}${delimiter}`;
}

async function writePlan(content: string | Uint8Array): Promise<string> {
  await mkdir(ephemeralRoot, { recursive: true });
  const relativePath = `.ephemeral/task-records-${randomUUID()}-plan.md`;
  const absolutePath = path.join(repositoryRoot, relativePath);
  await writeFile(absolutePath, content);
  createdPaths.push(absolutePath);
  return relativePath;
}

async function runHelper(
  content: string,
  overrides: Record<string, string> = {},
  cwd = repositoryRoot,
): Promise<{ stdout: string; stderr: string }> {
  const planPath = await writePlan(content);
  return runPlanPath(planPath, content, overrides, cwd);
}

async function runPlanPath(
  planPath: string,
  content: string | Uint8Array,
  overrides: Record<string, string> = {},
  cwd = repositoryRoot,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [helperPath],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          PLAN_PATH: planPath,
          TASK_ID: "TASK-A",
          EXPECTED_PLAN_DIGEST: digest(content),
          ...overrides,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}

async function expectFailure(
  content: string,
  overrides: Record<string, string> = {},
  cwd = repositoryRoot,
): Promise<{ stdout: string; stderr: string }> {
  try {
    await runHelper(content, overrides, cwd);
  } catch (error) {
    return error as { stdout: string; stderr: string };
  }
  throw new Error("expected helper failure");
}

describe("play-subagent-execution task record resolver", () => {
  it("emits only validated IDs in authored request order for zero, one, or many references", async () => {
    const many = await runHelper(basePlan);
    expect(JSON.parse(many.stdout)).toEqual({
      schema: "play-subagent-execution/task-record-resolution/v1",
      task_id: "TASK-A",
      boundary_row_ids: ["BR-B", "BR-A"],
      supporting_owner_supplement_ids: ["EP-A"],
    });
    expect(many.stdout.endsWith("\n")).toBe(true);
    expect(many.stdout).not.toContain("input-a");
    expect(many.stderr).toBe("");

    const zeroPlan = basePlan
      .replace('["BR-B", "BR-A"]', "[]")
      .replace('["EP-A"]', "[]");
    const zero = await runHelper(zeroPlan);
    expect(JSON.parse(zero.stdout)).toMatchObject({
      boundary_row_ids: [],
      supporting_owner_supplement_ids: [],
    });

    const onePlan = basePlan.replace('["BR-B", "BR-A"]', '["BR-A"]');
    const one = await runHelper(onePlan);
    expect(JSON.parse(one.stdout).boundary_row_ids).toEqual(["BR-A"]);

    const representationPlan = basePlan
      .replaceAll("BR-A", "boundary row alpha")
      .replaceAll("EP-A", "supporting owner alpha");
    const representation = await runHelper(representationPlan);
    expect(JSON.parse(representation.stdout)).toMatchObject({
      boundary_row_ids: ["BR-B", "boundary row alpha"],
      supporting_owner_supplement_ids: ["supporting owner alpha"],
    });

    const internalBackticks = basePlan
      .replace("### Boundary row `BR-A`", "### Boundary row ``BR`A``")
      .replace('"BR-B", "BR-A"', '"BR-B", "BR`A"')
      .replace(
        "- **Governing Entry ID:** `EP-A`",
        "- **Governing Entry ID:** ``EP`A``",
      )
      .replace('["EP-A"]', '["EP`A"]');
    const internalResult = await runHelper(internalBackticks);
    expect(JSON.parse(internalResult.stdout)).toMatchObject({
      boundary_row_ids: ["BR-B", "BR`A"],
      supporting_owner_supplement_ids: ["EP`A"],
    });

    for (const edgeBacktickId of ["`BR", "BR`", "```"] as const) {
      const edgeBackticks = basePlan
        .replace(
          "### Boundary row `BR-A`",
          `### Boundary row ${markdownCodeSpan(edgeBacktickId)}`,
        )
        .replace('"BR-B", "BR-A"', `"BR-B", "${edgeBacktickId}"`);
      const edgeResult = await runHelper(edgeBackticks);
      expect(JSON.parse(edgeResult.stdout).boundary_row_ids).toEqual([
        "BR-B",
        edgeBacktickId,
      ]);
    }

    for (const malformed of [
      internalBackticks.replace('"BR-B", "BR`A"', '"BR-B", "`BR`A`"'),
      internalBackticks.replace(
        "### Boundary row ``BR`A``",
        "### Boundary row ``BR`A```",
      ),
    ]) {
      const failure = await expectFailure(malformed);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).toContain("unknown or stale boundary row");
    }

    const multilinePlan = basePlan.replace(
      '**Boundary rows:** ["BR-B", "BR-A"]',
      '**Boundary rows:** [\n  "BR-B",\n  "BR-A"\n]',
    );
    const multiline = await runHelper(multilinePlan);
    expect(JSON.parse(multiline.stdout).boundary_row_ids).toEqual([
      "BR-B",
      "BR-A",
    ]);

    const nonAnchorMentions = basePlan
      .replace(
        "## Boundary Contract Traceability",
        "| **Governing Entry ID:** | prose mention |\n\n## Boundary Contract Traceability",
      )
      .replace(
        "## Tasks",
        "### Boundary row without a canonical ID anchor\n\n## Tasks",
      );
    await expect(runHelper(nonAnchorMentions)).resolves.toMatchObject({
      stderr: "",
    });
  });

  it("rejects malformed, repeated, and invalid canonical task fields", async () => {
    const invalidPlans = [
      basePlan.replace('**Boundary rows:** ["BR-B", "BR-A"]\n\n', ""),
      basePlan.replace(
        '**Boundary rows:** ["BR-B", "BR-A"]',
        '**Boundary rows:** ["BR-A"]\n\n**Boundary rows:** ["BR-B"]',
      ),
      basePlan.replace('["BR-B", "BR-A"]', "not-json"),
      basePlan.replace('["BR-B", "BR-A"]', '"BR-A"'),
      basePlan.replace('["BR-B", "BR-A"]', '["BR-A", 1]'),
      basePlan.replace('["BR-B", "BR-A"]', '["BR-A", ""]'),
      basePlan.replace('["BR-B", "BR-A"]', '["BR-A\\n"]'),
      basePlan.replace('["BR-B", "BR-A"]', '["BR-A", "BR-A"]'),
      basePlan.replace(
        '**Boundary rows:** ["BR-B", "BR-A"]',
        '<!--\n**Boundary rows:** ["BR-B", "BR-A"]\n-->',
      ),
    ];

    for (const plan of invalidPlans) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).not.toBe("");
    }
  });

  it("keeps HTML-comment delimiters inside inline code visible", async () => {
    const encodeLessThan = (ids: string[]) =>
      JSON.stringify(ids).replaceAll("<", "\\u003c");
    const unpairedLiteral = basePlan
      .replace("### Boundary row `BR-A`", "### Boundary row `BR<!--A`")
      .replace('["BR-B", "BR-A"]', encodeLessThan(["BR-B", "BR<!--A"]))
      .replace("## Tasks", "The literal `<!--` remains visible.\n\n## Tasks");
    const unpairedResult = await runHelper(unpairedLiteral);
    expect(JSON.parse(unpairedResult.stdout).boundary_row_ids).toEqual([
      "BR-B",
      "BR<!--A",
    ]);

    const pairedIdentifier = basePlan
      .replace("### Boundary row `BR-A`", "### Boundary row `BR<!--A-->`")
      .replace('["BR-B", "BR-A"]', encodeLessThan(["BR-B", "BR<!--A-->"]))
      .replace(
        "## Tasks",
        "The paired literals `<!--` and `-->` remain visible.\n\n## Tasks",
      );
    const result = await runHelper(pairedIdentifier);
    expect(JSON.parse(result.stdout).boundary_row_ids).toEqual([
      "BR-B",
      "BR<!--A-->",
    ]);

    const multilineLiteral = basePlan.replace(
      "## Tasks",
      "A multiline `literal <!--\ncontinues here`\n\n## Tasks",
    );
    await expect(runHelper(multilineLiteral)).resolves.toMatchObject({
      stderr: "",
    });

    for (const [anchor, id] of [
      ["### Boundary row `BR\\`<!--A-->`", "BR\\`<!--A-->"],
      ["### Boundary row ``BR\\``<!--A-->``", "BR\\``<!--A-->"],
    ]) {
      const escapedLookingCloser = basePlan
        .replace("### Boundary row `BR-A`", anchor)
        .replace('["BR-B", "BR-A"]', encodeLessThan(["BR-B", id]));
      const failure = await expectFailure(escapedLookingCloser);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).toContain("unknown or stale boundary row");
    }
  });

  it("keeps backslash-escaped HTML-comment openers visible", async () => {
    const escapedOpener = basePlan.replace(
      '**Boundary rows:** ["BR-B", "BR-A"]',
      '\\<!-- visible note\n**Boundary rows:** ["BR-B", "BR-A"]\n--> visible note',
    );

    const result = await runHelper(escapedOpener);
    expect(JSON.parse(result.stdout).boundary_row_ids).toEqual([
      "BR-B",
      "BR-A",
    ]);
    expect(result.stderr).toBe("");

    const evenBackslashes = basePlan.replace(
      '**Boundary rows:** ["BR-B", "BR-A"]',
      '\\\\<!-- actual comment\n**Boundary rows:** ["BR-B", "BR-A"]\n-->',
    );
    const failure = await expectFailure(evenBackslashes);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain(
      "Boundary rows field must occur exactly once",
    );
  });

  it("does not synthesize structural headings by removing HTML comments", async () => {
    for (const plan of [
      basePlan.replace("## Tasks", "<!--prefix-->## Tasks"),
      basePlan.replace(
        "### Task 1: Resolve records",
        "<!--prefix-->### Task 1: Resolve records",
      ),
      basePlan.replace(
        "### Boundary row `BR-A`",
        "<!--prefix-->### Boundary row `BR-A`",
      ),
      basePlan.replace("## Tasks", "<!--\n## ignored -->## Tasks"),
      basePlan.replace(
        "### Task 1: Resolve records",
        "<!--\n### ignored -->### Task 1: Resolve records",
      ),
      basePlan.replace(
        "### Boundary row `BR-A`",
        "<!--\n### ignored -->### Boundary row `BR-A`",
      ),
      basePlan.replace("## Tasks", "##<!-- --> Tasks"),
      basePlan.replace(
        "### Task 1: Resolve records",
        "###<!-- --> Task 1: Resolve records",
      ),
      basePlan.replace(
        "### Boundary row `BR-A`",
        "##<!-- --># Boundary row `BR-A`",
      ),
    ]) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).not.toBe("");
    }

    const inlineComments = basePlan
      .replace("## Tasks", "## Tasks<!-- section note -->")
      .replace(
        "### Task 1: Resolve records",
        "### Task 1: Resolve records<!-- task note -->",
      )
      .replace(
        "### Boundary row `BR-A`",
        "### Boundary row `BR-A`<!-- boundary note -->",
      );
    await expect(runHelper(inlineComments)).resolves.toMatchObject({
      stderr: "",
    });

    const syntheticDecoy = basePlan.replace(
      "## Tasks",
      "##<!-- --> Tasks\n\n## Tasks",
    );
    await expect(runHelper(syntheticDecoy)).resolves.toMatchObject({
      stderr: "",
    });

    const internalLabelComments = basePlan
      .replace(
        '**Boundary rows:** ["BR-B", "BR-A"]',
        '**Boundary<!-- --> rows:** ["BR-B", "BR-A"]',
      )
      .replace(
        "- **Governing Entry ID:** `EP-A`",
        "- **Governing<!-- --> Entry ID:** `EP-A`",
      );
    await expect(runHelper(internalLabelComments)).resolves.toMatchObject({
      stderr: "",
    });
  });

  it("does not synthesize fields or supplement anchors from HTML comments", async () => {
    for (const plan of [
      basePlan.replace(
        "**Task ID:** TASK-A",
        "<!--prefix-->**Task ID:** TASK-A",
      ),
      basePlan.replace(
        '**Boundary rows:** ["BR-B", "BR-A"]',
        '<!--prefix-->**Boundary rows:** ["BR-B", "BR-A"]',
      ),
      basePlan.replace(
        '**Supporting-owner supplements:** ["EP-A"]',
        '<!--prefix-->**Supporting-owner supplements:** ["EP-A"]',
      ),
      basePlan.replace(
        "- **Governing Entry ID:** `EP-A`",
        "<!--prefix-->- **Governing Entry ID:** `EP-A`",
      ),
      basePlan.replace(
        "- **Governing Entry ID:** `EP-A`",
        "-<!-- --> **Governing Entry ID:** `EP-A`",
      ),
    ]) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).not.toBe("");
    }
  });

  it("keeps multiline code spans inside their paragraph block", async () => {
    const precedingDanglingBacktick = basePlan.replace(
      "- **Governing Entry ID:** `EP-A`",
      "Unmatched literal `\n- **Governing Entry ID:** `EP-A`",
    );

    const result = await runHelper(precedingDanglingBacktick);
    expect(JSON.parse(result.stdout).supporting_owner_supplement_ids).toEqual([
      "EP-A",
    ]);
    expect(result.stderr).toBe("");
  });

  it("keeps canonical records visible after comment-like fence info strings", async () => {
    const commentLikeFenceInfo = basePlan.replace(
      "## Tasks",
      "~~~text <!-- literal ` info\nexcluded content\n~~~\n\n## Tasks",
    );

    const result = await runHelper(commentLikeFenceInfo);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: "play-subagent-execution/task-record-resolution/v1",
      task_id: "TASK-A",
      boundary_row_ids: ["BR-B", "BR-A"],
      supporting_owner_supplement_ids: ["EP-A"],
    });
    expect(result.stderr).toBe("");
  });

  it("rejects comment-like invalid backtick fence info strings", async () => {
    const invalidBacktickFenceInfo = basePlan.replace(
      "## Tasks",
      "```text <!-- literal ` info\nexcluded content\n```\n\n## Tasks",
    );

    const failure = await expectFailure(invalidBacktickFenceInfo);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("plan requires exactly one Tasks section");
  });

  it("rejects comment-stripped markers without raw fence openers", async () => {
    const syntheticTildeMarker = basePlan.replace(
      "## Tasks",
      "<!--prefix-->~~~text <!--\nexcluded content\n~~~\n\n## Tasks",
    );

    const failure = await expectFailure(syntheticTildeMarker);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("plan requires exactly one Tasks section");
  });

  it("rejects raw fence markers covered by pre-existing comments", async () => {
    const commentCoveredMarker = basePlan.replace(
      "## Tasks",
      "<!--\n~~~hidden -->~~~text <!--\nexcluded content\n~~~\n\n## Tasks",
    );

    const failure = await expectFailure(commentCoveredMarker);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("plan requires exactly one Tasks section");
  });

  it("keeps valid raw tilde openers authoritative over stripped info", async () => {
    const alteredVisibleRun = basePlan.replace(
      "## Tasks",
      "~~~<!-- -->~text <!--\nexcluded content\n~~~\n\n## Tasks",
    );

    const result = await runHelper(alteredVisibleRun);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: "play-subagent-execution/task-record-resolution/v1",
      task_id: "TASK-A",
      boundary_row_ids: ["BR-B", "BR-A"],
      supporting_owner_supplement_ids: ["EP-A"],
    });
    expect(result.stderr).toBe("");
  });

  it("keeps canonical-looking tasks inside valid backtick fences excluded", async () => {
    const validBacktickFence = basePlan.replace(
      "## Tasks",
      "```text\n## Tasks\n### Task 999: excluded\n**Task ID:** TASK-A\n```\n\n## Tasks",
    );

    const result = await runHelper(validBacktickFence);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: "play-subagent-execution/task-record-resolution/v1",
      task_id: "TASK-A",
      boundary_row_ids: ["BR-B", "BR-A"],
      supporting_owner_supplement_ids: ["EP-A"],
    });
    expect(result.stderr).toBe("");
  });

  it("keeps record constructs visible after matching backticks inside fences", async () => {
    const fencedBackticks = basePlan.replace(
      "### Boundary row `BR-A`",
      "```text\nmatching ``` run\n```\n### Boundary row `BR-A`",
    );

    const result = await runHelper(fencedBackticks);
    expect(JSON.parse(result.stdout).boundary_row_ids).toEqual([
      "BR-B",
      "BR-A",
    ]);
  });

  it("fails closed for unknown, stale, ambiguous, duplicate-definition, and cross-kind IDs", async () => {
    const invalidPlans = [
      basePlan.replace('"BR-B", "BR-A"', '"BR-STALE"'),
      basePlan.replace("### Boundary row `BR-B`", "### Boundary row `BR-A`"),
      basePlan.replace('["BR-B", "BR-A"]', '["EP-A"]'),
      basePlan.replace('["EP-A"]', '["BR-A"]'),
      basePlan.replace(
        "- **Governing Entry ID:** `EP-B`",
        "- **Governing Entry ID:** `EP-A`",
      ),
      basePlan.replace("### Boundary row `BR-B`", "### Boundary row BR-B"),
      basePlan.replace(
        "### Boundary row `BR-A`",
        "<!--\n### Boundary row `BR-A`\n-->",
      ),
      basePlan.replace(
        "- **Governing Entry ID:** `EP-A`",
        "**Governing Entry ID:** `EP-A`",
      ),
    ];

    for (const plan of invalidPlans) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).not.toBe("");
    }

    const unknownRecord = await expectFailure(
      basePlan.replace('"BR-B", "BR-A"', '"BR-STALE"'),
    );
    expect(unknownRecord.stderr).toContain('task "TASK-A"');
    const crossKind = await expectFailure(
      basePlan.replace('["BR-B", "BR-A"]', '["EP-A"]'),
    );
    expect(crossKind.stderr).toContain('task "TASK-A"');

    const controlIdPlan = basePlan.replace(
      '["BR-B", "BR-A"]',
      '["\\u001b[31mUNKNOWN"]',
    );
    const controlFailure = await expectFailure(controlIdPlan);
    expect(controlFailure.stderr).not.toContain("\u001b");
    expect(controlFailure.stderr).toContain("\\u001b");
  });

  it("rejects missing, duplicate, and unknown Task IDs", async () => {
    const missing = basePlan.replace("**Task ID:** TASK-A\n\n", "");
    const duplicate = basePlan.replace(
      "**Task ID:** TASK-A",
      "**Task ID:** TASK-A\n\n**Task ID:** TASK-A",
    );

    for (const plan of [missing, duplicate]) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
    }

    const unknown = await expectFailure(basePlan, { TASK_ID: "TASK-UNKNOWN" });
    expect(unknown.stdout).toBe("");
  });

  it("requires Task ID to be the first visible task field", async () => {
    const proseBeforeId = basePlan.replace(
      "**Task ID:** TASK-A",
      "Prose before the identity field.\n\n**Task ID:** TASK-A",
    );
    const fieldBeforeId = basePlan
      .replace('**Boundary rows:** ["BR-B", "BR-A"]\n\n', "")
      .replace(
        "**Task ID:** TASK-A",
        '**Boundary rows:** ["BR-B", "BR-A"]\n\n**Task ID:** TASK-A',
      );

    for (const plan of [proseBeforeId, fieldBeforeId]) {
      const failure = await expectFailure(plan);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).toContain(
        "Task ID must be the first visible field",
      );
    }

    const commentBeforeId = basePlan.replace(
      "**Task ID:** TASK-A",
      "<!-- task note -->\n\n**Task ID:** TASK-A",
    );
    await expect(runHelper(commentBeforeId)).resolves.toMatchObject({
      stderr: "",
    });

    const fenceBeforeId = basePlan.replace(
      "**Task ID:** TASK-A",
      "```text\nrendered content\n```\n\n**Task ID:** TASK-A",
    );
    const fencedFailure = await expectFailure(fenceBeforeId);
    expect(fencedFailure.stdout).toBe("");
    expect(fencedFailure.stderr).toContain(
      "Task ID must be the first visible field",
    );
  });

  it("validates root, path, and digest before resolution without writing files or partial stdout", async () => {
    const planPath = await writePlan(basePlan);
    const before = await readdir(ephemeralRoot);
    await runPlanPath(planPath, basePlan);
    expect(await readdir(ephemeralRoot)).toEqual(before);

    let stdinFailure: { stdout?: string; stderr?: string } | undefined;
    try {
      execFileSync(process.execPath, [helperPath], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          PLAN_PATH: planPath,
          TASK_ID: "TASK-A",
          EXPECTED_PLAN_DIGEST: digest(basePlan),
        },
        input: "unexpected input",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      stdinFailure = error as { stdout?: string; stderr?: string };
    }
    expect(stdinFailure?.stdout).toBe("");
    expect(stdinFailure?.stderr).toContain("stdin is not accepted");

    const firstByteStdin = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      refusalObservedWhileInputOpen: boolean;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--eval",
          'process.send("ready"); process.once("message", () => import(process.argv[1]));',
          helperPath,
        ],
        {
          cwd: repositoryRoot,
          env: {
            PATH: process.env.PATH,
            PLAN_PATH: "plan.md",
            TASK_ID: "TASK-A",
            EXPECTED_PLAN_DIGEST: "invalid",
          },
          stdio: ["pipe", "pipe", "pipe", "ipc"] as const,
        },
      );
      const { stdin, stdout: childStdout, stderr: childStderr } = child;
      if (!stdin || !childStdout || !childStderr) {
        throw new Error("expected piped child stdio");
      }
      let stdout = "";
      let stderr = "";
      let inputClosed = false;
      let refusalObservedWhileInputOpen = false;
      childStdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      childStderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
        if (!inputClosed && stderr.includes("stdin is not accepted")) {
          refusalObservedWhileInputOpen = !inputClosed;
          inputClosed = true;
          stdin.end();
        }
      });
      stdin.on("error", () => {});
      const watchdog = setTimeout(() => {
        if (!inputClosed) {
          inputClosed = true;
          stdin.end();
        }
      }, 5000);
      child.once("message", () => {
        stdin.write("x", () => {
          child.send?.("resolve");
        });
      });
      child.on("close", (code) => {
        clearTimeout(watchdog);
        resolve({
          code,
          stdout,
          stderr,
          refusalObservedWhileInputOpen,
        });
      });
    });
    expect(firstByteStdin.refusalObservedWhileInputOpen).toBe(true);
    expect(firstByteStdin.code).not.toBe(0);
    expect(firstByteStdin.stdout).toBe("");
    expect(firstByteStdin.stderr).toContain("stdin is not accepted");

    const indeterminateStdin = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn(process.execPath, [helperPath], {
        cwd: repositoryRoot,
        env: {
          PATH: process.env.PATH,
          PLAN_PATH: planPath,
          TASK_ID: "TASK-A",
          EXPECTED_PLAN_DIGEST: digest(basePlan),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {});
      const watchdog = setTimeout(() => child.stdin.end(), 5000);
      child.on("close", (code) => {
        clearTimeout(watchdog);
        resolve({ code, stdout, stderr });
      });
    });
    expect(indeterminateStdin.code).not.toBe(0);
    expect(indeterminateStdin.stdout).toBe("");
    expect(indeterminateStdin.stderr).toContain(
      "stdin emptiness could not be established",
    );

    const genericReadFailure = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { closeSync, openSync } from "node:fs"; closeSync(0); openSync(process.cwd(), "r"); await import(process.argv[1]);',
          helperPath,
        ],
        {
          cwd: repositoryRoot,
          env: {
            PATH: process.env.PATH,
            PLAN_PATH: planPath,
            TASK_ID: "TASK-A",
            EXPECTED_PLAN_DIGEST: digest(basePlan),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {});
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(genericReadFailure.code).not.toBe(0);
    expect(genericReadFailure.stdout).toBe("");
    expect(genericReadFailure.stderr).toContain("failed to validate stdin");

    const badDigest = await expectFailure(basePlan, {
      EXPECTED_PLAN_DIGEST: "0".repeat(64),
    });
    expect(badDigest.stdout).toBe("");
    expect(badDigest.stderr).toContain("digest mismatch");

    const malformedDigest = await expectFailure(basePlan, {
      EXPECTED_PLAN_DIGEST: "invalid",
    });
    expect(malformedDigest.stdout).toBe("");

    const unsafePath = await expectFailure(basePlan, { PLAN_PATH: "plan.md" });
    expect(unsafePath.stdout).toBe("");
    expect(unsafePath.stderr).toContain("plan path validation failed");

    const isolatedRoot = await createTempDir();
    tempDirs.push(isolatedRoot);
    await execFileAsync("git", ["init", "--quiet"], { cwd: isolatedRoot });
    const isolatedEphemeral = path.join(isolatedRoot, ".ephemeral");
    await mkdir(isolatedEphemeral);
    const emptySlugPath = ".ephemeral/-plan.md";
    await writeFile(path.join(isolatedRoot, emptySlugPath), basePlan);
    await expect(
      runPlanPath(emptySlugPath, basePlan, {}, isolatedRoot),
    ).resolves.toMatchObject({ stderr: "" });

    const windowsSeparator = await expectFailure(basePlan, {
      PLAN_PATH: ".ephemeral\\nested\\outside-plan.md",
    });
    expect(windowsSeparator.stderr).toContain("plan path validation failed");

    const controlPath = await expectFailure(basePlan, {
      PLAN_PATH: ".ephemeral/task-records-\u001b-plan.md",
    });
    expect(controlPath.stderr).not.toContain("\u001b");
    expect(controlPath.stderr).toContain("\\u001b");

    const orderedFailure = await expectFailure(basePlan, {
      PLAN_PATH: "plan.md",
      TASK_ID: "",
      EXPECTED_PLAN_DIGEST: "invalid",
    });
    expect(orderedFailure.stderr).toContain("plan path validation failed");

    const invalidUtf8 = Buffer.concat([
      Buffer.from(basePlan, "utf8"),
      Buffer.from([0xc3, 0x28]),
    ]);
    const invalidUtf8Path = await writePlan(invalidUtf8);
    await expect(
      runPlanPath(invalidUtf8Path, invalidUtf8),
    ).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("not valid UTF-8"),
    });

    const symlinkTarget = await writePlan(basePlan);
    const symlinkPath = `.ephemeral/task-records-${randomUUID()}-plan.md`;
    const symlinkAbsolute = path.join(repositoryRoot, symlinkPath);
    await symlink(path.join(repositoryRoot, symlinkTarget), symlinkAbsolute);
    createdPaths.push(symlinkAbsolute);
    await expect(runPlanPath(symlinkPath, basePlan)).rejects.toMatchObject({
      stdout: "",
    });

    const directoryPath = `.ephemeral/task-records-${randomUUID()}-plan.md`;
    const directoryAbsolute = path.join(repositoryRoot, directoryPath);
    await mkdir(directoryAbsolute);
    createdPaths.push(directoryAbsolute);
    await expect(runPlanPath(directoryPath, basePlan)).rejects.toMatchObject({
      stdout: "",
    });

    const unreadablePath = await writePlan(basePlan);
    const unreadableAbsolute = path.join(repositoryRoot, unreadablePath);
    await chmod(unreadableAbsolute, 0o000);
    try {
      let readable = true;
      try {
        await access(unreadableAbsolute, constants.R_OK);
      } catch {
        readable = false;
      }
      if (readable) {
        await expect(
          runPlanPath(unreadablePath, basePlan),
        ).resolves.toMatchObject({ stderr: "" });
      } else {
        await expect(
          runPlanPath(unreadablePath, basePlan),
        ).rejects.toMatchObject({ stdout: "" });
      }
    } finally {
      await chmod(unreadableAbsolute, 0o600);
    }

    const unrelatedCwd = await createTempDir();
    tempDirs.push(unrelatedCwd);
    const wrongRoot = await expectFailure(basePlan, {}, unrelatedCwd);
    expect(wrongRoot.stdout).toBe("");
    expect(wrongRoot.stderr).toContain("repository root");

    const controlTask = await expectFailure(basePlan, {
      TASK_ID: "TASK-\u001b",
    });
    expect(controlTask.stderr).not.toContain("\u001b");
    expect(controlTask.stderr).toContain("\\u001b");
  });

  it("prints the adjacent usage contract through --help", async () => {
    const usagePath = path.join(
      repositoryRoot,
      "skills/play-subagent-execution/references/resolve-task-records-usage.md",
    );
    const result = await execFileAsync(
      process.execPath,
      [helperPath, "--help"],
      {
        cwd: repositoryRoot,
        env: { PATH: process.env.PATH },
      },
    );
    expect(result.stdout).toBe(await readFile(usagePath, "utf8"));
    expect(result.stderr).toBe("");

    await expect(
      execFileAsync(process.execPath, [helperPath, "--help", "extra"], {
        cwd: repositoryRoot,
        env: { PATH: process.env.PATH },
      }),
    ).rejects.toMatchObject({ stdout: "" });
  });
});
