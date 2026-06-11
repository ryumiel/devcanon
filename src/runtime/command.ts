import {
  RuntimePathError,
  type RuntimePathPlatform,
  normalizeRuntimePath,
  requireDirectEphemeralChild,
} from "./paths.js";
import { runPrReviewLeasesCommand } from "./pr-review-leases.js";
import { runPrReviewManifestsCommand } from "./pr-review-manifests.js";
import { runReviewArtifactsCommand } from "./review-artifacts.js";

export const RUNTIME_COMMAND_CONTRACT = {
  command_group: "devcanon-runtime",
  major_version: 1,
  helper_foundation: true,
} as const;

export type RuntimeCommandOutcome =
  | { exitCode: 0; stdout: string; stderr: string }
  | { exitCode: 1; stdout: string; stderr: string };

export async function runRuntimeCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  try {
    const [command, ...rest] = args;
    switch (command) {
      case "contract":
        requireNoArgs(command, rest);
        return ok(RUNTIME_COMMAND_CONTRACT);
      case "path-info":
        return ok(pathInfo(rest));
      case "ephemeral-child":
        return ok(ephemeralChild(rest));
      case "validate-json":
        return validateJson(rest);
      case "review-artifacts":
        return await runReviewArtifactsCommand(rest);
      case "pr-review-manifests":
        return await runPrReviewManifestsCommand(rest);
      case "pr-review-leases":
        return await runPrReviewLeasesCommand(rest);
      default:
        return fail(
          "unknown-command",
          `unknown devcanon-runtime command: ${command ?? "<missing>"}`,
        );
    }
  } catch (err) {
    if (err instanceof RuntimePathError) {
      return fail(err.problem, err.message);
    }
    return fail("runtime-error", (err as Error).message);
  }
}

function pathInfo(args: readonly string[]) {
  const pathValue = requiredOption(args, "--path");
  const platform = optionalPlatform(args);
  return normalizeRuntimePath(pathValue, platform);
}

function ephemeralChild(args: readonly string[]) {
  return requireDirectEphemeralChild(requiredOption(args, "--path"));
}

function validateJson(args: readonly string[]): RuntimeCommandOutcome {
  const payload = requiredOption(args, "--payload");
  const schemaName = requiredOption(args, "--schema");
  if (schemaName !== "command-envelope") {
    throw new Error(`unknown schema: ${schemaName}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return fail("invalid-json", "payload must be valid JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("command" in parsed) ||
    typeof parsed.command !== "string" ||
    parsed.command.length === 0
  ) {
    return fail("invalid-command-envelope", "command is required");
  }
  return ok({ ok: true, value: parsed });
}

function requiredOption(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
}

function optionalOption(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
}

function optionalPlatform(
  args: readonly string[],
): RuntimePathPlatform | undefined {
  const platform = optionalOption(args, "--platform");
  if (platform === undefined || platform === "posix" || platform === "win32") {
    return platform;
  }
  throw new Error(`unknown platform: ${platform}`);
}

function requireNoArgs(command: string, args: readonly string[]) {
  if (args.length > 0) {
    throw new Error(`${command} does not accept arguments`);
  }
}

function ok(payload: unknown): RuntimeCommandOutcome {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(payload)}\n`,
    stderr: "",
  };
}

function fail(code: string, message: string): RuntimeCommandOutcome {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${JSON.stringify({ ok: false, code, message })}\n`,
  };
}
