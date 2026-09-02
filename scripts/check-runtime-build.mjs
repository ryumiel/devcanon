import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { produceProvider, verifySourceProvider } = await import(
  path.join(repositoryRoot, "dist/runtime-build/producer.js")
);
const { verifyProvider } = await import(
  path.join(repositoryRoot, "dist/runtime-build/provider.js")
);
const { reconcileDevcanonRuntimeSubtree } = await import(
  path.join(repositoryRoot, "dist/render/devcanon-runtime.js")
);

const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const mode = process.argv[2];

if (mode === "--build-source") {
  const provider = await produceProvider({
    repositoryRoot,
    origin: "source-build",
    devcanonVersion: version,
  });
  await reconcileDevcanonRuntimeSubtree(
    path.join(repositoryRoot, "skills", "devcanon-runtime"),
    provider,
  );
} else if (mode === "--build-package") {
  await produceProvider({
    repositoryRoot,
    origin: "package",
    devcanonVersion: version,
  });
} else if (mode === undefined) {
  const provider = await verifySourceProvider({
    repositoryRoot,
    root: path.join(repositoryRoot, "dist", "devcanon-runtime", "source-build"),
    devcanonVersion: version,
  });
  await verifyRuntimeSibling(provider);
} else {
  throw new Error(
    "usage: check-runtime-build.mjs [--build-source|--build-package]",
  );
}

async function verifyRuntimeSibling(provider) {
  const root = path.join(
    repositoryRoot,
    "skills",
    "devcanon-runtime",
    "scripts",
    "runtime",
  );
  const sibling = await verifyProvider({
    root,
    origin: "source-build",
    devcanonVersion: version,
    inputSha256: provider.manifest.input_sha256,
  });
  for (const [actual, expected] of [
    [sibling.bundle.copy(), provider.bundle.copy()],
    [sibling.manifestBytes.copy(), provider.manifestBytes.copy()],
    [sibling.licenses.copy(), provider.licenses.copy()],
  ]) {
    if (!actual.equals(expected))
      throw new Error(
        "source runtime sibling does not match accepted provider",
      );
  }
}
