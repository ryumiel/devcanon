import { UserError } from "../utils/errors.js";
import { getLogger } from "../utils/output.js";
import {
  type LoadedManifest,
  type ManifestInspection,
  type ManifestRecoveryResult,
  inspectManifest,
  recoverInvalidManifest,
} from "./manifest.js";

type RecoveryCommand = "sync" | "uninstall";

export async function loadInspectedManifest(
  manifestPath: string,
  inspection: ManifestInspection,
  command: RecoveryCommand,
  dryRun: boolean,
): Promise<LoadedManifest> {
  if (inspection.status !== "invalid") {
    return { manifest: inspection.manifest, snapshot: inspection.snapshot };
  }
  if (dryRun) {
    throw invalidDryManifestError(inspection, manifestPath, command);
  }

  const recovery = await recoverInvalidManifest(inspection);
  if (!recovery.completed) {
    const cause = recoveryCauseMessage(recovery.cause);
    const error = new UserError(
      `Manifest recovery did not complete (${recovery.category}; cleanup ${recovery.cleanup}).${cause ? ` Primary cause: ${cause}` : ""}`,
      manifestPath,
      unrecoveredManifestHint(recovery, command),
    );
    Object.defineProperty(error, "cause", { value: recovery.cause });
    throw error;
  }

  if (recovery.cleanup !== "clean") {
    getLogger().warn(
      `Manifest recovery committed to verified backup ${recovery.backupPath}, but cleanup degraded (${recovery.cleanup}).`,
    );
    throw new UserError(
      `Manifest recovery committed to ${recovery.backupPath}, but cleanup was ${recovery.cleanup}.`,
      manifestPath,
      `Resolve the recovery lock state before retrying ${command}.`,
    );
  }
  getLogger().warn(
    `Recovered invalid manifest to verified backup ${recovery.backupPath}.`,
  );

  const afterRecovery = await inspectManifest(manifestPath);
  if (afterRecovery.status !== "absent") {
    throw new UserError(
      "Manifest state changed after invalid recovery completed.",
      manifestPath,
      `Inspect the current manifest state before retrying ${command}.`,
    );
  }
  return {
    manifest: afterRecovery.manifest,
    snapshot: afterRecovery.snapshot,
  };
}

function recoveryCauseMessage(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const message = cause.message.replaceAll(/\s+/g, " ").trim();
  return message || undefined;
}

function unrecoveredManifestHint(
  recovery: Extract<ManifestRecoveryResult, { completed: false }>,
  command: RecoveryCommand,
): string {
  const actions: string[] = [];
  switch (recovery.candidate.status) {
    case "retained-unverifiable":
      actions.push(
        `Inspect and preserve the unverifiable recovery candidate at ${recovery.candidate.path}; do not remove it by pathname alone.`,
      );
      break;
    case "retained-owned":
      actions.push(
        `Inspect the retained owned recovery candidate at ${recovery.candidate.path} before any manual removal.`,
      );
      break;
    case "retained-replacement":
      actions.push(
        `Preserve and inspect the unmanaged replacement at ${recovery.candidate.path}; it is not owned by recovery and must not be auto-deleted.`,
      );
      break;
    case "none-created":
    case "owned-removed":
      break;
  }
  switch (recovery.lock.status) {
    case "pre-existing-blocker":
      actions.push(
        `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${recovery.lock.path}.`,
      );
      break;
    case "retained-owned":
      actions.push(
        `Confirm no DevCanon manifest operation is active, then manually remove or correct the retained owned recovery lock at ${recovery.lock.path}.`,
      );
      break;
    case "not-inspected-or-not-owned":
    case "owned-removed":
      break;
  }
  return actions.length > 0
    ? actions.join(" ")
    : `Resolve the reported manifest state before retrying ${command}.`;
}

export function invalidDryManifestError(
  inspection: Extract<ManifestInspection, { status: "invalid" }>,
  manifestPath: string,
  command: RecoveryCommand,
): UserError {
  return new UserError(
    inspection.message,
    manifestPath,
    dryInvalidManifestHint(inspection.message, manifestPath, command),
  );
}

function dryInvalidManifestHint(
  message: string,
  manifestPath: string,
  command: RecoveryCommand,
): string {
  if (
    message === "Manifest is invalid: corrupt JSON" ||
    message === "Manifest is invalid: schema validation failed"
  ) {
    return `Recover the byte-backed invalid manifest with an explicit non-dry ${command} before retrying.`;
  }
  if (message.includes("sibling lock")) {
    return `Confirm no DevCanon manifest operation is active, then manually correct the exact sibling lock for ${manifestPath} before retrying.`;
  }
  return `Restore ${manifestPath} as a readable regular file, or manually remove the unsafe source after verifying its custody, before retrying.`;
}
