import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProtocolDecoder,
  frameProtocolMessage,
} from "./pr-review-process-protocol.js";
import {
  type PathIdentity,
  assertNativeAbsolutePath,
  enrollExecutable,
  enrollPathIdentity,
  enrollWorkingDirectory,
} from "./pr-review-root-identity.js";

const GENERATED_ROOT_MARKER = ".devcanon-pr-review-generated-root";
const GENERATED_ROOT_REMOVAL_MAX_RETRIES = 3;
const GENERATED_ROOT_REMOVAL_RETRY_DELAY_MS = 100;
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
const MAX_FAILURE_EVIDENCE = 16;
const MAX_FAILURE_EVIDENCE_BYTES = 128;
const MAX_FINAL_RECEIPT_BYTES =
  MAX_OUTPUT_LIMIT_BYTES * 12 +
  MAX_FAILURE_EVIDENCE * MAX_FAILURE_EVIDENCE_BYTES +
  16_384;

export const PR_REVIEW_PROCESS_LIFECYCLE_LIMITS = Object.freeze({
  minDeadlineMs: MIN_DEADLINE_MS,
  maxDeadlineMs: MAX_DEADLINE_MS,
  minOutputLimitBytes: MIN_OUTPUT_LIMIT_BYTES,
  maxOutputLimitBytes: MAX_OUTPUT_LIMIT_BYTES,
  maxArguments: MAX_ARGUMENTS,
  maxArgumentBytes: MAX_ARGUMENT_BYTES,
  maxEnvironmentEntries: MAX_ENVIRONMENT_ENTRIES,
  maxEnvironmentKeyBytes: MAX_ENVIRONMENT_KEY_BYTES,
  maxEnvironmentValueBytes: MAX_ENVIRONMENT_VALUE_BYTES,
  maxRedactionValues: MAX_REDACTION_VALUES,
  maxRedactionValueBytes: MAX_REDACTION_VALUE_BYTES,
  maxFailureEvidence: MAX_FAILURE_EVIDENCE,
  maxFailureEvidenceBytes: MAX_FAILURE_EVIDENCE_BYTES,
  maxFinalReceiptBytes: MAX_FINAL_RECEIPT_BYTES,
});

export interface PrReviewProcessGeneratedRoot {
  readonly path: string;
}

export interface PrReviewProcessLifecycleRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  generatedRoot: PrReviewProcessGeneratedRoot;
  environment: Readonly<Record<string, string>>;
  deadlineMs: number;
  outputLimitBytes: number;
  redact?: readonly string[];
}

export interface OutputEvidence {
  readonly bytes: number;
  readonly digest: string;
  readonly overflowed: boolean;
  readonly text: string;
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
  readonly evidence: readonly string[];
  readonly restoration: "restored" | "failed";
  readonly generatedRoot: "removed" | "preserved_unsafe";
}

export interface PrReviewProcessLifecycle {
  finish(options?: {
    cancel?: boolean;
    cooperativeGraceMs?: number;
  }): Promise<PrReviewProcessLifecycleResult>;
}

export class PrReviewProcessFailureEvidence {
  readonly #values: string[] = [];

  constructor(private readonly redactions: readonly string[]) {}

  record(value: string): void {
    if (this.#values.length >= MAX_FAILURE_EVIDENCE) return;
    this.#values.push(
      truncateUtf8(
        redactText(value, this.redactions),
        MAX_FAILURE_EVIDENCE_BYTES,
      ),
    );
  }

  snapshot(): readonly string[] {
    return Object.freeze([...this.#values]);
  }
}

export class PrReviewProcessObservationGate {
  #frozen = false;

  observe(update: () => void): void {
    if (!this.#frozen) update();
  }

  freeze(): void {
    this.#frozen = true;
  }

  get frozen(): boolean {
    return this.#frozen;
  }
}

export function assertPrReviewProcessFinalReceiptBytes(
  serializedReceipt: string,
): void {
  if (Buffer.byteLength(serializedReceipt, "utf8") > MAX_FINAL_RECEIPT_BYTES)
    throw new LifecycleError("final receipt exceeded its bounded size");
}

type RootIdentity = PathIdentity & {
  type: "directory";
  birthtimeNs: bigint;
};
type GeneratedRootEnrollment = {
  readonly root: PathIdentity & { type: "directory" };
  readonly marker: string;
};
type FrozenRequest = Readonly<{
  executable: string;
  args: readonly string[];
  cwd: string;
  generatedRoot: GeneratedRootEnrollment;
  environment: Readonly<Record<string, string>>;
  deadlineMs: number;
  outputLimitBytes: number;
  redact: readonly string[];
}>;

const generatedRoots = new WeakMap<object, GeneratedRootEnrollment>();

class LifecycleError extends Error {
  constructor(message: string) {
    super(`Invalid PR-review process lifecycle: ${message}`);
    this.name = "LifecycleError";
  }
}

/** Creates the only cleanup authority; caller-supplied paths never authorize deletion. */
export async function createPrReviewProcessGeneratedRoot(): Promise<PrReviewProcessGeneratedRoot> {
  const logical = await mkdtemp(
    path.join(os.tmpdir(), "dc-process-lifecycle-"),
  );
  const marker = `${randomUUID()}\n`;
  await writeFile(path.join(logical, GENERATED_ROOT_MARKER), marker, {
    flag: "wx",
  });
  const root = await enrollPathIdentity(logical, "directory");
  const enrolled = Object.freeze({ path: logical });
  generatedRoots.set(enrolled, Object.freeze({ root, marker }));
  return enrolled;
}

class BoundedOutput {
  readonly #hash = createHash("sha256");
  readonly #chunks: Buffer[] = [];
  readonly #redactions: readonly Buffer[];
  #pending = Buffer.alloc(0);
  #bytes = 0;
  #retained = 0;

  constructor(
    private readonly limit: number,
    redactions: readonly string[],
  ) {
    this.#redactions = redactions
      .map((value) => Buffer.from(value, "utf8"))
      .sort((left, right) => right.length - left.length);
  }

  push(chunk: Buffer): void {
    this.#bytes += chunk.length;
    this.#hash.update(chunk);
    this.#pending = Buffer.concat([this.#pending, chunk]);
    this.#drain(false);
  }

  snapshot(): OutputEvidence {
    this.#drain(true);
    let text = Buffer.concat(this.#chunks).toString("utf8");
    while (Buffer.byteLength(text, "utf8") > this.limit)
      text = text.slice(0, -1);
    return Object.freeze({
      bytes: this.#bytes,
      digest: this.#hash.copy().digest("hex"),
      overflowed: this.#bytes > this.limit,
      text,
    });
  }

  #drain(final: boolean): void {
    while (this.#pending.length > 0) {
      const unfinished = this.#redactions.some(
        (value) =>
          this.#pending.length < value.length &&
          value.subarray(0, this.#pending.length).equals(this.#pending),
      );
      if (unfinished) {
        if (!final) return;
        this.#append(Buffer.from("[REDACTED]"));
        this.#pending = Buffer.alloc(0);
        continue;
      }
      const match = this.#redactions.find((value) =>
        this.#pending.subarray(0, value.length).equals(value),
      );
      if (match) {
        this.#append(Buffer.from("[REDACTED]"));
        this.#pending = this.#pending.subarray(match.length);
        continue;
      }
      this.#append(this.#pending.subarray(0, 1));
      this.#pending = this.#pending.subarray(1);
    }
  }

  #append(value: Buffer): void {
    const available = this.limit - this.#retained;
    if (available <= 0) return;
    const retained = value.subarray(0, available);
    this.#chunks.push(Buffer.from(retained));
    this.#retained += retained.length;
  }
}

export async function launchPrReviewProcessLifecycle(
  request: PrReviewProcessLifecycleRequest,
): Promise<PrReviewProcessLifecycle> {
  const frozen = snapshotRequest(request);
  const executable = await enrollExecutable(frozen.executable);
  const cwd = await enrollWorkingDirectory(
    frozen.generatedRoot.root,
    frozen.cwd,
  );
  const initialRoot = await readGeneratedRootEvidence(frozen.generatedRoot);
  const initialCwd = process.cwd();
  const initialCwdPhysical = await realpath(initialCwd);
  const deadline = performance.now() + frozen.deadlineMs;
  let child: ChildProcess;
  try {
    if (deadline - performance.now() <= 0)
      throw new LifecycleError("deadline expired before spawn");
    child = spawn(executable.identity.physical, frozen.args, {
      cwd: cwd.identity.physical,
      env: frozen.environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    return new FailedLaunchLifecycle(
      error,
      frozen,
      initialCwd,
      initialCwdPhysical,
    );
  }
  return new RootLifecycle(
    child,
    deadline,
    frozen,
    initialRoot,
    initialCwd,
    initialCwdPhysical,
  );
}

class FailedLaunchLifecycle implements PrReviewProcessLifecycle {
  #finishing: Promise<PrReviewProcessLifecycleResult> | undefined;

  constructor(
    private readonly error: unknown,
    private readonly request: FrozenRequest,
    private readonly initialCwd: string,
    private readonly initialCwdPhysical: string,
  ) {}

  finish(
    options: { cancel?: boolean; cooperativeGraceMs?: number } = {},
  ): Promise<PrReviewProcessLifecycleResult> {
    if (!this.#finishing) {
      snapshotFinishOptions(options);
      this.#finishing = this.#finalize();
    }
    return this.#finishing;
  }

  async #finalize(): Promise<PrReviewProcessLifecycleResult> {
    const evidence = new PrReviewProcessFailureEvidence(this.request.redact);
    evidence.record(`spawn:${errorName(this.error)}`);
    let restoration: "restored" | "failed" = "restored";
    try {
      if (process.cwd() !== this.initialCwd) process.chdir(this.initialCwd);
      if ((await realpath(process.cwd())) !== this.initialCwdPhysical) {
        restoration = "failed";
        evidence.record("restore:identity-mismatch");
      }
    } catch (error) {
      restoration = "failed";
      evidence.record(`restore:${errorName(error)}`);
    }
    evidence.record("rm:spawn-not-observed");
    const stdout = new BoundedOutput(
      this.request.outputLimitBytes,
      this.request.redact,
    );
    const stderr = new BoundedOutput(
      this.request.outputLimitBytes,
      this.request.redact,
    );
    return freezeResult({
      rootProcess: {
        spawned: false,
        exitObserved: false,
        closeObserved: false,
        signal: null,
        exitCode: null,
      },
      channels: {
        stdoutClosed: false,
        stderrClosed: false,
        controlClosed: false,
      },
      output: {
        stdout: stdout.snapshot(),
        stderr: stderr.snapshot(),
      },
      cooperative: {
        requested: false,
        descendantsAcknowledged: "unknown",
      },
      cleanup: { forceTermination: "not-needed" },
      evidence: evidence.snapshot(),
      restoration,
      generatedRoot: "preserved_unsafe",
    });
  }
}

class RootLifecycle implements PrReviewProcessLifecycle {
  readonly #stdout: BoundedOutput;
  readonly #stderr: BoundedOutput;
  readonly #decoder = new ProtocolDecoder();
  readonly #close: Promise<void>;
  readonly #evidence: PrReviewProcessFailureEvidence;
  readonly #observations = new PrReviewProcessObservationGate();
  #spawned = false;
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
    private readonly request: FrozenRequest,
    private readonly generatedRoot: RootIdentity,
    private readonly initialCwd: string,
    private readonly initialCwdPhysical: string,
  ) {
    this.#stdout = new BoundedOutput(request.outputLimitBytes, request.redact);
    this.#stderr = new BoundedOutput(request.outputLimitBytes, request.redact);
    this.#evidence = new PrReviewProcessFailureEvidence(request.redact);
    this.#close = new Promise((resolve) => {
      child.once("close", () => {
        this.#observations.observe(() => {
          this.#closeObserved = true;
        });
        resolve();
      });
      child.once("error", () => resolve());
    });
    child.once("spawn", () => {
      this.#observations.observe(() => {
        this.#spawned = true;
      });
    });
    child.once("error", (error) => this.#record(`spawn:${errorName(error)}`));
    child.once("exit", (exitCode, signal) => {
      this.#observations.observe(() => {
        this.#exitObserved = true;
        this.#exitCode = exitCode;
        this.#signal = signal;
      });
    });
    this.#watchOutput(child.stdout, this.#stdout, "stdout", () => {
      this.#stdoutClosed = true;
    });
    this.#watchOutput(child.stderr, this.#stderr, "stderr", () => {
      this.#stderrClosed = true;
    });
    const control = child.stdio[3] as NodeJS.ReadWriteStream | null;
    control?.on("data", (chunk: Buffer) => this.#readControl(chunk));
    control?.once("error", (error) =>
      this.#record(`control:${errorName(error)}`),
    );
    control?.once("end", () => {
      this.#observations.observe(() => {
        this.#controlClosed = true;
        const decoded = this.#decoder.finish();
        if (decoded.status === "fatal")
          this.#record(`protocol:${errorName(decoded.error)}`);
      });
    });
  }

  finish(
    options: { cancel?: boolean; cooperativeGraceMs?: number } = {},
  ): Promise<PrReviewProcessLifecycleResult> {
    this.#finishing ??= this.#finalize(snapshotFinishOptions(options));
    return this.#finishing;
  }

  async #finalize(
    options: Readonly<{ cancel: boolean; cooperativeGraceMs: number }>,
  ): Promise<PrReviewProcessLifecycleResult> {
    let requested = false;
    let forceTermination: "not-needed" | "attempted" | "failed" = "not-needed";
    try {
      if (options.cancel) {
        requested = this.#requestCooperation();
        await this.#waitForClose(
          Math.min(this.#remaining(), options.cooperativeGraceMs),
        );
        if (!this.#closeObserved && this.#remaining() > 0) {
          try {
            if (this.child.kill()) forceTermination = "attempted";
            else {
              forceTermination = "failed";
              this.#record("kill:false");
            }
          } catch (error) {
            forceTermination = "failed";
            this.#record(`kill:${errorName(error)}`);
          }
        }
      }
      await this.#waitForClose(this.#remaining());
    } catch (error) {
      this.#record(`finalize:${errorName(error)}`);
    }
    const observations = this.#freezeObservations();
    let restoration: "restored" | "failed" = "restored";
    try {
      if (process.cwd() !== this.initialCwd) process.chdir(this.initialCwd);
      if ((await realpath(process.cwd())) !== this.initialCwdPhysical) {
        restoration = "failed";
        this.#recordDisposition("restore:identity-mismatch");
      }
    } catch (error) {
      restoration = "failed";
      this.#recordDisposition(`restore:${errorName(error)}`);
    }
    const rootDisposition =
      await this.#removeGeneratedRootWhenSafe(restoration);
    return freezeResult({
      rootProcess: observations.rootProcess,
      channels: observations.channels,
      output: observations.output,
      cooperative: {
        requested,
        descendantsAcknowledged: observations.descendantsAcknowledged,
      },
      cleanup: { forceTermination },
      evidence: this.#evidence.snapshot(),
      restoration,
      generatedRoot: rootDisposition,
    });
  }

  #watchOutput(
    stream: NodeJS.ReadableStream | null,
    output: BoundedOutput,
    name: "stdout" | "stderr",
    closed: () => void,
  ): void {
    stream?.on("data", (chunk: Buffer) => {
      this.#observations.observe(() => output.push(Buffer.from(chunk)));
    });
    stream?.once("error", (error) =>
      this.#record(`${name}:${errorName(error)}`),
    );
    stream?.once("end", () => {
      this.#observations.observe(closed);
    });
  }

  #requestCooperation(): boolean {
    const control = this.child.stdio[3] as NodeJS.ReadWriteStream | null;
    if (!control || !control.writable) {
      this.#record("write:unavailable");
      return false;
    }
    if (this.#remaining() <= 0) {
      this.#record("write:deadline");
      return false;
    }
    try {
      const message = new TextEncoder().encode(
        JSON.stringify({ type: "cancel", version: 1 }),
      );
      const accepted = control.write(frameProtocolMessage(message), (error) => {
        if (error) this.#record(`write:${errorName(error)}`);
      });
      if (!accepted) this.#record("write:backpressure");
      return true;
    } catch (error) {
      this.#record(`write:${errorName(error)}`);
      return false;
    }
  }

  #readControl(chunk: Buffer): void {
    this.#observations.observe(() => {
      const decoded = this.#decoder.push(chunk);
      for (const message of decoded.messages)
        if (message.type === "descendants_stopped")
          this.#descendantsAcknowledged = true;
      if (decoded.status === "fatal")
        this.#record(`protocol:${errorName(decoded.error)}`);
    });
  }

  async #waitForClose(waitMs: number): Promise<void> {
    if (this.#closeObserved || waitMs <= 0) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.#close,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #remaining(): number {
    return Math.max(0, this.deadline - performance.now());
  }

  #record(value: string): void {
    this.#observations.observe(() => this.#evidence.record(value));
  }

  #recordDisposition(value: string): void {
    this.#evidence.record(value);
  }

  #freezeObservations(): Readonly<{
    rootProcess: PrReviewProcessLifecycleResult["rootProcess"];
    channels: PrReviewProcessLifecycleResult["channels"];
    output: PrReviewProcessLifecycleResult["output"];
    descendantsAcknowledged: boolean | "unknown";
  }> {
    this.#observations.freeze();
    return Object.freeze({
      rootProcess: Object.freeze({
        spawned: this.#spawned,
        exitObserved: this.#exitObserved,
        closeObserved: this.#closeObserved,
        signal: this.#signal,
        exitCode: this.#exitCode,
      }),
      channels: Object.freeze({
        stdoutClosed: this.#stdoutClosed,
        stderrClosed: this.#stderrClosed,
        controlClosed: this.#controlClosed,
      }),
      output: Object.freeze({
        stdout: this.#stdout.snapshot(),
        stderr: this.#stderr.snapshot(),
      }),
      descendantsAcknowledged: this.#descendantsAcknowledged ? true : "unknown",
    });
  }

  async #removeGeneratedRootWhenSafe(
    restoration: "restored" | "failed",
  ): Promise<"removed" | "preserved_unsafe"> {
    if (restoration !== "restored") {
      this.#recordDisposition("rm:restoration-failed");
      return "preserved_unsafe";
    }
    if (!this.#spawned) {
      this.#recordDisposition("rm:spawn-not-observed");
      return "preserved_unsafe";
    }
    if (!this.#closeObserved) {
      this.#recordDisposition("rm:close-not-observed");
      return "preserved_unsafe";
    }
    if (this.#remaining() <= 0) {
      this.#recordDisposition("rm:deadline");
      return "preserved_unsafe";
    }
    if (
      isControllerCwdOrAncestor(this.generatedRoot.physical, this.initialCwd)
    ) {
      this.#recordDisposition("rm:controller-cwd-or-ancestor");
      return "preserved_unsafe";
    }
    for (
      let attempt = 0;
      attempt <= GENERATED_ROOT_REMOVAL_MAX_RETRIES;
      attempt += 1
    ) {
      try {
        const liveCwd = await realpath(process.cwd());
        if (isControllerCwdOrAncestor(this.generatedRoot.physical, liveCwd)) {
          this.#recordDisposition("rm:live-cwd-or-ancestor");
          return "preserved_unsafe";
        }
        const retryEvidence =
          attempt === 0
            ? undefined
            : await readGeneratedRootRetryEvidence(this.request.generatedRoot);
        const current =
          retryEvidence?.root ??
          (await readGeneratedRootEvidence(this.request.generatedRoot));
        const matchesIdentity =
          retryEvidence?.markerPresent === false
            ? sameRetryIdentity(this.generatedRoot, current)
            : sameIdentity(this.generatedRoot, current);
        if (!matchesIdentity) {
          this.#recordDisposition("rm:identity-mismatch");
          return "preserved_unsafe";
        }
        if (this.#remaining() <= 0) {
          this.#recordDisposition("rm:deadline-after-revalidation");
          return "preserved_unsafe";
        }
      } catch (error) {
        this.#recordDisposition(`rm:${errorName(error)}`);
        return "preserved_unsafe";
      }
      try {
        await rm(this.generatedRoot.logical, {
          force: false,
          recursive: true,
        });
        return "removed";
      } catch (error) {
        if (
          attempt === GENERATED_ROOT_REMOVAL_MAX_RETRIES ||
          !isGeneratedRootRemovalRetryable(error)
        ) {
          this.#recordDisposition(`rm:${errorName(error)}`);
          return "preserved_unsafe";
        }
        const delay = Math.min(
          this.#remaining(),
          GENERATED_ROOT_REMOVAL_RETRY_DELAY_MS * (attempt + 1),
        );
        if (delay <= 0) {
          this.#recordDisposition("rm:deadline-after-revalidation");
          return "preserved_unsafe";
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    this.#recordDisposition("rm:retries-exhausted");
    return "preserved_unsafe";
  }
}

function snapshotRequest(
  request: PrReviewProcessLifecycleRequest,
): FrozenRequest {
  if (!request || typeof request !== "object")
    throw new LifecycleError("request must be an object");
  const generatedRoot = generatedRoots.get(request.generatedRoot as object);
  if (!generatedRoot)
    throw new LifecycleError(
      "generated root must be helper-created enrollment",
    );
  assertNativeAbsolutePath(request.executable);
  assertNativeAbsolutePath(request.cwd);
  if (
    !Number.isInteger(request.deadlineMs) ||
    request.deadlineMs < MIN_DEADLINE_MS ||
    request.deadlineMs > MAX_DEADLINE_MS
  )
    throw new LifecycleError("deadline must be a finite bounded integer");
  if (
    !Number.isInteger(request.outputLimitBytes) ||
    request.outputLimitBytes < MIN_OUTPUT_LIMIT_BYTES ||
    request.outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES
  )
    throw new LifecycleError("output limit must be a finite bounded integer");
  if (
    !Array.isArray(request.args) ||
    request.args.length > MAX_ARGUMENTS ||
    request.args.some(
      (value) =>
        typeof value !== "string" ||
        value.includes("\0") ||
        Buffer.byteLength(value, "utf8") > MAX_ARGUMENT_BYTES,
    )
  )
    throw new LifecycleError("arguments must be NUL-free strings");
  const redact = request.redact === undefined ? [] : [...request.redact];
  if (
    redact.length > MAX_REDACTION_VALUES ||
    redact.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        Buffer.byteLength(value, "utf8") > MAX_REDACTION_VALUE_BYTES,
    )
  )
    throw new LifecycleError("redactions must be bounded non-empty strings");
  const environmentEntries = Object.entries(request.environment);
  if (
    environmentEntries.length > MAX_ENVIRONMENT_ENTRIES ||
    environmentEntries.some(
      ([key, value]) =>
        key.length === 0 ||
        key.includes("=") ||
        key.includes("\0") ||
        typeof value !== "string" ||
        value.includes("\0") ||
        Buffer.byteLength(key, "utf8") > MAX_ENVIRONMENT_KEY_BYTES ||
        Buffer.byteLength(value, "utf8") > MAX_ENVIRONMENT_VALUE_BYTES,
    )
  )
    throw new LifecycleError("environment must be a bounded key-value record");
  return Object.freeze({
    executable: request.executable,
    args: Object.freeze([...request.args]),
    cwd: request.cwd,
    generatedRoot,
    environment: Object.freeze(Object.fromEntries(environmentEntries)),
    deadlineMs: request.deadlineMs,
    outputLimitBytes: request.outputLimitBytes,
    redact: Object.freeze(redact),
  });
}

function snapshotFinishOptions(options: {
  cancel?: boolean;
  cooperativeGraceMs?: number;
}): Readonly<{ cancel: boolean; cooperativeGraceMs: number }> {
  const cooperativeGraceMs = options.cooperativeGraceMs ?? 25;
  if (
    !Number.isInteger(cooperativeGraceMs) ||
    cooperativeGraceMs < 0 ||
    cooperativeGraceMs > MAX_DEADLINE_MS
  )
    throw new LifecycleError("cooperative grace must be a bounded integer");
  return Object.freeze({ cancel: options.cancel === true, cooperativeGraceMs });
}

async function readGeneratedRootEvidence(
  enrollment: GeneratedRootEnrollment,
): Promise<RootIdentity> {
  const root = await readGeneratedRootIdentity(enrollment);
  await assertGeneratedRootMarker(enrollment, root);
  return root;
}

async function readGeneratedRootRetryEvidence(
  enrollment: GeneratedRootEnrollment,
): Promise<{ readonly root: RootIdentity; readonly markerPresent: boolean }> {
  const root = await readGeneratedRootIdentity(enrollment);
  try {
    await assertGeneratedRootMarker(enrollment, root);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return { root, markerPresent: false };
  }
  return { root, markerPresent: true };
}

async function assertGeneratedRootMarker(
  enrollment: GeneratedRootEnrollment,
  root: RootIdentity,
): Promise<void> {
  const marker = await lstat(path.join(root.logical, GENERATED_ROOT_MARKER));
  if (
    !marker.isFile() ||
    marker.isSymbolicLink() ||
    (await readFile(path.join(root.logical, GENERATED_ROOT_MARKER), "utf8")) !==
      enrollment.marker
  )
    throw new LifecycleError("generated root marker is unsafe");
}

async function readGeneratedRootIdentity(
  enrollment: GeneratedRootEnrollment,
): Promise<RootIdentity> {
  const root = enrollment.root;
  const direct = await lstat(root.logical, { bigint: true });
  if (!direct.isDirectory() || direct.isSymbolicLink())
    throw new LifecycleError("generated root is not a direct directory");
  const followed = await stat(root.logical, { bigint: true });
  if (
    !followed.isDirectory() ||
    direct.dev < 0n ||
    direct.ino < 0n ||
    direct.birthtimeNs < 0n ||
    direct.dev !== followed.dev ||
    direct.ino !== followed.ino ||
    direct.birthtimeNs !== followed.birthtimeNs
  )
    throw new LifecycleError("generated root identity is ambiguous");
  if ((await realpath(root.logical)) !== root.physical)
    throw new LifecycleError("generated root physical path changed");
  return {
    ...root,
    device: direct.dev,
    file: direct.ino,
    birthtimeNs: direct.birthtimeNs,
  };
}

function sameIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return left.device === right.device && left.file === right.file;
}

function sameRetryIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return (
    left.birthtimeNs !== 0n &&
    right.birthtimeNs !== 0n &&
    sameIdentity(left, right) &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function isGeneratedRootRemovalRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].includes(
    String(error.code),
  );
}
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  return String(error.code);
}
function isControllerCwdOrAncestor(
  root: string,
  controllerCwd: string,
): boolean {
  const relative = path.relative(root, controllerCwd);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
}
function redactText(value: string, enrolled: readonly string[]): string {
  const redactions = [...enrolled].sort(
    (left, right) =>
      Buffer.byteLength(right, "utf8") - Buffer.byteLength(left, "utf8"),
  );
  let result = "";
  for (let offset = 0; offset < value.length; ) {
    const match = redactions.find((redaction) =>
      value.startsWith(redaction, offset),
    );
    if (match) {
      result += "[REDACTED]";
      offset += match.length;
      continue;
    }
    const suffix = value.slice(offset);
    if (redactions.some((redaction) => redaction.startsWith(suffix))) {
      result += "[REDACTED]";
      break;
    }
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    result += character;
    offset += character.length;
  }
  return result;
}
function truncateUtf8(value: string, limit: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (bytes + next > limit) break;
    result += character;
    bytes += next;
  }
  return result;
}
function freezeResult(
  result: PrReviewProcessLifecycleResult,
): PrReviewProcessLifecycleResult {
  const frozen = Object.freeze({
    ...result,
    rootProcess: Object.freeze(result.rootProcess),
    channels: Object.freeze(result.channels),
    output: Object.freeze(result.output),
    cooperative: Object.freeze(result.cooperative),
    cleanup: Object.freeze(result.cleanup),
    evidence: Object.freeze([...result.evidence]),
  });
  assertPrReviewProcessFinalReceiptBytes(JSON.stringify(frozen));
  return frozen;
}
