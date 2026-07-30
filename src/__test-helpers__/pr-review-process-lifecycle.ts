import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  ProtocolDecoder,
  frameProtocolMessage,
} from "./pr-review-process-protocol.js";
import {
  type PathIdentity,
  enrollExecutable,
  enrollPathIdentity,
  enrollWorkingDirectory,
} from "./pr-review-root-identity.js";

export const GENERATED_ROOT_MARKER = ".devcanon-pr-review-generated-root";

const GENERATED_ROOT_MARKER_CONTENT = "v1\n";
const MIN_DEADLINE_MS = 1;
const MAX_DEADLINE_MS = 60_000;
const MIN_OUTPUT_LIMIT_BYTES = 1;
const MAX_OUTPUT_LIMIT_BYTES = 65_536;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 8_192;
const MAX_ENVIRONMENT_ENTRIES = 64;
const MAX_ENVIRONMENT_KEY_BYTES = 256;
const MAX_ENVIRONMENT_VALUE_BYTES = 8_192;
const MAX_REDACTION_VALUES = 16;
const MAX_REDACTION_VALUE_BYTES = 4_096;

export interface PrReviewProcessLifecycleRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  generatedRoot: string;
  environment: Readonly<Record<string, string>>;
  deadlineMs: number;
  outputLimitBytes: number;
  redact?: readonly string[];
}

export interface PrReviewProcessLifecycleResult {
  readonly rootProcess: {
    readonly spawned: boolean;
    readonly exitObserved: boolean;
    readonly closeObserved: boolean;
    readonly signal: NodeJS.Signals | null;
    readonly exitCode: number | null;
  };
  readonly channels: {
    readonly stdoutClosed: boolean;
    readonly stderrClosed: boolean;
    readonly controlClosed: boolean;
  };
  readonly output: {
    readonly stdout: OutputEvidence;
    readonly stderr: OutputEvidence;
  };
  readonly cooperative: {
    readonly requested: boolean;
    readonly descendantsAcknowledged: boolean | "unknown";
  };
  readonly cleanup: {
    readonly forceTermination: "not-needed" | "attempted" | "failed";
  };
  readonly restoration: "restored";
  readonly generatedRoot: "removed" | "preserved_unsafe";
}

export interface OutputEvidence {
  readonly bytes: number;
  readonly digest: string;
  readonly overflowed: boolean;
  readonly text: string;
}

export interface PrReviewProcessLifecycle {
  finish(options?: {
    cancel?: boolean;
    cooperativeGraceMs?: number;
  }): Promise<PrReviewProcessLifecycleResult>;
}

type RootIdentity = PathIdentity & { type: "directory" };

class LifecycleError extends Error {
  constructor(message: string) {
    super(`Invalid PR-review process lifecycle: ${message}`);
    this.name = "LifecycleError";
  }
}

class BoundedOutput {
  readonly #hash = createHash("sha256");
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  #retained = 0;

  constructor(
    private readonly limit: number,
    private readonly redactions: readonly string[],
  ) {}

  push(chunk: Buffer): void {
    this.#bytes += chunk.length;
    this.#hash.update(chunk);
    const available = this.limit - this.#retained;
    if (available <= 0) return;
    const retained = chunk.subarray(0, available);
    this.#chunks.push(Buffer.from(retained));
    this.#retained += retained.length;
  }

  snapshot(): OutputEvidence {
    let text = Buffer.concat(this.#chunks).toString("utf8");
    for (const value of this.redactions) {
      text = text.split(value).join("[REDACTED]");
    }
    return Object.freeze({
      bytes: this.#bytes,
      digest: this.#hash.copy().digest("hex"),
      overflowed: this.#bytes > this.limit,
      text,
    });
  }
}

export async function launchPrReviewProcessLifecycle(
  request: PrReviewProcessLifecycleRequest,
): Promise<PrReviewProcessLifecycle> {
  validateRequest(request);
  const deadline = performance.now() + request.deadlineMs;
  const executable = await enrollExecutable(request.executable);
  const generatedRoot = await enrollPathIdentity(
    request.generatedRoot,
    "directory",
  );
  const cwd = await enrollWorkingDirectory(generatedRoot, request.cwd);
  const initialRoot = await readGeneratedRootEvidence(generatedRoot);
  if (deadline - performance.now() <= 0) {
    throw new LifecycleError("deadline expired during root preflight");
  }
  const initialCwd = process.cwd();
  const child = spawn(executable.identity.physical, [...request.args], {
    cwd: cwd.identity.physical,
    env: { ...request.environment },
    shell: false,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  return new RootLifecycle(child, deadline, request, initialRoot, initialCwd);
}

class RootLifecycle implements PrReviewProcessLifecycle {
  readonly #stdout: BoundedOutput;
  readonly #stderr: BoundedOutput;
  readonly #decoder = new ProtocolDecoder();
  readonly #close: Promise<void>;
  #exitObserved = false;
  #closeObserved = false;
  #stdoutClosed = false;
  #stderrClosed = false;
  #controlClosed = false;
  #exitCode: number | null = null;
  #signal: NodeJS.Signals | null = null;
  #descendantsAcknowledged = false;
  #finishing: Promise<PrReviewProcessLifecycleResult> | undefined;

  constructor(
    private readonly child: ChildProcess,
    private readonly deadline: number,
    private readonly request: PrReviewProcessLifecycleRequest,
    private readonly generatedRoot: RootIdentity,
    private readonly initialCwd: string,
  ) {
    this.#stdout = new BoundedOutput(
      request.outputLimitBytes,
      request.redact ?? [],
    );
    this.#stderr = new BoundedOutput(
      request.outputLimitBytes,
      request.redact ?? [],
    );
    this.#close = new Promise((resolve) => {
      child.once("close", () => {
        this.#closeObserved = true;
        resolve();
      });
    });
    child.once("exit", (exitCode, signal) => {
      this.#exitObserved = true;
      this.#exitCode = exitCode;
      this.#signal = signal;
    });
    child.stdout?.on("data", (chunk: Buffer) => this.#stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.#stderr.push(chunk));
    child.stdout?.once("end", () => {
      this.#stdoutClosed = true;
    });
    child.stderr?.once("end", () => {
      this.#stderrClosed = true;
    });
    const control = child.stdio[3] as NodeJS.ReadWriteStream | null;
    control?.on("data", (chunk: Buffer) => this.#readControl(chunk));
    control?.once("end", () => {
      this.#controlClosed = true;
      this.#decoder.finish();
    });
  }

  finish(
    options: {
      cancel?: boolean;
      cooperativeGraceMs?: number;
    } = {},
  ): Promise<PrReviewProcessLifecycleResult> {
    this.#finishing ??= this.#finalize(options);
    return this.#finishing;
  }

  async #finalize(options: {
    cancel?: boolean;
    cooperativeGraceMs?: number;
  }): Promise<PrReviewProcessLifecycleResult> {
    let requested = false;
    let forceTermination: "not-needed" | "attempted" | "failed" = "not-needed";
    try {
      if (options.cancel === true) {
        requested = this.#requestCooperation();
        const cooperativeGraceMs = options.cooperativeGraceMs ?? 25;
        await this.#waitForClose(
          Math.min(this.#remaining(), Math.max(0, cooperativeGraceMs)),
        );
        if (!this.#closeObserved && this.#remaining() > 0) {
          try {
            this.child.kill();
            forceTermination = "attempted";
          } catch {
            forceTermination = "failed";
          }
        }
      }
      await this.#waitForClose(this.#remaining());
      const rootDisposition = await this.#removeGeneratedRootWhenSafe();
      return freezeResult({
        rootProcess: {
          spawned: true,
          exitObserved: this.#exitObserved,
          closeObserved: this.#closeObserved,
          signal: this.#signal,
          exitCode: this.#exitCode,
        },
        channels: {
          stdoutClosed: this.#stdoutClosed,
          stderrClosed: this.#stderrClosed,
          controlClosed: this.#controlClosed,
        },
        output: {
          stdout: this.#stdout.snapshot(),
          stderr: this.#stderr.snapshot(),
        },
        cooperative: {
          requested,
          descendantsAcknowledged: this.#descendantsAcknowledged || "unknown",
        },
        cleanup: { forceTermination },
        restoration: "restored",
        generatedRoot: rootDisposition,
      });
    } finally {
      if (process.cwd() !== this.initialCwd) process.chdir(this.initialCwd);
    }
  }

  #requestCooperation(): boolean {
    const control = this.child.stdio[3] as NodeJS.ReadWriteStream | null;
    if (!control || !control.writable || this.#remaining() <= 0) return false;
    const message = new TextEncoder().encode(
      JSON.stringify({ type: "cancel", version: 1 }),
    );
    control.write(frameProtocolMessage(message));
    return true;
  }

  #readControl(chunk: Buffer): void {
    const decoded = this.#decoder.push(chunk);
    for (const message of decoded.messages) {
      if (message.type === "descendants_stopped") {
        this.#descendantsAcknowledged = true;
      }
    }
  }

  async #waitForClose(waitMs: number): Promise<void> {
    if (this.#closeObserved || waitMs <= 0) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.#close,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, waitMs));
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #remaining(): number {
    return Math.max(0, this.deadline - performance.now());
  }

  async #removeGeneratedRootWhenSafe(): Promise<
    "removed" | "preserved_unsafe"
  > {
    if (!this.#closeObserved || this.#remaining() <= 0)
      return "preserved_unsafe";
    try {
      const current = await readGeneratedRootEvidence(this.generatedRoot);
      if (!sameIdentity(this.generatedRoot, current)) return "preserved_unsafe";
      await rm(this.generatedRoot.logical, { force: false, recursive: true });
      return "removed";
    } catch {
      return "preserved_unsafe";
    }
  }
}

async function readGeneratedRootEvidence(
  root: RootIdentity,
): Promise<RootIdentity> {
  const logical = root.logical;
  const direct = await lstat(logical);
  if (!direct.isDirectory() || direct.isSymbolicLink()) {
    throw new LifecycleError("generated root is not a direct directory");
  }
  if (
    !Number.isSafeInteger(direct.dev) ||
    !Number.isSafeInteger(direct.ino) ||
    direct.dev < 0 ||
    direct.ino < 0
  ) {
    throw new LifecycleError("generated root has no reliable stable identity");
  }
  const followed = await stat(logical);
  if (!followed.isDirectory() || !sameStats(direct, followed)) {
    throw new LifecycleError("generated root identity is ambiguous");
  }
  const physical = await realpath(logical);
  if (physical !== root.physical) {
    throw new LifecycleError("generated root physical path changed");
  }
  const marker = path.join(logical, GENERATED_ROOT_MARKER);
  const markerStat = await lstat(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new LifecycleError("generated root marker is unsafe");
  }
  if ((await readFile(marker, "utf8")) !== GENERATED_ROOT_MARKER_CONTENT) {
    throw new LifecycleError("generated root marker does not match");
  }
  return {
    ...root,
    device: BigInt(direct.dev),
    file: BigInt(direct.ino),
  };
}

function sameIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return left.device === right.device && left.file === right.file;
}

function sameStats(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof stat>>,
): boolean {
  return (
    Number.isSafeInteger(left.dev) &&
    Number.isSafeInteger(left.ino) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function validateRequest(request: PrReviewProcessLifecycleRequest): void {
  if (
    !Number.isInteger(request.deadlineMs) ||
    request.deadlineMs < MIN_DEADLINE_MS ||
    request.deadlineMs > MAX_DEADLINE_MS
  ) {
    throw new LifecycleError("deadline must be a finite bounded integer");
  }
  if (
    !Number.isInteger(request.outputLimitBytes) ||
    request.outputLimitBytes < MIN_OUTPUT_LIMIT_BYTES ||
    request.outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES
  ) {
    throw new LifecycleError("output limit must be a finite bounded integer");
  }
  if (
    !Array.isArray(request.args) ||
    request.args.length > MAX_ARGUMENTS ||
    request.args.some(
      (value) =>
        typeof value !== "string" ||
        value.includes("\0") ||
        Buffer.byteLength(value, "utf8") > MAX_ARGUMENT_BYTES,
    )
  ) {
    throw new LifecycleError("arguments must be NUL-free strings");
  }
  const redactions = request.redact ?? [];
  if (
    redactions.length > MAX_REDACTION_VALUES ||
    redactions.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        Buffer.byteLength(value, "utf8") > MAX_REDACTION_VALUE_BYTES,
    )
  ) {
    throw new LifecycleError("redactions must be bounded non-empty strings");
  }
  const environmentEntries = Object.entries(request.environment);
  if (environmentEntries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new LifecycleError("environment has too many entries");
  }
  for (const [key, value] of environmentEntries) {
    if (
      key.length === 0 ||
      key.includes("=") ||
      key.includes("\0") ||
      value.includes("\0") ||
      Buffer.byteLength(key, "utf8") > MAX_ENVIRONMENT_KEY_BYTES ||
      Buffer.byteLength(value, "utf8") > MAX_ENVIRONMENT_VALUE_BYTES
    ) {
      throw new LifecycleError(
        "environment must be a bounded key-value record",
      );
    }
  }
}

function freezeResult(
  result: PrReviewProcessLifecycleResult,
): PrReviewProcessLifecycleResult {
  return Object.freeze({
    ...result,
    rootProcess: Object.freeze(result.rootProcess),
    channels: Object.freeze(result.channels),
    output: Object.freeze(result.output),
    cooperative: Object.freeze(result.cooperative),
    cleanup: Object.freeze(result.cleanup),
  });
}
