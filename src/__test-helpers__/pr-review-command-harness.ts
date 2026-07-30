import { type ChildProcess, spawn } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_COMMAND_DEADLINE_MS = 4_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1_048_576;
const TASKKILL_STDERR_LIMIT_BYTES = 16_384;
const DIRECT_CHILD_CLOSE_DEADLINE_MS = 250;
const MAX_OWNED_SUFFIX_CODE_UNITS = 120;
const MAX_WINDOWS_ABSOLUTE_CODE_UNITS = 180;
const LONGEST_OWNED_ARTIFACT = `.ephemeral/pr-432-${"a".repeat(64)}-lease.json`;

export interface HarnessCommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface HarnessCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  deadlineMs?: number;
  outputLimitBytes?: number;
  acceptedExitCodes?: readonly number[];
}

export interface ReviewWorkspace {
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}

export interface ReviewRepository {
  tempRoot: string;
  repository: string;
  physicalRepository: string;
}

export interface SourceWorkspaceOptions {
  commit?: boolean;
  ephemeral?: boolean;
}

type HarnessSeed = "review" | "source";

interface HarnessOptions {
  envKeys: readonly string[];
  seed: HarnessSeed;
  commandDeadlineMs?: number;
  terminationPlatform?: NodeJS.Platform;
  windowsTaskkillCommand?: (pid: number) => CommandInvocation;
  directChildKill?: (child: ChildProcess) => void;
}

interface CommandInvocation {
  command: string;
  args: readonly string[];
}

interface CaseRecord {
  root: string;
  primary?: string;
  worktree?: string;
  registeredWorktree?: string;
}

interface EnvironmentEntry {
  key: string;
  value: string;
}

class GlobalStateSnapshot {
  readonly cwd = process.cwd();
  readonly environment: EnvironmentEntry[];

  constructor(private readonly envKeys: readonly string[]) {
    const selected = new Set(envKeys.map(environmentKey));
    this.environment = Object.entries(process.env)
      .filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && selected.has(environmentKey(entry[0])),
      )
      .map(([key, value]) => ({ key, value }));
  }

  restore(): void {
    process.chdir(this.cwd);
    const selected = new Set(this.envKeys.map(environmentKey));
    for (const key of Object.keys(process.env)) {
      if (selected.has(environmentKey(key))) {
        Reflect.deleteProperty(process.env, key);
      }
    }
    for (const { key, value } of this.environment) {
      process.env[key] = value;
    }
  }

  assertRestored(): void {
    if (process.cwd() !== this.cwd) {
      throw new Error(
        `test cwd was not restored: expected ${this.cwd}, received ${process.cwd()}`,
      );
    }
    const expected = [...this.environment].sort(compareEnvironmentEntries);
    const selected = new Set(this.envKeys.map(environmentKey));
    const actual = Object.entries(process.env)
      .filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && selected.has(environmentKey(entry[0])),
      )
      .map(([key, value]) => ({ key, value }))
      .sort(compareEnvironmentEntries);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `test environment was not restored: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  }
}

export class PrReviewCommandHarness {
  private readonly activeOperations = new Set<Promise<void>>();
  private readonly children = new Set<ChildProcess>();
  private readonly caseRecords: CaseRecord[] = [];
  private readonly envKeys: readonly string[];
  private readonly seed: HarnessSeed;
  private readonly commandDeadlineMs: number;
  private readonly terminationPlatform: NodeJS.Platform;
  private readonly windowsTaskkillCommand: (pid: number) => CommandInvocation;
  private readonly directChildKill: (child: ChildProcess) => void;
  private readonly observedErrors: unknown[] = [];
  private root: string | null = null;
  private snapshot: GlobalStateSnapshot | null = null;
  private nextCaseId = 0;

  constructor(options: HarnessOptions) {
    this.envKeys = options.envKeys;
    this.seed = options.seed;
    this.commandDeadlineMs =
      options.commandDeadlineMs ?? DEFAULT_COMMAND_DEADLINE_MS;
    this.terminationPlatform = options.terminationPlatform ?? process.platform;
    this.windowsTaskkillCommand =
      options.windowsTaskkillCommand ?? defaultWindowsTaskkillCommand;
    this.directChildKill =
      options.directChildKill ??
      ((child) => {
        child.kill();
      });
    if (
      this.commandDeadlineMs <= 0 ||
      this.commandDeadlineMs >= DEFAULT_COMMAND_DEADLINE_MS + 1_000
    ) {
      throw new Error(
        `command deadline must be between 1 and 4999ms: ${this.commandDeadlineMs}`,
      );
    }
  }

  get suiteRoot(): string {
    if (this.root === null) {
      throw new Error("command harness has not been set up");
    }
    return this.root;
  }

  get activeChildCount(): number {
    return this.children.size;
  }

  get activeOperationCount(): number {
    return this.activeOperations.size;
  }

  ownsCaseRoot(value: string): boolean {
    const resolved = path.resolve(value);
    return this.caseRecords.some(
      (record) => path.resolve(record.root) === resolved,
    );
  }

  async setup(): Promise<void> {
    if (this.root !== null) {
      throw new Error("command harness is already set up");
    }
    this.root = await mkdtemp(path.join(os.tmpdir(), "dc-"));
    this.assertOwnedPath(
      path.join(this.root, "c", "0000", "p", LONGEST_OWNED_ARTIFACT),
    );
    await mkdir(path.join(this.root, "s"), { recursive: true });
    if (this.seed === "review") {
      await this.createReviewSeed(path.join(this.root, "s", "r"));
    } else {
      await this.createSourceSeed(path.join(this.root, "s", "c"), true);
      await this.createSourceSeed(path.join(this.root, "s", "u"), false);
    }
  }

  beginTest(): void {
    if (this.snapshot !== null) {
      throw new Error("test state is already active");
    }
    this.snapshot = new GlobalStateSnapshot(this.envKeys);
  }

  trackOuter<T>(operation: Promise<T>, label: string): Promise<T> {
    let deadlineWon = false;
    const deadline = deferredDeadline<T>(
      this.commandDeadlineMs,
      `${label} exceeded the ${this.commandDeadlineMs}ms harness deadline`,
      () => {
        deadlineWon = true;
      },
    );
    const guarded = Promise.race([operation, deadline.promise]).finally(
      deadline.cancel,
    );
    this.observe(operation, () => deadlineWon);
    return guarded;
  }

  async withIsolatedState<T>(operation: () => Promise<T>): Promise<T> {
    const snapshot = new GlobalStateSnapshot(this.envKeys);
    try {
      return await operation();
    } finally {
      snapshot.restore();
      snapshot.assertRestored();
    }
  }

  async run(
    command: string,
    args: readonly string[],
    options: HarnessCommandOptions = {},
  ): Promise<HarnessCommandResult> {
    const deadlineMs = options.deadlineMs ?? this.commandDeadlineMs;
    if (deadlineMs <= 0 || deadlineMs >= 5_000) {
      throw new Error(
        `child deadline must be between 1 and 4999ms: ${deadlineMs}`,
      );
    }
    const outputLimitBytes =
      options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    const acceptedExitCodes = options.acceptedExitCodes ?? [0];
    const operation = new Promise<HarnessCommandResult>((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: this.terminationPlatform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.children.add(child);

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let spawnError: Error | null = null;
      let terminalError: Error | null = null;
      let termination: Promise<void> | null = null;
      let operationSettled = false;
      const rejectOperation = (error: unknown): void => {
        if (operationSettled) return;
        operationSettled = true;
        reject(error);
      };
      const resolveOperation = (result: HarnessCommandResult): void => {
        if (operationSettled) return;
        operationSettled = true;
        resolve(result);
      };
      const startTermination = (): Promise<void> => {
        if (termination === null) {
          termination = this.terminateTree(child);
          void termination.catch(rejectOperation);
        }
        return termination;
      };

      const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
        if (terminalError !== null) return;
        const current = stream === "stdout" ? stdout : stderr;
        const nextSize = current.length + chunk.length;
        if (nextSize > outputLimitBytes) {
          terminalError = new Error(
            `${command} ${stream} exceeded ${outputLimitBytes} bytes`,
          );
          startTermination();
          return;
        }
        if (stream === "stdout") {
          stdout = Buffer.concat([stdout, chunk], nextSize);
        } else {
          stderr = Buffer.concat([stderr, chunk], nextSize);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        spawnError = error;
      });
      child.stdin.once("error", (error) => {
        terminalError ??= error;
      });
      child.stdin.end(options.input);

      const timer = setTimeout(() => {
        terminalError = new Error(
          `${command} exceeded the ${deadlineMs}ms child deadline`,
        );
        startTermination();
      }, deadlineMs);

      child.once("close", async (code, signal) => {
        clearTimeout(timer);
        this.children.delete(child);
        try {
          await termination;
          if (spawnError !== null) {
            rejectOperation(spawnError);
            return;
          }
          if (terminalError !== null) {
            rejectOperation(terminalError);
            return;
          }
          const exitCode = code ?? 1;
          const result = {
            exitCode,
            signal,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
          };
          if (!acceptedExitCodes.includes(exitCode)) {
            rejectOperation(commandFailure(command, args, result));
            return;
          }
          resolveOperation(result);
        } catch (error) {
          rejectOperation(error);
        }
      });
    });
    this.observe(operation);
    return operation;
  }

  async createPlainReviewWorkspace(): Promise<ReviewWorkspace> {
    this.requireSeed("review");
    const record = await this.allocateCase();
    const primary = path.join(record.root, "p");
    const worktree = path.join(record.root, "w");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    return {
      tempRoot: record.root,
      primary,
      worktree,
      physicalPrimary: await realpath(primary),
      physicalWorktree: await realpath(worktree),
    };
  }

  async createReviewRepository(): Promise<ReviewRepository> {
    this.requireSeed("review");
    const record = await this.allocateCase();
    const repository = path.join(record.root, "repo");
    await cp(path.join(this.suiteRoot, "s", "r"), repository, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await mkdir(path.join(repository, ".ephemeral"));
    return {
      tempRoot: record.root,
      repository,
      physicalRepository: await realpath(repository),
    };
  }

  async createRegisteredReviewWorkspace(
    branchName = "topic",
  ): Promise<ReviewWorkspace> {
    this.requireSeed("review");
    const record = await this.allocateCase();
    const primary = path.join(record.root, "p");
    const worktree = path.join(record.root, "w");
    this.assertOwnedPath(primary);
    this.assertOwnedPath(worktree);
    await cp(path.join(this.suiteRoot, "s", "r"), primary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await this.run(
      "git",
      ["-C", primary, "worktree", "add", "-b", branchName, worktree, "HEAD"],
      { cwd: record.root },
    );
    record.primary = primary;
    record.worktree = worktree;
    record.registeredWorktree = await realpath(worktree);
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    return {
      tempRoot: record.root,
      primary,
      worktree,
      physicalPrimary: await realpath(primary),
      physicalWorktree: record.registeredWorktree,
    };
  }

  async createSourceWorkspace(
    options: SourceWorkspaceOptions = {},
  ): Promise<string> {
    this.requireSeed("source");
    const record = await this.allocateCase();
    const workspace = path.join(record.root, "repo");
    const seedName = options.commit === false ? "u" : "c";
    await cp(path.join(this.suiteRoot, "s", seedName), workspace, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    if (options.ephemeral === false) {
      await rm(path.join(workspace, ".ephemeral"), {
        recursive: true,
        force: true,
      });
    }
    this.assertOwnedPath(path.join(workspace, LONGEST_OWNED_ARTIFACT));
    return workspace;
  }

  async createScratchRoot(): Promise<string> {
    return (await this.allocateCase()).root;
  }

  assertOwnedPath(value: string): void {
    const relative = path.relative(this.suiteRoot, value);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`path is outside the command harness root: ${value}`);
    }
    if (relative.length > MAX_OWNED_SUFFIX_CODE_UNITS) {
      throw new Error(
        `command harness suffix exceeds ${MAX_OWNED_SUFFIX_CODE_UNITS} code units: ${relative.length} ${relative}`,
      );
    }
    if (
      process.platform === "win32" &&
      path.resolve(value).length > MAX_WINDOWS_ABSOLUTE_CODE_UNITS
    ) {
      throw new Error(
        `command harness path exceeds ${MAX_WINDOWS_ABSOLUTE_CODE_UNITS} Windows code units: ${path.resolve(value).length} ${path.resolve(value)}`,
      );
    }
  }

  async endTest(): Promise<void> {
    const errors: unknown[] = [];
    await captureError(() => this.drain(), errors);
    if (this.snapshot === null) {
      errors.push(new Error("test state was not active"));
    } else {
      await captureError(async () => this.snapshot?.restore(), errors);
      await captureError(async () => this.snapshot?.assertRestored(), errors);
      this.snapshot = null;
    }
    while (this.caseRecords.length > 0) {
      const record = this.caseRecords.pop();
      if (record === undefined) break;
      await captureError(() => this.cleanupCase(record), errors);
    }
    await captureError(() => this.drain(), errors);
    throwCollected("command harness teardown failed", errors);
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    await captureError(() => this.drain(), errors);
    if (this.snapshot !== null) {
      await captureError(async () => this.snapshot?.restore(), errors);
      this.snapshot = null;
    }
    while (this.caseRecords.length > 0) {
      const record = this.caseRecords.pop();
      if (record === undefined) break;
      await captureError(() => this.cleanupCase(record), errors);
    }
    if (this.root !== null) {
      const root = this.root;
      this.root = null;
      await captureError(
        () => rm(root, { recursive: true, force: true }),
        errors,
      );
    }
    await captureError(() => this.drain(), errors);
    if (this.children.size !== 0 || this.activeOperations.size !== 0) {
      errors.push(
        new Error(
          `command harness is not quiescent: ${this.children.size} children, ${this.activeOperations.size} operations`,
        ),
      );
    }
    throwCollected("command harness disposal failed", errors);
  }

  async readSeedFile(relativePath: string): Promise<string> {
    const seedName = this.seed === "review" ? "r" : "c";
    return readFile(
      path.join(this.suiteRoot, "s", seedName, relativePath),
      "utf8",
    );
  }

  private async allocateCase(): Promise<CaseRecord> {
    const id = String(this.nextCaseId++).padStart(4, "0");
    const root = path.join(this.suiteRoot, "c", id);
    this.assertOwnedPath(root);
    await mkdir(root, { recursive: true });
    const record = { root };
    this.caseRecords.push(record);
    return record;
  }

  private requireSeed(seed: HarnessSeed): void {
    if (this.seed !== seed) {
      throw new Error(`command harness seed mismatch: expected ${seed}`);
    }
  }

  private observe<T>(
    operation: Promise<T>,
    retainRejection: (error: unknown) => boolean = () => false,
  ): void {
    const observed = operation
      .then(
        () => undefined,
        (error) => {
          if (retainRejection(error)) {
            this.observedErrors.push(error);
          }
        },
      )
      .finally(() => {
        this.activeOperations.delete(observed);
      });
    this.activeOperations.add(observed);
  }

  private async drain(): Promise<void> {
    while (this.activeOperations.size > 0) {
      await Promise.all([...this.activeOperations]);
    }
    const errors = this.observedErrors.splice(0);
    if (this.children.size !== 0) {
      errors.push(
        new Error(
          `command harness retained ${this.children.size} child processes after drain`,
        ),
      );
    }
    throwCollected("command harness operation drain failed", errors);
  }

  private async cleanupCase(record: CaseRecord): Promise<void> {
    const errors: unknown[] = [];
    const primary = record.primary;
    const worktree = record.worktree;
    if (primary !== undefined && worktree !== undefined) {
      await captureError(async () => {
        const target = record.registeredWorktree ?? worktree;
        const registered = await this.listRegisteredWorktrees(primary);
        if (!registered.some((candidate) => samePath(candidate, target))) {
          return;
        }

        const marker = await fileType(path.join(worktree, ".git"));
        if (marker === "file") {
          await this.run(
            "git",
            ["-C", primary, "worktree", "remove", "--force", worktree],
            { cwd: record.root },
          );
          return;
        }

        await rm(worktree, { recursive: true, force: true });
        await this.run(
          "git",
          ["-C", primary, "worktree", "prune", "--expire", "now"],
          { cwd: record.root },
        );
        const remaining = await this.listRegisteredWorktrees(primary);
        if (remaining.some((candidate) => samePath(candidate, target))) {
          throw new Error(
            `registered worktree remained after prune: ${worktree}`,
          );
        }
      }, errors);
    }
    await captureError(
      () => rm(record.root, { recursive: true, force: true }),
      errors,
    );
    throwCollected(
      `command harness case cleanup failed: ${record.root}`,
      errors,
    );
  }

  private async listRegisteredWorktrees(primary: string): Promise<string[]> {
    const { stdout } = await this.run(
      "git",
      ["-C", primary, "worktree", "list", "--porcelain", "-z"],
      { cwd: primary },
    );
    return stdout
      .split("\0")
      .filter((field) => field.startsWith("worktree "))
      .map((field) => field.slice("worktree ".length));
  }

  private async terminateTree(child: ChildProcess): Promise<void> {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (this.terminationPlatform === "win32") {
      await this.terminateWindowsTree(child);
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if (!isMissingProcess(error)) {
              reject(error);
              return;
            }
          }
        }
        resolve();
      }, 250);
      child.once("close", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }

  private async terminateWindowsTree(child: ChildProcess): Promise<void> {
    if (child.pid === undefined) return;
    const invocation = this.windowsTaskkillCommand(child.pid);
    await new Promise<void>((resolve, reject) => {
      const taskkill = spawn(invocation.command, [...invocation.args], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      this.children.add(taskkill);
      let settled = false;
      let terminalError: Error | null = null;
      let fallback: Promise<void> | null = null;
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let timer: NodeJS.Timeout | null = null;
      const startFallback = (): Promise<void> => {
        fallback ??= this.terminateDirectChild(child);
        return fallback;
      };
      const finish = async (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): Promise<void> => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        this.children.delete(taskkill);
        if (terminalError === null && (code !== 0 || signal !== null)) {
          terminalError = taskkillFailure(code, signal, stderr);
        }
        try {
          if (terminalError !== null) {
            await startFallback();
            reject(terminalError);
            return;
          }
          resolve();
        } catch (error) {
          reject(
            new AggregateError(
              [terminalError, error].filter((entry) => entry !== null),
              "taskkill and direct-child fallback failed",
            ),
          );
        }
      };
      taskkill.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk, TASKKILL_STDERR_LIMIT_BYTES);
      });
      timer = setTimeout(() => {
        terminalError = new Error(
          `taskkill exceeded the ${this.commandDeadlineMs}ms child deadline`,
        );
        taskkill.kill();
        void startFallback().catch(() => undefined);
      }, this.commandDeadlineMs);
      taskkill.once("error", (error) => {
        terminalError = error;
        void startFallback().catch(() => undefined);
      });
      taskkill.once("close", (code, signal) => {
        void finish(code, signal);
      });
    });
  }

  private async terminateDirectChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const onClose = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.off("close", onClose);
        reject(
          new Error(
            `direct child did not close within ${DIRECT_CHILD_CLOSE_DEADLINE_MS}ms after taskkill failure`,
          ),
        );
      }, DIRECT_CHILD_CLOSE_DEADLINE_MS);
      child.once("close", onClose);
      this.directChildKill(child);
    });
  }

  private async createReviewSeed(root: string): Promise<void> {
    await mkdir(root, { recursive: true });
    await this.run("git", ["init", "--initial-branch=main"], { cwd: root });
    await this.configureIdentity(root);
    await writeFile(path.join(root, "README.md"), "baseline\n");
    await this.run("git", ["add", "README.md"], { cwd: root });
    await this.run("git", ["commit", "-m", "chore: baseline"], { cwd: root });
  }

  private async createSourceSeed(root: string, commit: boolean): Promise<void> {
    await mkdir(root, { recursive: true });
    await this.run("git", ["init", "--initial-branch=main"], { cwd: root });
    await this.configureIdentity(root);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\nignored/\n");
    await writeFile(path.join(root, "tracked.txt"), "baseline\n");
    await writeFile(path.join(root, "mode.sh"), "#!/bin/sh\n");
    await chmod(path.join(root, "mode.sh"), 0o644);
    await mkdir(path.join(root, ".ephemeral"));
    if (commit) {
      await this.run("git", ["add", ".gitignore", "tracked.txt", "mode.sh"], {
        cwd: root,
      });
      await this.run("git", ["commit", "-m", "chore: baseline"], {
        cwd: root,
      });
    }
  }

  private async configureIdentity(root: string): Promise<void> {
    await this.run("git", ["config", "user.name", "Test User"], { cwd: root });
    await this.run("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
  }
}

function environmentKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function compareEnvironmentEntries(
  left: EnvironmentEntry,
  right: EnvironmentEntry,
): number {
  return (
    left.key.localeCompare(right.key) || left.value.localeCompare(right.value)
  );
}

function commandFailure(
  command: string,
  args: readonly string[],
  result: HarnessCommandResult,
): Error & HarnessCommandResult {
  return Object.assign(
    new Error(
      `${command} ${args.join(" ")} exited ${result.exitCode}\n${result.stderr}`,
    ),
    result,
  );
}

function deferredDeadline<T>(
  deadlineMs: number,
  message: string,
  onDeadline: () => void = () => undefined,
): { promise: Promise<T>; cancel: () => void } {
  let timer: NodeJS.Timeout | null = null;
  const promise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      onDeadline();
      reject(new Error(message));
    }, deadlineMs);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

function defaultWindowsTaskkillCommand(pid: number): CommandInvocation {
  return {
    command: "taskkill.exe",
    args: ["/pid", String(pid), "/t", "/f"],
  };
}

function taskkillFailure(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: Buffer,
): Error {
  const status =
    code === null
      ? `terminated by ${signal ?? "unknown signal"}`
      : `exited ${code}`;
  const diagnostic = stderr.toString("utf8").trim();
  const suffix = diagnostic === "" ? "" : `: ${diagnostic}`;
  return new Error(`taskkill ${status}${suffix}`);
}

function appendBounded(
  current: Buffer,
  chunk: Buffer,
  limitBytes: number,
): Buffer {
  if (current.length >= limitBytes) return current;
  const remaining = limitBytes - current.length;
  return Buffer.concat(
    [current, chunk.subarray(0, remaining)],
    current.length + Math.min(chunk.length, remaining),
  );
}

async function captureError(
  operation: () => Promise<unknown>,
  errors: unknown[],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(error);
  }
}

function throwCollected(message: string, errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function fileType(value: string): Promise<"file" | "other" | "missing"> {
  try {
    return (await lstat(value)).isFile() ? "file" : "other";
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}
