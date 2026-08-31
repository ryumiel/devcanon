import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { RuntimeCommandOutcome } from "./command.js";
import { RuntimePathError, assertNoSymlinkOrReparsePoint } from "./paths.js";

const SCHEMA = "planning-projection/v1";
const MODES = new Set([
  "authority",
  "reference",
  "derived representation",
  "non-normative summary",
  "verification",
]);
const IDENTIFIER = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/u;

type FailureCode =
  | "plan-path-invalid"
  | "plan-unreadable"
  | "execution-projection-missing"
  | "execution-projection-duplicate"
  | "tasks-section-missing"
  | "task-heading-before-tasks"
  | "projection-entry-missing"
  | "projection-entry-field-invalid"
  | "entry-id-duplicate"
  | "task-id-invalid"
  | "task-id-duplicate"
  | "task-reference-unknown";

interface SourcePosition {
  readonly start: { readonly offset?: number };
  readonly end: { readonly offset?: number };
}

interface MarkdownNode {
  readonly type: string;
  readonly depth?: number;
  readonly value?: string;
  readonly position?: SourcePosition;
  readonly children?: readonly MarkdownNode[];
}

interface Finding {
  readonly code: FailureCode;
  readonly offset: number;
}

interface ProjectionProof {
  readonly owner_type: "task" | "reviewer" | "controller";
  readonly owner: string;
  readonly boundary: string;
}

interface ProjectionEntry {
  readonly entry_id: string;
  readonly affected_surfaces: readonly string[];
  readonly owner_source: string;
  readonly mode: string;
  readonly implementation_task_ids: readonly string[];
  readonly no_code_reason: string | null;
  readonly proof: ProjectionProof;
  readonly start: number;
  readonly end: number;
}

interface TaskReference {
  readonly task_id: string;
  readonly offset: number;
}

interface ProjectionTask {
  readonly task_id: string;
  readonly heading: string;
  readonly start: number;
  readonly end: number;
}

export interface PlanningProjectionResult {
  readonly schema: typeof SCHEMA;
  readonly plan_path: string;
  readonly projection: {
    readonly start: number;
    readonly end: number;
    readonly entries: readonly ProjectionEntry[];
  };
  readonly tasks: readonly ProjectionTask[];
}

class ProjectionFailure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly offset: number,
  ) {
    super(code);
    this.name = "ProjectionFailure";
  }
}

export async function runPlanningProjectionCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  if (
    args.length !== 3 ||
    args[0] !== "inspect" ||
    args[1] !== "--path" ||
    args[2] === undefined
  ) {
    return projectionFail("plan-path-invalid");
  }

  const planPath = args[2];
  let input: string;
  try {
    input = await readPlan(planPath);
  } catch (error) {
    if (error instanceof ProjectionFailure) {
      return projectionFail(error.code);
    }
    return projectionFail("plan-unreadable");
  }

  try {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(inspectPlanningProjection(input, planPath))}\n`,
      stderr: "",
    };
  } catch (error) {
    if (error instanceof ProjectionFailure) {
      return projectionFail(error.code);
    }
    return projectionFail("projection-entry-field-invalid");
  }
}

async function readPlan(planPath: string): Promise<string> {
  const root = process.cwd();
  const candidate = resolveRepositoryPlanPath(planPath, root, process.platform);

  try {
    await assertNoSymlinkOrReparsePoint(root, candidate);
    const stat = await lstat(candidate);
    if (!stat.isFile()) {
      throw new ProjectionFailure("plan-unreadable", 0);
    }
    return await readFile(candidate, "utf8");
  } catch (error) {
    if (error instanceof ProjectionFailure) throw error;
    if (error instanceof RuntimePathError) {
      throw new ProjectionFailure("plan-path-invalid", 0);
    }
    throw new ProjectionFailure("plan-unreadable", 0);
  }
}

export function resolveRepositoryPlanPath(
  planPath: string,
  root: string,
  platform: NodeJS.Platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const segments = planPath
    .split(platform === "win32" ? /[\\/]/u : /\//u)
    .filter(Boolean);
  if (
    planPath.length === 0 ||
    pathApi.isAbsolute(planPath) ||
    segments.includes("..")
  ) {
    throw new ProjectionFailure("plan-path-invalid", 0);
  }

  const candidate = pathApi.resolve(root, planPath);
  const relative = pathApi.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    throw new ProjectionFailure("plan-path-invalid", 0);
  }
  return candidate;
}

export function inspectPlanningProjection(
  input: string,
  planPath: string,
): PlanningProjectionResult {
  const root = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as MarkdownNode;
  const children = root.children ?? [];
  const headings = children.filter(isHeading);
  const projectionHeadings = headings.filter((node) =>
    isLiteralH2(input, node, "Execution Projection"),
  );
  const tasksHeadings = headings.filter((node) =>
    isLiteralH2(input, node, "Tasks"),
  );
  const findings: Finding[] = [];

  if (projectionHeadings.length === 0) {
    findings.push({ code: "execution-projection-missing", offset: 0 });
  }
  if (projectionHeadings.length > 1) {
    for (const heading of projectionHeadings.slice(1)) {
      findings.push({
        code: "execution-projection-duplicate",
        offset: nodeStart(heading),
      });
    }
  }
  if (tasksHeadings.length === 0) {
    findings.push({ code: "tasks-section-missing", offset: 0 });
  }

  const firstTasksHeading = tasksHeadings[0];
  for (const taskHeading of headings.filter((node) =>
    isCanonicalTaskHeading(input, node),
  )) {
    if (
      firstTasksHeading === undefined ||
      nodeStart(taskHeading) < nodeStart(firstTasksHeading)
    ) {
      findings.push({
        code: "task-heading-before-tasks",
        offset: nodeStart(taskHeading),
      });
    }
  }

  const projectionHeading = projectionHeadings[0];
  if (projectionHeading !== undefined && firstTasksHeading !== undefined) {
    if (nodeStart(firstTasksHeading) <= nodeStart(projectionHeading)) {
      findings.push({ code: "tasks-section-missing", offset: 0 });
    }
  }

  if (projectionHeading === undefined || firstTasksHeading === undefined) {
    throwFirst(findings);
    throw new ProjectionFailure("execution-projection-missing", 0);
  }

  const projectionStart = nodeStart(projectionHeading);
  const projectionEnd = nodeStart(firstTasksHeading);
  const { entries, taskReferences } = inspectEntries(
    children,
    projectionStart,
    projectionEnd,
    findings,
    input,
  );
  const tasks = inspectTasks(
    children,
    firstTasksHeading,
    input.length,
    findings,
    input,
  );

  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.task_id)) {
      findings.push({ code: "task-id-duplicate", offset: task.start });
    }
    taskIds.add(task.task_id);
  }
  for (const reference of taskReferences) {
    if (!taskIds.has(reference.task_id)) {
      findings.push({
        code: "task-reference-unknown",
        offset: reference.offset,
      });
    }
  }

  throwFirst(findings);
  return {
    schema: SCHEMA,
    plan_path: planPath,
    projection: {
      start: projectionStart,
      end: projectionEnd,
      entries,
    },
    tasks,
  };
}

function inspectEntries(
  children: readonly MarkdownNode[],
  projectionStart: number,
  projectionEnd: number,
  findings: Finding[],
  input: string,
): { entries: ProjectionEntry[]; taskReferences: TaskReference[] } {
  for (const child of children) {
    if (
      nodeStart(child) > projectionStart &&
      nodeEnd(child) <= projectionEnd &&
      child.type !== "list"
    ) {
      findings.push({
        code: "projection-entry-field-invalid",
        offset: nodeStart(child),
      });
    }
  }
  const entryNodes = children
    .filter((node) => node.type === "list")
    .filter(
      (node) =>
        nodeStart(node) >= projectionStart && nodeEnd(node) <= projectionEnd,
    )
    .flatMap((node) => node.children ?? []);
  if (entryNodes.length === 0) {
    findings.push({
      code: "projection-entry-missing",
      offset: projectionStart,
    });
    return { entries: [], taskReferences: [] };
  }

  const entries: ProjectionEntry[] = [];
  const entryIds: Array<{ entry_id: string; offset: number }> = [];
  const taskReferences: TaskReference[] = [];
  for (const entryNode of entryNodes) {
    const entry = parseEntry(
      entryNode,
      findings,
      input,
      taskReferences,
      entryIds,
    );
    if (entry === undefined) continue;
    entries.push(entry);
  }
  const ids = new Set<string>();
  for (const entryId of entryIds) {
    if (ids.has(entryId.entry_id)) {
      findings.push({ code: "entry-id-duplicate", offset: entryId.offset });
    }
    ids.add(entryId.entry_id);
  }
  return { entries, taskReferences };
}

function parseEntry(
  entryNode: MarkdownNode,
  findings: Finding[],
  input: string,
  taskReferences: TaskReference[],
  entryIds: Array<{ entry_id: string; offset: number }>,
): ProjectionEntry | undefined {
  if (entryNode.type !== "listItem") {
    findings.push({
      code: "projection-entry-field-invalid",
      offset: nodeStart(entryNode),
    });
    return undefined;
  }

  const fields = new Map<
    string,
    { value: string; offset: number; source: string }
  >();
  const entryChildren = entryNode.children ?? [];
  const firstField = entryChildren[0];
  if (firstField !== undefined) addField(firstField, fields, findings, input);
  for (const child of entryChildren.slice(1)) {
    if (child.type !== "list") {
      findings.push({
        code: "projection-entry-field-invalid",
        offset: nodeStart(child),
      });
      continue;
    }
    for (const field of child.children ?? []) {
      addField(field, fields, findings, input);
    }
  }

  const required = [
    "Entry ID",
    "Affected surface or equivalent set",
    "Owner/source",
    "Mode",
    "Implementation disposition",
    "Proof",
  ];
  for (const fieldName of required) {
    if (!fields.has(fieldName)) {
      findings.push({
        code: "projection-entry-field-invalid",
        offset: nodeStart(entryNode),
      });
    }
  }
  if (fields.size !== required.length) {
    findings.push({
      code: "projection-entry-field-invalid",
      offset: nodeStart(entryNode),
    });
  }
  if (required.some((fieldName) => !fields.has(fieldName))) return undefined;

  const entryId = fields.get("Entry ID") as {
    value: string;
    offset: number;
    source: string;
  };
  const affected = fields.get("Affected surface or equivalent set") as {
    value: string;
    offset: number;
    source: string;
  };
  const owner = fields.get("Owner/source") as {
    value: string;
    offset: number;
    source: string;
  };
  const mode = fields.get("Mode") as {
    value: string;
    offset: number;
    source: string;
  };
  const disposition = fields.get("Implementation disposition") as {
    value: string;
    offset: number;
    source: string;
  };
  const proof = fields.get("Proof") as {
    value: string;
    offset: number;
    source: string;
  };

  const entryIdentifier = entryId.value.trim();
  const affectedSurfaces = parseAffectedSurfaces(affected.source);
  const ownerSource = owner.value.trim();
  const modeValue = mode.value.trim();
  const parsedDisposition = parseDisposition(disposition.value);
  const parsedProof = parseProof(proof.value);

  if (IDENTIFIER.test(entryIdentifier)) {
    entryIds.push({ entry_id: entryIdentifier, offset: nodeStart(entryNode) });
  }

  if (parsedDisposition !== undefined) {
    for (const taskId of parsedDisposition.taskIds) {
      taskReferences.push({ task_id: taskId, offset: disposition.offset });
    }
  }
  if (parsedProof?.proof.owner_type === "task") {
    taskReferences.push({
      task_id: parsedProof.proof.owner,
      offset: proof.offset,
    });
  }

  let invalid = false;
  for (const [valid, offset] of [
    [IDENTIFIER.test(entryIdentifier), entryId.offset],
    [affectedSurfaces !== undefined, affected.offset],
    [ownerSource.length > 0, owner.offset],
    [MODES.has(modeValue), mode.offset],
    [parsedDisposition !== undefined, disposition.offset],
    [parsedProof !== undefined, proof.offset],
  ] as const) {
    if (valid) continue;
    invalid = true;
    findings.push({ code: "projection-entry-field-invalid", offset });
  }
  if (
    invalid ||
    affectedSurfaces === undefined ||
    parsedDisposition === undefined ||
    parsedProof === undefined
  ) {
    return undefined;
  }

  return {
    entry_id: entryIdentifier,
    affected_surfaces: affectedSurfaces,
    owner_source: ownerSource,
    mode: modeValue,
    implementation_task_ids: parsedDisposition.taskIds,
    no_code_reason: parsedDisposition.noCodeReason,
    proof: parsedProof.proof,
    start: nodeStart(entryNode),
    end: nodeEnd(entryNode),
  };
}

function addField(
  node: MarkdownNode,
  fields: Map<string, { value: string; offset: number; source: string }>,
  findings: Finding[],
  input: string,
): void {
  const children = node.children ?? [];
  const paragraph =
    node.type === "paragraph"
      ? node
      : node.type === "listItem" &&
          children.length === 1 &&
          children[0]?.type === "paragraph"
        ? children[0]
        : undefined;
  if (paragraph === undefined) {
    findings.push({
      code: "projection-entry-field-invalid",
      offset: nodeStart(node),
    });
    return;
  }
  const match = /^([^:]+):\s*(.*?)\s*$/su.exec(nodeText(paragraph));
  if (match === null) {
    findings.push({
      code: "projection-entry-field-invalid",
      offset: nodeStart(node),
    });
    return;
  }
  const [, name, value] = match;
  if (fields.has(name)) {
    findings.push({
      code: "projection-entry-field-invalid",
      offset: nodeStart(node),
    });
    return;
  }
  fields.set(name, {
    value,
    offset: nodeStart(node),
    source: input.slice(nodeStart(paragraph), nodeEnd(paragraph)),
  });
}

function parseAffectedSurfaces(source: string): string[] | undefined {
  const match =
    /^\*\*Affected surface or equivalent set:\*\*[ \t]*([\s\S]*)$/u.exec(
      source,
    );
  if (match === null) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some(
        (surface) => typeof surface !== "string" || surface.length === 0,
      ) ||
      new Set(parsed).size !== parsed.length
    ) {
      return undefined;
    }
    return parsed as string[];
  } catch {
    return undefined;
  }
}

function parseDisposition(
  value: string,
): { taskIds: string[]; noCodeReason: string | null } | undefined {
  const tasks = /^Tasks\s+\[([^\]]+)\]$/u.exec(value.trim());
  if (tasks !== null) {
    const taskIds = tasks[1].split(",").map((taskId) => taskId.trim());
    if (
      taskIds.some((taskId) => !IDENTIFIER.test(taskId)) ||
      new Set(taskIds).size !== taskIds.length
    ) {
      return undefined;
    }
    return { taskIds, noCodeReason: null };
  }
  const noCode = /^No code\s+—\s+(.+)$/u.exec(value.trim());
  if (noCode === null || noCode[1].trim().length === 0) return undefined;
  return { taskIds: [], noCodeReason: noCode[1].trim() };
}

function parseProof(value: string): { proof: ProjectionProof } | undefined {
  const match = /^(Task|Reviewer|Controller)\s+(.+?)\s+—\s+(.+)$/u.exec(
    value.trim(),
  );
  if (match === null) return undefined;
  const [, ownerKind, owner, boundary] = match;
  const ownerType = ownerKind.toLowerCase() as ProjectionProof["owner_type"];
  if (
    owner.trim().length === 0 ||
    boundary.trim().length === 0 ||
    (ownerType === "task" && !IDENTIFIER.test(owner.trim()))
  ) {
    return undefined;
  }
  return {
    proof: {
      owner_type: ownerType,
      owner: owner.trim(),
      boundary: boundary.trim(),
    },
  };
}

function inspectTasks(
  children: readonly MarkdownNode[],
  tasksHeading: MarkdownNode,
  inputEnd: number,
  findings: Finding[],
  input: string,
): ProjectionTask[] {
  const sectionEnd = children.find(
    (node) =>
      isHeading(node) &&
      node.depth === 2 &&
      nodeStart(node) > nodeStart(tasksHeading),
  );
  const tasksEnd = sectionEnd === undefined ? inputEnd : nodeStart(sectionEnd);
  const canonicalHeadings = children.filter(
    (node) =>
      isCanonicalTaskHeading(input, node) &&
      nodeStart(node) > nodeStart(tasksHeading) &&
      nodeStart(node) < tasksEnd,
  );
  const tasks: ProjectionTask[] = [];
  for (let index = 0; index < canonicalHeadings.length; index += 1) {
    const heading = canonicalHeadings[index];
    const nextTask = canonicalHeadings[index + 1];
    const taskEnd = nextTask === undefined ? tasksEnd : nodeStart(nextTask);
    const headingIndex = children.indexOf(heading);
    const immediateTaskId = children[headingIndex + 1];
    const taskIdNodes = children.filter(
      (node) =>
        nodeStart(node) > nodeStart(heading) &&
        nodeStart(node) < taskEnd &&
        isTaskIdParagraph(node),
    );
    if (!isTaskIdParagraph(immediateTaskId)) {
      findings.push({ code: "task-id-invalid", offset: nodeStart(heading) });
      continue;
    }
    if (taskIdNodes.length !== 1) {
      findings.push({
        code: taskIdNodes.length > 1 ? "task-id-duplicate" : "task-id-invalid",
        offset: nodeStart(taskIdNodes[1] ?? heading),
      });
      continue;
    }
    const taskId = readTaskId(immediateTaskId);
    if (taskId === undefined) {
      findings.push({ code: "task-id-invalid", offset: nodeStart(heading) });
      continue;
    }
    tasks.push({
      task_id: taskId,
      heading: nodeText(heading),
      start: nodeStart(heading),
      end: taskEnd,
    });
  }
  return tasks;
}

function readTaskId(node: MarkdownNode | undefined): string | undefined {
  if (!isTaskIdParagraph(node)) return undefined;
  const match = /^Task ID:\s*(.*?)\s*$/su.exec(nodeText(node));
  if (match === null || !IDENTIFIER.test(match[1])) return undefined;
  return match[1];
}

function isTaskIdParagraph(
  node: MarkdownNode | undefined,
): node is MarkdownNode {
  return node?.type === "paragraph" && /^Task ID:/u.test(nodeText(node));
}

function isHeading(
  node: MarkdownNode,
): node is MarkdownNode & { depth: number } {
  return node.type === "heading" && node.depth !== undefined;
}

function isLiteralH2(
  input: string,
  node: MarkdownNode,
  heading: string,
): boolean {
  return (
    isHeading(node) &&
    node.depth === 2 &&
    nodeText(node) === heading &&
    new RegExp(`^##[\\t ]+${heading}[\\t ]*$`, "u").test(
      input.slice(nodeStart(node), nodeEnd(node)),
    )
  );
}

function isCanonicalTaskHeading(input: string, node: MarkdownNode): boolean {
  return (
    isHeading(node) &&
    node.depth === 3 &&
    /^Task\s+\d+(?:[\t :]|$)/u.test(nodeText(node)) &&
    /^###[\t ]+Task\s+\d+(?:[\t :]|$)/u.test(
      input.slice(nodeStart(node), nodeEnd(node)),
    )
  );
}

function nodeText(node: MarkdownNode): string {
  if (node.value !== undefined) return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function nodeStart(node: MarkdownNode): number {
  const offset = node.position?.start.offset;
  if (offset === undefined) {
    throw new ProjectionFailure("projection-entry-field-invalid", 0);
  }
  return offset;
}

function nodeEnd(node: MarkdownNode): number {
  const offset = node.position?.end.offset;
  if (offset === undefined) {
    throw new ProjectionFailure("projection-entry-field-invalid", 0);
  }
  return offset;
}

function throwFirst(findings: readonly Finding[]): undefined {
  let first: Finding | undefined;
  for (const finding of findings) {
    if (first === undefined || finding.offset < first.offset) first = finding;
  }
  if (first !== undefined)
    throw new ProjectionFailure(first.code, first.offset);
  return undefined;
}

function projectionFail(code: FailureCode): RuntimeCommandOutcome {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${JSON.stringify({ ok: false, code, message: code })}\n`,
  };
}
