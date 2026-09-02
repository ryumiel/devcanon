export interface PackedFile {
  path: string;
}

export interface PackedTarball {
  filename: string;
  files: PackedFile[];
}

export function parseNpmPackInventory(
  stdout: string,
  packageName: string,
): PackedTarball {
  const document = parseFinalInventoryDocument(stdout);
  const tarball = Array.isArray(document)
    ? document[0]
    : isRecord(document)
      ? document[packageName]
      : undefined;
  if (
    !isRecord(tarball) ||
    typeof tarball.filename !== "string" ||
    tarball.filename.length === 0 ||
    !Array.isArray(tarball.files) ||
    !tarball.files.every(
      (file) =>
        isRecord(file) && typeof file.path === "string" && file.path.length > 0,
    )
  ) {
    throw new Error(
      `npm pack returned an invalid inventory for ${JSON.stringify(packageName)}. stdout:\n${stdout}`,
    );
  }
  return tarball as unknown as PackedTarball;
}

function parseFinalInventoryDocument(stdout: string): unknown {
  const documentStarts: number[] = [];
  for (let index = 0; index < stdout.length; index += 1) {
    if (
      (index === 0 || stdout[index - 1] === "\n") &&
      (stdout[index] === "[" || stdout[index] === "{")
    ) {
      documentStarts.push(index);
    }
  }
  for (const start of documentStarts.reverse()) {
    try {
      return JSON.parse(stdout.slice(start).trimEnd()) as unknown;
    } catch {
      // Lifecycle output can contain earlier JSON-looking lines; only the final
      // complete npm inventory document is accepted.
    }
  }
  throw new Error(
    `npm pack returned no final JSON inventory. stdout:\n${stdout}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
