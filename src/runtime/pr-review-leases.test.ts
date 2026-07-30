import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm as removePath,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrReviewCommandHarness } from "../__test-helpers__/pr-review-command-harness.js";
import * as artifacts from "./artifacts.js";
import { runPlayReviewSharedContextCommand as runPlayReviewSharedContextRuntimeCommand } from "./play-review-shared-context.js";
import {
  type PrReviewLease,
  reducePrReviewLease,
  runPrReviewLeasesCommand as runPrReviewLeasesRuntimeCommand,
} from "./pr-review-leases.js";

async function resolveGitForWindowsBash(): Promise<string> {
  const { stdout } = await execFileAsync("where.exe", ["git.exe"]);
  const candidates = new Set<string>();
  for (const gitExecutable of stdout
    .split(/\r?\n/gu)
    .filter((entry) => path.win32.isAbsolute(entry))) {
    const gitDirectory = path.win32.dirname(gitExecutable);
    candidates.add(path.win32.resolve(gitDirectory, "..", "bin", "bash.exe"));
    candidates.add(
      path.win32.resolve(gitDirectory, "..", "usr", "bin", "bash.exe"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (!(await lstat(candidate)).isFile()) continue;
      await execFileAsync(candidate, [
        "-lc",
        "builtin pwd -W >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1",
      ]);
      return await realpath(candidate);
    } catch {}
  }
  throw new Error("Git-for-Windows Bash is unavailable");
}

const identity = {
  repository: "owner/repo",
  prNumber: 432,
  worktreePath: "/tmp/review-worktree",
  worktreeDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  leaseFile:
    ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
};
const resultDigest =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const refreshedResultDigest =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const originalCwd = process.cwd();
const managedEnvKeys = [
  "REPOSITORY",
  "PR_NUMBER",
  "PRIMARY_REPOSITORY_ROOT",
  "WORKTREE_PATH",
  "LEASE_FILE",
  "HANDOFF_FILE",
  "RESULT_FILE",
  "FINDINGS_FILE",
  "HEAD_SHA",
  "REVIEW_CONTEXT_INPUT_FILE",
  "REVIEW_CONTEXT_INPUT_JSON",
  "STATE",
  "BASE_REF",
  "HEAD_REF",
  "CREATED_AT",
  "UPDATED_AT",
  "PRESENTED_AT",
  "PRESENTATION_STATUS",
  "FINISHED_AT",
  "TERMINAL_REASON",
  "FAILURE_PHASE",
  "FAILURE_REASON",
  "FAILURE_RECOVERABILITY",
  "GITHUB_POST_ATTEMPTED",
  "GITHUB_POST_RESULT",
  "GITHUB_POSTED_AT",
  "APPROVED_REVIEW_FILE",
  "VALIDATED_REVIEW_PAYLOAD_FILE",
  "VALIDATED_PAYLOAD_FILE",
  "EXPECTED_STATE",
  "ALLOW_POLICY_OVERRIDE",
  "PR_REVIEW_DIR",
  "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
  "PR_REVIEW_LEASE_HELPER_SCRIPT",
  "PLAY_REVIEW_HELPER",
  "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
  "DEVCANON_RUNTIME_DIR",
  "GIT_TRACE2_EVENT",
  "GIT_INDEX_FILE",
] as const;

const commandHarness = new PrReviewCommandHarness({
  envKeys: managedEnvKeys,
  seed: "review",
});
let sharedReviewHelpers: Awaited<
  ReturnType<typeof writeReviewHelperScripts>
> | null = null;

beforeAll(async () => {
  await commandHarness.setup();
  sharedReviewHelpers = await writeReviewHelperScripts(
    path.join(commandHarness.suiteRoot, "h"),
  );
});

beforeEach(() => {
  commandHarness.beginTest();
});

afterEach(async () => {
  await commandHarness.endTest();
});

afterAll(async () => {
  await commandHarness.dispose();
});

async function execFileAsync(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return commandHarness.run(command, args, options);
}

function rm(
  ...args: Parameters<typeof removePath>
): ReturnType<typeof removePath> {
  const [target] = args;
  if (
    typeof target === "string" &&
    commandHarness.ownsCaseRoot(path.resolve(target))
  ) {
    return Promise.resolve();
  }
  return removePath(...args);
}

function runPrReviewLeasesCommand(
  args: readonly string[],
): ReturnType<typeof runPrReviewLeasesRuntimeCommand> {
  return commandHarness.trackOuter(
    runPrReviewLeasesRuntimeCommand(args),
    `pr-review-leases ${args.join(" ")}`,
  );
}

function runPlayReviewSharedContextCommand(
  args: readonly string[],
): ReturnType<typeof runPlayReviewSharedContextRuntimeCommand> {
  return commandHarness.trackOuter(
    runPlayReviewSharedContextRuntimeCommand(args),
    `play-review-shared-context ${args.join(" ")}`,
  );
}

interface DiscoveryResult {
  disposition: string;
  canonical_worktree_present: boolean;
  active: Array<{
    lease_file: string;
    worktree_path: string | null;
    state: string | null;
    classification: string;
    worktree_dirty: boolean | null;
    unmanaged_ephemeral_artifacts: boolean | null;
  }>;
  resume: { lease_file: string; worktree_path: string } | null;
}

async function discoverPrReviewSession(): Promise<DiscoveryResult> {
  const result = await runPrReviewLeasesCommand(["discover"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as DiscoveryResult;
}

it("selects the exact issue-578 Windows PR-review lane", async () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const [
    packageSource,
    harnessSource,
    lifecycleSource,
    leaseSource,
    manifestSource,
    rootIdentitySource,
    sourceImmutabilitySource,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readFile(
      path.join(
        repositoryRoot,
        "src/__test-helpers__/pr-review-command-harness.test.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(repositoryRoot, "src/runtime/pr-review-leases.test.ts"),
      "utf8",
    ),
    readFile(
      path.join(repositoryRoot, "src/runtime/pr-review-manifests.test.ts"),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "src/__test-helpers__/pr-review-root-identity.test.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(repositoryRoot, "src/runtime/source-immutability.test.ts"),
      "utf8",
    ),
  ]);
  const packageJson = JSON.parse(packageSource) as {
    scripts?: Record<string, string>;
  };
  const command = packageJson.scripts?.["test:ci:windows:pr-review"];
  const laneFiles = [
    "src/__test-helpers__/pr-review-command-harness.test.ts",
    "src/__test-helpers__/pr-review-process-protocol.test.ts",
    "src/__test-helpers__/pr-review-root-identity.test.ts",
    "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
    "src/runtime/pr-review-leases.test.ts",
    "src/runtime/pr-review-manifests.test.ts",
    "src/runtime/source-immutability.test.ts",
  ];
  const commandPrefix = [
    "vitest run --project unit --no-file-parallelism",
    ...laneFiles,
  ].join(" ");
  expect(command).toBeTypeOf("string");
  const selectorRecord = new RegExp(
    `^${commandPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} --testNamePattern "([^"]+)"$`,
    "u",
  ).exec(command ?? "");
  expect(selectorRecord).not.toBeNull();
  const selector = new RegExp(selectorRecord?.[1] ?? "(?!)", "u");
  const windowsExecutableTitle =
    "enrolls a real Windows executable and rejects a wrong extension";
  const rootIdentitySourceFile = ts.createSourceFile(
    "pr-review-root-identity.test.ts",
    rootIdentitySource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const windowsExecutableRegistrations: string[] = [];
  const visitRootIdentity = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "test" &&
      node.expression.expression.name.text === "runIf" &&
      node.expression.arguments[0]?.getText(rootIdentitySourceFile) ===
        'process.platform === "win32"'
    ) {
      const title = node.arguments[0];
      windowsExecutableRegistrations.push(
        title !== undefined &&
          (ts.isStringLiteral(title) ||
            ts.isNoSubstitutionTemplateLiteral(title))
          ? title.text
          : "<nonliteral>",
      );
    }
    ts.forEachChild(node, visitRootIdentity);
  };
  visitRootIdentity(rootIdentitySourceFile);
  expect(windowsExecutableRegistrations).toEqual([windowsExecutableTitle]);
  const literalTestTitles = (source: string, fileName: string): string[] => {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const registrars = new Set<string>();
    const unsupported: string[] = [];
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "vitest"
      ) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined) continue;
      if (!ts.isNamedImports(bindings)) {
        unsupported.push(bindings.getText(sourceFile));
        continue;
      }
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "it" || imported === "test") {
          registrars.add(element.name.text);
        }
      }
    }
    const titles: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        registrars.has(node.text) &&
        !(
          ts.isImportSpecifier(node.parent) &&
          (node.parent.name === node || node.parent.propertyName === node)
        ) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        unsupported.push(node.parent.getText(sourceFile));
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        registrars.has(node.expression.text)
      ) {
        const title = node.arguments[0];
        if (
          title !== undefined &&
          (ts.isStringLiteral(title) ||
            ts.isNoSubstitutionTemplateLiteral(title))
        ) {
          titles.push(title.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return titles;
  };
  const strictHarnessRegistrations = (
    source: string,
    fileName: string,
  ): Array<{ fullTitle: string; title: string }> => {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const registrars = new Set<string>();
    const unsupported: string[] = [];
    let vitestImportCount = 0;
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "vitest"
      ) {
        continue;
      }
      vitestImportCount += 1;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) {
        unsupported.push(statement.getText(sourceFile));
        continue;
      }
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "test") {
          unsupported.push(element.getText(sourceFile));
        }
        if (imported !== "describe" && imported !== "it") continue;
        if (element.name.text !== imported) {
          unsupported.push(element.getText(sourceFile));
          continue;
        }
        registrars.add(imported);
      }
    }

    const literalTitle = (node: ts.Node | undefined): string | undefined =>
      node !== undefined &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ? node.text
        : undefined;
    const registrations: Array<{ fullTitle: string; title: string }> = [];
    const suiteForTest = (
      call: ts.CallExpression,
    ): ts.CallExpression | undefined => {
      const statement = call.parent;
      const block = statement.parent;
      const callback = block.parent;
      const suiteCall = callback.parent;
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isBlock(block) ||
        !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ||
        !ts.isCallExpression(suiteCall) ||
        suiteCall.arguments[1] !== callback ||
        !ts.isIdentifier(suiteCall.expression) ||
        suiteCall.expression.text !== "describe" ||
        !ts.isExpressionStatement(suiteCall.parent) ||
        !ts.isSourceFile(suiteCall.parent.parent)
      ) {
        return undefined;
      }
      return suiteCall;
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        unsupported.push(node.getText(sourceFile));
      }
      if (
        ts.isIdentifier(node) &&
        registrars.has(node.text) &&
        !(
          ts.isImportSpecifier(node.parent) &&
          (node.parent.name === node || node.parent.propertyName === node)
        ) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        unsupported.push(node.parent.getText(sourceFile));
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "describe"
      ) {
        const callback = node.arguments[1];
        if (
          literalTitle(node.arguments[0]) === undefined ||
          !(
            callback !== undefined &&
            (ts.isArrowFunction(callback) ||
              ts.isFunctionExpression(callback)) &&
            ts.isBlock(callback.body)
          ) ||
          !ts.isExpressionStatement(node.parent) ||
          !ts.isSourceFile(node.parent.parent)
        ) {
          unsupported.push(node.getText(sourceFile));
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "it"
      ) {
        const title = literalTitle(node.arguments[0]);
        const suiteCall = suiteForTest(node);
        const suiteTitle = literalTitle(suiteCall?.arguments[0]);
        if (
          title === undefined ||
          suiteCall === undefined ||
          suiteTitle === undefined
        ) {
          unsupported.push(node.getText(sourceFile));
        } else {
          registrations.push({
            fullTitle: `${suiteTitle} > ${title}`,
            title,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(vitestImportCount).toBe(1);
    expect([...registrars]).toEqual(["describe", "it"]);
    expect(unsupported).toEqual([]);
    return registrations;
  };
  const assertNoModifiedRegistrationSurfaces = (
    source: string,
    fileName: string,
    selectedMarkers: readonly string[],
  ): void => {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const unsupported: string[] = [];
    const registrationRoot = (node: ts.Expression): string | undefined => {
      if (ts.isIdentifier(node)) return node.text;
      if (ts.isCallExpression(node)) return registrationRoot(node.expression);
      if (ts.isPropertyAccessExpression(node)) {
        return registrationRoot(node.expression);
      }
      if (ts.isElementAccessExpression(node)) {
        return registrationRoot(node.expression);
      }
      return undefined;
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "vitest" &&
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (
            (imported === "describe" ||
              imported === "it" ||
              imported === "test") &&
            element.name.text !== imported
          ) {
            unsupported.push(element.getText(sourceFile));
          }
        }
      }
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        ["describe", "it", "test"].includes(
          registrationRoot(node.expression) ?? "",
        )
      ) {
        const property = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : undefined;
        const root = registrationRoot(node.expression);
        let registrationSurface: ts.Node = node;
        while (
          ts.isCallExpression(registrationSurface.parent) &&
          (registrationSurface.parent.expression === registrationSurface ||
            registrationSurface.parent.arguments.includes(
              registrationSurface as ts.Expression,
            ))
        ) {
          registrationSurface = registrationSurface.parent;
        }
        if (
          root === "describe" ||
          (property !== "each" &&
            selectedMarkers.some((marker) =>
              registrationSurface.getText(sourceFile).includes(marker),
            ))
        ) {
          unsupported.push(node.getText(sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(unsupported).toEqual([]);
  };

  const expectedHarnessTitles = [
    "copies immutable history into independent short registered worktrees",
    "removes a healthy registered worktree before its case root",
    "prunes a registered worktree whose directory is missing",
    "prunes a registered worktree whose .git marker is missing",
    "skips Git removal for an already-unregistered worktree",
    "skips Git removal for an unregistered worktree with a stale regular .git marker",
    "surfaces Git cleanup failures after removing the case root",
    "tracks outer work and restores exact cwd and environment state",
    "fails fast when a generated suffix exceeds the path budget",
    "provides committed, unborn, and no-ephemeral independent copies",
    "reports bounded taskkill diagnostics after a simulated Windows direct-child fallback",
    "preserves output overflow when simulated Windows cleanup also fails",
    "preserves output overflow when delayed Windows cleanup crosses the deadline",
    "reports a failed Windows fallback before a non-closing child is released",
    "retains a late outer-operation rejection until drain",
    "does not report an outer rejection already delivered before its deadline",
    "terminates an over-deadline child and drains it through close",
    "terminates a child whose output exceeds the bounded buffer",
  ];
  for (const unsupportedRegistration of [
    'import { describe, it as caseIt } from "vitest"; describe("suite", () => { caseIt("case", () => {}); });',
    'import { describe, it } from "vitest"; describe.skip("suite", () => { it("case", () => {}); });',
    'import { describe, it } from "vitest"; describe("suite", () => { for (const value of [1, 2]) { it("case", () => value); } });',
    'import { describe, it } from "vitest"; void import("vitest"); describe("suite", () => { it("case", () => {}); });',
  ]) {
    expect(() =>
      strictHarnessRegistrations(
        unsupportedRegistration,
        "unsupported-registration.test.ts",
      ),
    ).toThrow();
  }
  const harnessRegistrations = strictHarnessRegistrations(
    harnessSource,
    "pr-review-command-harness.test.ts",
  );
  const harnessTitles = harnessRegistrations.map(({ title }) => title);
  expect(harnessTitles).toEqual(expectedHarnessTitles);
  expect(harnessSource).not.toMatch(/descendant/iu);
  expect(
    harnessRegistrations.filter(({ fullTitle }) => selector.test(fullTitle)),
  ).toHaveLength(18);
  const lifecycleRegistrations = strictHarnessRegistrations(
    lifecycleSource,
    "pr-review-process-lifecycle.test.ts",
  );
  const lifecycleTitles = lifecycleRegistrations.map(({ title }) => title);
  expect(lifecycleTitles).toEqual([
    "observes a normal root-process exit",
    "records cooperative cancellation acknowledgement",
    "attempts root termination after the shared deadline phase",
    "reports an incomplete root observation without claiming descendant absence",
    "caps and redacts incremental output overflow evidence",
    "redacts across chunks before the retained-byte boundary",
    "uses a synchronous request snapshot after launch begins",
    "rejects a forged generated-root object even when its path is helper-created",
    "records a real spawn failure without claiming the root process spawned",
    "records protocol failure and a false root kill without overstating cleanup",
    "restores controller cwd before generated-root disposition",
    "enforces every finite request boundary with exact and plus-one cases",
    "restores harness-owned global state",
    "removes a safe helper-created generated root after root close",
    "preserves a changed, aliased, or unsafe generated root",
  ]);
  expect(
    lifecycleRegistrations.filter(({ fullTitle }) => selector.test(fullTitle)),
  ).toHaveLength(15);

  const leaseTemplate =
    /it\(`rejects stale or mismatched gated result evidence: \$\{testCase\.name\}`/gu;
  const leaseTemplateRecords = [...leaseSource.matchAll(leaseTemplate)];
  expect(leaseTemplateRecords).toHaveLength(1);
  const leaseTemplateOffset = leaseTemplateRecords[0]?.index ?? -1;
  const leaseCasesStart = leaseSource.lastIndexOf(
    "for (const testCase of [",
    leaseTemplateOffset,
  );
  const leaseCasesEnd = leaseSource.indexOf("] as const) {", leaseCasesStart);
  expect(leaseCasesStart).toBeGreaterThanOrEqual(0);
  expect(leaseCasesEnd).toBeGreaterThan(leaseCasesStart);
  expect(leaseCasesEnd).toBeLessThan(leaseTemplateOffset);
  const leaseCaseNames = [
    ...leaseSource
      .slice(leaseCasesStart, leaseCasesEnd)
      .matchAll(/^\s*name: "([^"]+)",$/gmu),
  ].map((match) => match[1]);
  expect(leaseCaseNames).toEqual([
    "wrong-result-file",
    "stale-digest",
    "stale-timestamp",
    "presentation-mismatch",
    "null-presented-at",
    "missing-digest",
    "wrong-review-head",
  ]);
  const renderedLeaseTitles = leaseCaseNames.map(
    (name) => `rejects stale or mismatched gated result evidence: ${name}`,
  );

  const retainedTemplate =
    /\]\)\(\s*"rejects noncanonical retained fingerprint path %s before verify or cleanup deletion"/gu;
  const retainedTemplateRecords = [
    ...sourceImmutabilitySource.matchAll(retainedTemplate),
  ];
  expect(retainedTemplateRecords).toHaveLength(1);
  const retainedTemplateOffset = retainedTemplateRecords[0]?.index ?? -1;
  const retainedCasesStart = sourceImmutabilitySource.lastIndexOf(
    "it.each([",
    retainedTemplateOffset,
  );
  const retainedCasesEnd = sourceImmutabilitySource.indexOf(
    "])(",
    retainedCasesStart,
  );
  expect(retainedCasesStart).toBeGreaterThanOrEqual(0);
  expect(retainedCasesEnd).toBeGreaterThan(retainedCasesStart);
  expect(retainedCasesEnd).toBe(retainedTemplateOffset);
  const retainedCases = [
    ...sourceImmutabilitySource
      .slice(retainedCasesStart, retainedCasesEnd)
      .matchAll(/^\s*"([^"]+)",$/gmu),
  ].map((match) => match[1]);
  expect(retainedCases).toEqual([
    "../outside",
    "/absolute",
    "nested/./file",
    "nested/../file",
    "nested//file",
    "nested/file/",
  ]);
  const renderedRetainedTitles = retainedCases.map((invalidPath) =>
    "rejects noncanonical retained fingerprint path %s before verify or cleanup deletion".replace(
      "%s",
      invalidPath,
    ),
  );

  const manifestTitle =
    "requires explicit provider evidence input for adapter scope validation";
  const manifestTitles = literalTestTitles(
    manifestSource,
    "pr-review-manifests.test.ts",
  );
  expect(
    manifestTitles.filter((title) => title === manifestTitle),
  ).toHaveLength(1);

  const contractTitle = [
    "selects the exact issue-578 Windows PR-review",
    "lane",
  ].join(" ");
  const leaseLiteralTitles = literalTestTitles(
    leaseSource,
    "pr-review-leases.test.ts",
  );
  expect(
    leaseLiteralTitles.filter((title) => title === contractTitle),
  ).toHaveLength(1);
  expect(selector.test(contractTitle)).toBe(true);

  const runtimeInventory = [
    ...leaseLiteralTitles,
    ...renderedLeaseTitles,
    ...manifestTitles,
    ...literalTestTitles(
      sourceImmutabilitySource,
      "source-immutability.test.ts",
    ),
    ...renderedRetainedTitles,
  ];
  const selectedRuntimeTitles = runtimeInventory.filter((title) =>
    selector.test(`runtime suite ${title}`),
  );
  expect(selectedRuntimeTitles).toEqual([
    contractTitle,
    "rejects stale or mismatched gated result evidence: stale-timestamp",
    "rejects stale or mismatched gated result evidence: presentation-mismatch",
    manifestTitle,
    "rejects noncanonical retained fingerprint path ../outside before verify or cleanup deletion",
    "rejects noncanonical retained fingerprint path /absolute before verify or cleanup deletion",
  ]);

  for (const [fileName, source, selectedMarkers] of [
    ["pr-review-command-harness.test.ts", harnessSource, []],
    ["pr-review-process-lifecycle.test.ts", lifecycleSource, []],
    [
      "pr-review-leases.test.ts",
      leaseSource,
      [contractTitle, "rejects stale or mismatched gated result evidence:"],
    ],
    ["pr-review-manifests.test.ts", manifestSource, [manifestTitle]],
    [
      "source-immutability.test.ts",
      sourceImmutabilitySource,
      [
        "rejects noncanonical retained fingerprint path %s before verify or cleanup deletion",
      ],
    ],
  ] as const) {
    assertNoModifiedRegistrationSurfaces(source, fileName, selectedMarkers);
  }
  const collection = await execFileAsync(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules/vitest/vitest.mjs"),
      "list",
      "--project",
      "unit",
      "--json",
      "--no-file-parallelism",
      ...laneFiles,
      "--testNamePattern",
      selectorRecord?.[1] ?? "(?!)",
    ],
    { cwd: repositoryRoot },
  );
  expect(collection.exitCode).toBe(0);
  const collectedTests = JSON.parse(collection.stdout) as Array<{
    file: string;
    name: string;
    projectName: string;
  }>;
  const collectedInventory = collectedTests
    .map(({ file, name, projectName }) => ({
      file: path.relative(repositoryRoot, file).split(path.sep).join("/"),
      name,
      projectName,
    }))
    .sort((left, right) =>
      `${left.file}\0${left.name}`.localeCompare(
        `${right.file}\0${right.name}`,
      ),
    );
  const expectedCollectedInventory = [
    ...harnessRegistrations.map(({ fullTitle }) => ({
      file: laneFiles[0],
      name: fullTitle,
      projectName: "unit",
    })),
    ...[
      "round trips each checked-in closed V1 message through raw-byte framing",
      "rejects malformed JSON messages before framing them as lifecycle evidence",
      "enforces the exact byte boundary before copying sender payload bytes",
      "uses intrinsic byte-view metadata and rejects non-ArrayBuffer and Proxy views",
      "is invariant to coalescing and commits an accepted prefix exactly once",
      "keeps exact-limit and malformed-suffix outcomes invariant across frame partitions",
      "fails closed at EOF and checks terminal state before inspecting later input",
    ].map((title) => ({
      file: laneFiles[1],
      name: `pr-review process protocol > ${title}`,
      projectName: "unit",
    })),
    ...[
      "enrolls distinct logical, normalized, physical, and stable directory identity",
      "accepts only a component-contained generated-root working directory and detects replacement",
      "fails closed for raw symlink-plus-dot-dot components before normalization",
      "uses only Windows-equivalent volume comparison and preserves original spellings",
      "preserves exact three-way redaction variants for a physical parent alias",
      ...(process.platform === "win32"
        ? [windowsExecutableTitle]
        : [
            "enrolls only a POSIX executable regular file and rejects a non-executable alias",
          ]),
    ].map((title) => ({
      file: laneFiles[2],
      name: `pr-review root identity > ${title}`,
      projectName: "unit",
    })),
    ...lifecycleRegistrations.map(({ fullTitle }) => ({
      file: laneFiles[3],
      name: fullTitle,
      projectName: "unit",
    })),
    {
      file: laneFiles[4],
      name: contractTitle,
      projectName: "unit",
    },
    {
      file: laneFiles[4],
      name: "pr-review lease read-status > rejects stale or mismatched gated result evidence: stale-timestamp",
      projectName: "unit",
    },
    {
      file: laneFiles[4],
      name: "pr-review lease read-status > rejects stale or mismatched gated result evidence: presentation-mismatch",
      projectName: "unit",
    },
    {
      file: laneFiles[5],
      name: `pr-review Phase 5 audit summary renderer > ${manifestTitle}`,
      projectName: "unit",
    },
    {
      file: laneFiles[6],
      name: "source-immutability runtime > rejects noncanonical retained fingerprint path ../outside before verify or cleanup deletion",
      projectName: "unit",
    },
    {
      file: laneFiles[6],
      name: "source-immutability runtime > rejects noncanonical retained fingerprint path /absolute before verify or cleanup deletion",
      projectName: "unit",
    },
  ].sort((left, right) =>
    `${left.file}\0${left.name}`.localeCompare(`${right.file}\0${right.name}`),
  );
  expect(collectedInventory).toHaveLength(52);
  expect(collectedInventory).toEqual(expectedCollectedInventory);
});

function createLease(): PrReviewLease {
  return reducePrReviewLease(null, identity, {
    state: "created",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  });
}

function reviewedLease(): PrReviewLease {
  return reducePrReviewLease(createLease(), identity, {
    state: "reviewed",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:01:00Z",
    resultFile: ".ephemeral/pr-432-result.json",
    resultSha256: resultDigest,
  });
}

function gatedLease(): PrReviewLease {
  return reducePrReviewLease(reviewedLease(), identity, {
    state: "gated",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:02:00Z",
    presentedAt: "2026-06-11T00:02:00Z",
    presentationStatus: "preview-current",
    resultSha256: resultDigest,
  });
}

describe("pr-review lease reducer", () => {
  it("creates and advances created, reviewed, and gated leases", () => {
    expect(createLease()).toMatchObject({
      state: "created",
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
      github: { github_post_result: "not-attempted" },
    });

    expect(reviewedLease()).toMatchObject({
      state: "reviewed",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:01:00Z",
          sha256: resultDigest,
        },
      },
    });

    expect(gatedLease()).toMatchObject({
      state: "gated",
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultDigest,
        },
      },
    });
  });

  it("requires digest inputs for result-manifest reducer states", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "reviewed",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:01:00Z",
        resultFile: ".ephemeral/pr-432-result.json",
      }),
    ).toThrow("RESULT_SHA256 is required");

    expect(() =>
      reducePrReviewLease(reviewedLease(), identity, {
        state: "gated",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:02:00Z",
        presentedAt: "2026-06-11T00:02:00Z",
        presentationStatus: "preview-current",
      }),
    ).toThrow("RESULT_SHA256 is required");
  });

  it("records post success and derives GitHub metadata", () => {
    const posted = reducePrReviewLease(gatedLease(), identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:03:00Z",
      githubPostedAt: "2026-06-11T00:03:00Z",
    });

    expect(posted).toMatchObject({
      state: "posted",
      artifacts: {
        approved_review_file: ".ephemeral/topic-approved-review.json",
        validated_payload_file:
          ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
      failure: { phase: null },
    });
  });

  it("rejects posted leases without a validated payload pointer", () => {
    expect(() =>
      reducePrReviewLease(gatedLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:03:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:03:00Z",
        githubPostedAt: "2026-06-11T00:03:00Z",
      }),
    ).toThrow("VALIDATED_REVIEW_PAYLOAD_FILE is required");
  });

  it("preserves gated recovery evidence for GitHub post failures", () => {
    const failed = reducePrReviewLease(gatedLease(), identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });

    expect(failed).toMatchObject({
      state: "failed",
      artifacts: {
        result_file: ".ephemeral/pr-432-result.json",
        approved_review_file: ".ephemeral/topic-approved-review.json",
      },
      presentation: { status: "preview-current" },
      github: {
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      },
    });
  });

  it("covers documented lifecycle transition rows", () => {
    const created = createLease();
    const attached = reducePrReviewLease(created, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:30Z",
      handoffFile: ".ephemeral/pr-432-handoff.json",
    });
    expect(attached.artifacts.handoff_file).toBe(
      ".ephemeral/pr-432-handoff.json",
    );

    const reviewed = reviewedLease();
    const abortedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      finishedAt: "2026-06-11T00:02:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromReviewed).toMatchObject({
      state: "aborted",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
    });

    const gated = gatedLease();
    const refreshedGate = reducePrReviewLease(gated, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      presentedAt: "2026-06-11T00:02:30Z",
      presentationStatus: "edited",
      resultSha256: refreshedResultDigest,
    });
    expect(refreshedGate.presentation.status).toBe("edited");
    expect(refreshedGate.validation.result_manifest.sha256).toBe(
      refreshedResultDigest,
    );

    const abortedFromGated = reducePrReviewLease(gated, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:30Z",
      finishedAt: "2026-06-11T00:03:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromGated.presentation.status).toBe("preview-current");

    const failedFromCreated = reducePrReviewLease(created, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "handoff-validation",
      failureReason: "handoff rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedFromCreated.artifacts.result_file).toBeNull();

    const failedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:05:00Z",
      finishedAt: "2026-06-11T00:05:00Z",
      failurePhase: "preview-render",
      failureReason: "preview failed",
      failureRecoverability: "recoverable",
    });
    expect(failedFromReviewed.artifacts.result_file).toBe(
      ".ephemeral/pr-432-result.json",
    );

    const failedPreApproval = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:06:00Z",
      finishedAt: "2026-06-11T00:06:00Z",
      failurePhase: "stale-head",
      failureReason: "head moved",
      failureRecoverability: "recoverable",
    });
    expect(failedPreApproval.presentation.status).toBe("preview-current");

    const failedApprovalFreeze = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:07:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:07:00Z",
      failurePhase: "approval-freeze",
      failureReason: "approval artifact rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedApprovalFreeze.artifacts.approved_review_file).toBe(
      ".ephemeral/topic-approved-review.json",
    );

    const recoveredGate = reducePrReviewLease(failedPreApproval, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:08:00Z",
      presentedAt: "2026-06-11T00:08:00Z",
      presentationStatus: "preview-current",
      resultSha256: resultDigest,
    });
    expect(recoveredGate.state).toBe("gated");

    const abortedFromFailed = reducePrReviewLease(failedPreApproval, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:09:00Z",
      finishedAt: "2026-06-11T00:09:00Z",
      terminalReason: "not posting",
    });
    expect(abortedFromFailed.state).toBe("aborted");

    const repeatedFailure = reducePrReviewLease(failedPreApproval, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:10:00Z",
      finishedAt: "2026-06-11T00:10:00Z",
      failurePhase: "preview-render",
      failureReason: "preview still failed",
      failureRecoverability: "recoverable",
    });
    expect(repeatedFailure.failure.reason).toBe("preview still failed");

    const githubFailure = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:11:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:11:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });
    const retryPosted = reducePrReviewLease(githubFailure, identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:12:00Z",
      finishedAt: "2026-06-11T00:12:00Z",
      githubPostedAt: "2026-06-11T00:12:00Z",
    });
    expect(retryPosted.github.github_post_result).toBe("succeeded");

    const recreated = reducePrReviewLease(abortedFromFailed, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:13:00Z",
      updatedAt: "2026-06-11T00:13:00Z",
    });
    expect(recreated).toMatchObject({
      state: "created",
      artifacts: { result_file: null },
      validation: {
        result_manifest: { status: null, validated_at: null, sha256: null },
      },
    });
  });

  it("rejects invalid cross-state transitions", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:05:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:05:00Z",
        githubPostedAt: "2026-06-11T00:05:00Z",
      }),
    ).toThrow("invalid lease transition: created -> posted");
  });
});

describe("pr-review lease command validation", () => {
  it("plans create, resume, and unleased-canonical cleanup without mutation", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const create = await discoverPrReviewSession();
      expect(Object.keys(create)).toEqual([
        "schema",
        "repository",
        "pr_number",
        "primary_repository_root",
        "canonical_worktree_path",
        "canonical_worktree_present",
        "active",
        "archived_lease_files",
        "disposition",
        "resume",
      ]);
      expect(create).toMatchObject({
        disposition: "create",
        active: [],
        resume: null,
      });

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      process.env.LEASE_FILE = pathResult.stdout.trim();
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-07-30T00:00:00Z",
      });
      const archivedLeaseFile =
        ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-posted-archived-lease.json";
      await writeFile(
        path.join(workspace.physicalPrimary, archivedLeaseFile),
        "{}\n",
      );

      const leaseBeforeDiscovery = await readFile(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
        "utf8",
      );
      const resume = await discoverPrReviewSession();
      expect(resume).toMatchObject({
        disposition: "resume",
        archived_lease_files: [archivedLeaseFile],
        active: [
          {
            lease_file: process.env.LEASE_FILE,
            worktree_path: workspace.physicalWorktree,
            state: "created",
            classification: "resumable",
            worktree_dirty: false,
            unmanaged_ephemeral_artifacts: false,
          },
        ],
        resume: {
          lease_file: process.env.LEASE_FILE,
          worktree_path: workspace.physicalWorktree,
        },
      });
      await expect(
        readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        ),
      ).resolves.toBe(leaseBeforeDiscovery);

      await removePath(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
      );
      await mkdir(
        path.join(workspace.physicalPrimary, ".worktrees", "pr-432-review"),
        { recursive: true },
      );

      const cleanup = await discoverPrReviewSession();
      expect(cleanup).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_present: true,
        active: [],
        resume: null,
      });

      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await removePath(canonicalWorktree, { recursive: true, force: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "add",
        "-b",
        "canonical-missing",
        canonicalWorktree,
        "HEAD",
      ]);
      await removePath(canonicalWorktree, { recursive: true, force: true });

      const registeredMissingCanonical = await discoverPrReviewSession();
      expect(registeredMissingCanonical).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_present: false,
        active: [],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks dirty and unmanaged registered candidates without mutating leases", async () => {
    for (const observation of ["dirty", "unmanaged"] as const) {
      const workspace = await makeRegisteredWorkspace(
        `pr-review-discovery-${observation}-`,
      );
      try {
        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
        expect(pathResult.exitCode, pathResult.stderr).toBe(0);
        process.env.LEASE_FILE = pathResult.stdout.trim();
        await writeLeaseCommandState({
          state: "created",
          updatedAt: "2026-07-30T00:00:00Z",
        });
        if (observation === "dirty") {
          await writeFile(
            path.join(workspace.physicalWorktree, "uncommitted.txt"),
            "dirty\n",
          );
        } else {
          await writeFile(
            path.join(workspace.physicalPrimary, ".git", "info", "exclude"),
            ".ephemeral/\n",
          );
          await writeFile(
            path.join(workspace.physicalWorktree, ".ephemeral", "extra.json"),
            "{}\n",
          );
        }
        const leaseBeforeDiscovery = await readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        );

        const discovery = await discoverPrReviewSession();
        expect(discovery).toMatchObject({
          disposition: "cleanup-required",
          resume: null,
          active: [
            {
              classification: "resumable",
              worktree_dirty: observation === "dirty",
              unmanaged_ephemeral_artifacts: observation === "unmanaged",
            },
          ],
        });
        await expect(
          readFile(
            path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
            "utf8",
          ),
        ).resolves.toBe(leaseBeforeDiscovery);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("reports null observations for missing candidates without mutating leases", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-missing-",
    );
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      process.env.LEASE_FILE = pathResult.stdout.trim();
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-07-30T00:00:00Z",
      });
      const leaseBeforeDiscovery = await readFile(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
        "utf8",
      );
      await removePath(workspace.physicalWorktree, {
        recursive: true,
        force: true,
      });

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "cleanup-required",
        resume: null,
        active: [
          {
            classification: "missing",
            worktree_dirty: null,
            unmanaged_ephemeral_artifacts: null,
          },
        ],
      });
      await expect(
        readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        ),
      ).resolves.toBe(leaseBeforeDiscovery);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a lease worktree path cannot be resolved", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-loop-",
    );
    try {
      const loopPath = path.join(workspace.tempRoot, "worktree-loop");
      await symlink(loopPath, loopPath, "dir");
      const worktreeDigest = createHash("sha256")
        .update(loopPath)
        .digest("hex");
      const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
      const lease = abortedCommandLease(leaseFile, loopPath, worktreeDigest);
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(lease)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = leaseFile;

      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "invalid",
        resume: null,
        active: [
          {
            lease_file: leaseFile,
            classification: "invalid",
            worktree_path: null,
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("invalidates relative and physical-alias stored worktree paths", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-alias-",
    );
    try {
      const aliasPath = path.join(workspace.tempRoot, "worktree-alias");
      await symlink(workspace.physicalWorktree, aliasPath, "dir");
      const storedPaths = [
        path.relative(workspace.physicalPrimary, workspace.physicalWorktree),
        aliasPath,
      ];
      for (const storedPath of storedPaths) {
        const worktreeDigest = discoveryWorktreeDigest(storedPath);
        const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
        await writeFile(
          path.join(workspace.physicalPrimary, leaseFile),
          `${JSON.stringify(
            abortedCommandLease(leaseFile, storedPath, worktreeDigest),
          )}\n`,
        );
      }
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "invalid",
        resume: null,
      });
      expect(discovery.active).toHaveLength(2);
      expect(discovery.active.map((entry) => entry.classification)).toEqual([
        "invalid",
        "invalid",
      ]);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("physicalizes missing paths and rejects lexical or symlink-parent aliases", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-missing-identity-",
    );
    try {
      const physicalRoot = await realpath(workspace.tempRoot);
      const linkedParent = path.join(physicalRoot, "linked-parent");
      await symlink(physicalRoot, linkedParent, "dir");
      const danglingParent = path.join(physicalRoot, "dangling-parent");
      await symlink(
        path.join(physicalRoot, "missing-target"),
        danglingParent,
        "dir",
      );
      const regularParent = path.join(physicalRoot, "not-a-directory");
      await writeFile(regularParent, "not a directory\n");
      const storedPaths = [
        path.join(physicalRoot, "physical-missing"),
        `${path.join(physicalRoot, "lexical-parent")}${path.sep}..${path.sep}lexical-missing`,
        path.join(linkedParent, "symlink-parent-missing"),
        path.join(danglingParent, "missing"),
        path.join(regularParent, "missing"),
      ];
      for (const storedPath of storedPaths) {
        const worktreeDigest = discoveryWorktreeDigest(storedPath);
        const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
        await writeFile(
          path.join(workspace.physicalPrimary, leaseFile),
          `${JSON.stringify(
            abortedCommandLease(leaseFile, storedPath, worktreeDigest),
          )}\n`,
        );
      }
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({ disposition: "invalid", resume: null });
      expect(
        discovery.active.map((entry) => entry.classification).sort(),
      ).toEqual(["invalid", "invalid", "invalid", "invalid", "missing"]);
      expect(
        discovery.active.find((entry) => entry.classification === "missing"),
      ).toMatchObject({
        worktree_path: path.join(physicalRoot, "physical-missing"),
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("stops as ambiguous when canonical and noncanonical leases are resumable", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    const secondWorktree = path.join(workspace.tempRoot, "review-second");

    try {
      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await mkdir(path.dirname(canonicalWorktree), { recursive: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "add",
        "-b",
        "review-second",
        secondWorktree,
      ]);
      const physicalSecondWorktree = await realpath(secondWorktree);
      process.chdir(workspace.physicalPrimary);

      for (const worktreePath of [
        physicalCanonicalWorktree,
        physicalSecondWorktree,
      ]) {
        setLeaseCommandEnv(workspace.physicalPrimary, worktreePath);
        const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
        expect(pathResult.exitCode, pathResult.stderr).toBe(0);
        process.env.LEASE_FILE = pathResult.stdout.trim();
        await writeLeaseCommandState({
          state: "created",
          updatedAt: "2026-07-30T00:00:00Z",
        });
      }

      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "ambiguous",
        resume: null,
      });
      expect(discovery.active).toHaveLength(2);
      expect(discovery.active.map((entry) => entry.classification)).toEqual([
        "resumable",
        "resumable",
      ]);

      await writeFile(
        path.join(physicalCanonicalWorktree, "uncommitted.txt"),
        "dirty\n",
      );
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        resume: null,
      });
      await removePath(path.join(physicalCanonicalWorktree, "uncommitted.txt"));
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "ambiguous",
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("allows a canonical helper-recorded removed terminal lease to reenter through LC-18", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      const physicalCanonicalParent = path.join(
        workspace.tempRoot,
        "canonical-parent",
      );
      const linkedCanonicalParent = path.join(
        workspace.physicalPrimary,
        ".worktrees",
      );
      await mkdir(physicalCanonicalParent, { recursive: true });
      await symlink(physicalCanonicalParent, linkedCanonicalParent, "dir");
      const canonicalWorktree = path.join(
        linkedCanonicalParent,
        "pr-432-review",
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        physicalCanonicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        physicalCanonicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "skipped",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      const terminalContent = `${JSON.stringify(terminal)}\n`;
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        terminalContent,
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "remove",
        "-f",
        physicalCanonicalWorktree,
      ]);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "create",
        canonical_worktree_path: physicalCanonicalWorktree,
        active: [
          {
            lease_file: leaseFile,
            worktree_path: physicalCanonicalWorktree,
            state: "aborted",
            classification: "reentry",
          },
        ],
        resume: null,
      });

      const archiveFile = `.ephemeral/pr-432-${dynamic.worktreeDigest}-20260611T000100-aborted-archived-lease.json`;
      const archivePath = path.join(workspace.physicalPrimary, archiveFile);
      await writeFile(archivePath, terminalContent);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "create",
        active: [
          {
            lease_file: leaseFile,
            classification: "reentry",
          },
        ],
        resume: null,
      });
      await writeFile(archivePath, '{"divergent":true}\n');
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        active: [
          {
            lease_file: leaseFile,
            classification: "missing",
          },
        ],
        resume: null,
      });
      await removePath(archivePath);
      await symlink(
        path.join(workspace.tempRoot, "missing-archive"),
        archivePath,
      );
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "invalid",
        active: [
          {
            lease_file: leaseFile,
            classification: "invalid",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks a registered missing canonical terminal lease before LC-18 reentry", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await mkdir(path.dirname(canonicalWorktree), { recursive: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        physicalCanonicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        physicalCanonicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "removed",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(terminal)}\n`,
      );
      await removePath(physicalCanonicalWorktree, {
        recursive: true,
        force: true,
      });

      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_path: physicalCanonicalWorktree,
        canonical_worktree_present: false,
        active: [
          {
            lease_file: leaseFile,
            classification: "reentry",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks a noncanonical helper-recorded removed terminal lease", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        workspace.physicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        workspace.physicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "removed",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(terminal)}\n`,
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "remove",
        "-f",
        workspace.physicalWorktree,
      ]);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        active: [
          {
            lease_file: leaseFile,
            worktree_path: workspace.physicalWorktree,
            state: "aborted",
            classification: "missing",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("writes result sha256 and same-cycle validation timestamps for every preview presentation", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const firstDigest = await sha256File(path.join(worktree, resultFile));

      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const firstGate = await readLease(primary, leaseFile);
      expect(firstGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: firstDigest,
      });
      expect(firstGate.validation.result_manifest.validated_at).toBe(
        firstGate.updated_at,
      );

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "edited",
      );
      const secondDigest = await sha256File(path.join(worktree, resultFile));
      expect(secondDigest).not.toBe(firstDigest);
      process.env.PRESENTED_AT = "2026-06-11T00:03:00Z";
      process.env.PRESENTATION_STATUS = "edited";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:03:00Z",
      });
      const secondGate = await readLease(primary, leaseFile);
      expect(secondGate.artifacts.result_file).toBe(resultFile);
      expect(secondGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:03:00Z",
        sha256: secondDigest,
      });
      expect(secondGate.validation.result_manifest.validated_at).toBe(
        secondGate.updated_at,
      );
      expect(secondGate.presentation.status).toBe("edited");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy validation shapes without rewriting or migrating them", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-legacy-validation-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const validLease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      const cases: Array<{
        name: string;
        lease: unknown;
        stderr: string;
      }> = [
        {
          name: "missing-validation",
          lease: omitKey(validLease, "validation"),
          stderr: "lease validation metadata missing",
        },
        {
          name: "missing-result-manifest",
          lease: {
            ...validLease,
            validation: {},
          },
          stderr: "lease result_manifest metadata missing",
        },
        {
          name: "missing-digest",
          lease: {
            ...validLease,
            validation: {
              result_manifest: {
                status: "valid",
                validated_at: "2026-06-11T00:01:00Z",
              },
            },
          },
          stderr: "result manifest digest missing",
        },
      ];

      for (const testCase of cases) {
        await writeFile(
          path.join(primary, leaseFile),
          `${JSON.stringify(testCase.lease, null, 2)}\n`,
        );
        const before = await readFile(path.join(primary, leaseFile), "utf8");

        process.env.LEASE_FILE = leaseFile;
        let result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        result = await runPrReviewLeasesCommand(["inspect-worktree"]);
        expect(result.exitCode, testCase.name).toBe(0);
        expect(result.stdout, testCase.name).toContain(
          "REFUSAL_REASON=invalid-lease",
        );
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
        process.env.PRESENTATION_STATUS = "preview-current";
        process.env.RESULT_FILE = resultFile;
        process.env.STATE = "gated";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
        result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid result paths before hashing lifecycle write inputs", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-result-path-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const before = await readFile(path.join(primary, leaseFile), "utf8");
      await writeFile(
        path.join(tempRoot, "outside-result.json"),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );

      process.env.RESULT_FILE = "../outside-result.json";
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("path traversal: ../outside-result.json");
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes a digest when advancing valid reviewed leases to gated", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-valid-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
            resultFile,
            await sha256File(path.join(worktree, resultFile)),
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const lease = await readLease(primary, leaseFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        await sha256File(path.join(worktree, resultFile)),
      );
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts initial not-presented results for reviewed leases without making them live status", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-not-presented-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      const resultSha256 = await sha256File(path.join(worktree, resultFile));
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      const reviewed = await readLease(primary, leaseFile);
      expect(reviewed).toMatchObject({
        state: "reviewed",
        artifacts: { result_file: resultFile },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:01:00Z",
            sha256: resultSha256,
          },
        },
        presentation: { presented_at: null, status: null },
      });

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);

      process.env.HEAD_SHA = reviewHead;
      result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("read-status requires gated lease");

      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.TERMINAL_REASON = "not posting";
      await writeLeaseCommandState({
        state: "aborted",
        updatedAt: "2026-06-11T00:02:00Z",
      });

      const aborted = await readLease(primary, leaseFile);
      expect(aborted).toMatchObject({
        state: "aborted",
        artifacts: { result_file: resultFile },
        presentation: { presented_at: null, status: null },
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before fresh reviewed and gated writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-fresh-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await rm(path.join(workspace.primary, leaseFile), { force: true });
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const createdBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );

      await mutateNestedFindingsWithoutUpdatingResult(workspace);
      process.env.RESULT_FILE = workspace.resultFile;
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      process.env.PR_REVIEW_DIR = workspace.prReviewDir;
      process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
        workspace.prReviewManifestHelperScript;
      process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
        workspace.prReviewLeaseHelperScript;
      process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(createdBefore);

      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            identityFromLeaseFile(leaseFile, workspace.physicalWorktree)
              .worktreeDigest,
            workspace.resultFile,
            workspace.resultSha256,
          ),
          null,
          2,
        )}\n`,
      );
      const reviewedBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      process.env.STATE = "gated";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(reviewedBefore);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed closed cleanup metadata", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-shape-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      for (const cleanup of [
        {
          last_outcome: "unknown",
          last_checked_at: null,
          removed_at: null,
        },
        {
          last_outcome: "removed",
          last_checked_at: "not-a-timestamp",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-02-30T00:00:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
          unexpected: true,
        },
      ]) {
        const lease = await readLease(workspace.primary, workspace.leaseFile);
        lease.cleanup = cleanup as PrReviewLease["cleanup"];
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(lease, null, 2)}\n`,
        );
        const result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode).toBe(1);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid strict failure evidence instead of rejecting failed writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      const beforeFailure = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failedAfterDrift = await readLease(
        workspace.primary,
        workspace.leaseFile,
      );
      expect(failedAfterDrift.state).toBe("failed");
      expect(failedAfterDrift.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failedAfterDrift.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failedAfterDrift.failure).toEqual({
        phase: "github-post",
        reason: "GitHub API rejected review",
        recoverability: "recoverable",
      });
      expect(failedAfterDrift.github).toEqual({
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      });

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(
          {
            ...JSON.parse(beforeFailure),
            state: "failed",
            updated_at: "2026-06-11T00:03:00Z",
            artifacts: {
              ...JSON.parse(beforeFailure).artifacts,
              approved_review_file: process.env.APPROVED_REVIEW_FILE,
              validated_payload_file: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
            },
            terminal: {
              finished_at: "2026-06-11T00:03:00Z",
              reason: null,
            },
            failure: {
              phase: "github-post",
              reason: "GitHub API rejected review",
              recoverability: "recoverable",
            },
            github: {
              github_post_attempted: true,
              github_post_result: "failed",
              github_posted_at: null,
            },
          },
          null,
          2,
        )}\n`,
      );
      const beforePosted = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:04:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(beforePosted);

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failedAfterDrift, null, 2)}\n`,
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:05:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:05:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:05:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "APPROVED_REVIEW_FILE must match existing failed approved-review",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid approval-freeze evidence while recording failed", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-approval-freeze-invalid-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "approval-freeze";
      process.env.FAILURE_REASON = "approved review validation failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        "2222222222222222222222222222222222222222",
      );

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.state).toBe("failed");
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: workspace.resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
      expect(failed.failure).toEqual({
        phase: "approval-freeze",
        reason: "approved review validation failed",
        recoverability: "recoverable",
      });
      expect(failed.github).toEqual({
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace("pr-review-handoff-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: handoffFile,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace(
      "pr-review-invalid-handoff-failure-",
    );
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const handoffPath = path.join(worktree, handoffFile);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
      await writeFile(
        handoffPath,
        `${JSON.stringify({ ...handoff, repository: "other/repo" }, null, 2)}\n`,
      );

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects stale or missing result digests during validate and cleanup classification", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-digest-",
    );

    try {
      setReadStatusEnv(workspace);
      await writeFile(
        path.join(workspace.worktree, workspace.resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: workspace.reviewHead,
          presentation: { status: "preview-current" },
          stale: true,
        })}\n`,
      );

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");

      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest missing");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects terminal stored presentation evidence that mismatches the result", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-presentation-mismatch-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      await mutateLease(workspace, (lease) => {
        expect(lease.state).toBe("failed");
        lease.presentation.status = "edited";
      });

      setReadStatusEnv(workspace);
      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("presentation status mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects lease ref mismatch against result handoff evidence during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.base_ref = "release";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff base ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting malformed existing leases", async () => {
    const tempRoot = await commandHarness.createScratchRoot();
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      await writeFile(path.join(primary, leaseFile), "{not json\n");

      process.env.LEASE_FILE = leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:00:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:00:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe("{not json\n");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy reviewed lease/v1 result pointers without validation metadata", async () => {
    const tempRoot = await commandHarness.createScratchRoot();
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const resultFile = ".ephemeral/pr-432-result.json";
      await writeFile(
        path.join(worktree, resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "reviewed",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: resultFile,
            approved_review_file: null,
            validated_payload_file: null,
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("lease validation metadata missing");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown JSON lease states before state-invariant checks", async () => {
    const { tempRoot, primary, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-unknown-state-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "postd",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
          validation: {
            result_manifest: { status: null, validated_at: null, sha256: null },
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown lease state: postd");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects approved reviews from a different result manifest head", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-approved-head-");
    const resultHead = "1111111111111111111111111111111111111111";
    const approvedHead = "2222222222222222222222222222222222222222";
    const resultFile = `.ephemeral/pr-432-${resultHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${approvedHead}-approved-review.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        resultHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        approvedHead,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile: `.ephemeral/pr-432-${approvedHead}-validated-review-payload.json`,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("approved review result head mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-deterministic validated payload paths", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-payload-path-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${reviewHead}-approved-review.json`;
    const validatedPayloadFile =
      ".ephemeral/copied-validated-review-payload.json";

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        reviewHead,
      );
      await writeFile(
        path.join(worktree, validatedPayloadFile),
        `${JSON.stringify(reviewPayload(reviewHead))}\n`,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("validated payload path mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses posted leases missing the validated payload before cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-posted-missing-payload-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("CAN_REMOVE=yes");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a complete validated posted chain for cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-complete-posted-chain-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const validatedPayloadFile = await writeValidatedPayloadArtifact(
      workspace.worktree,
      workspace.reviewHead,
    );

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["validate"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease read-status", () => {
  it("emits the exact status envelope without cleanup fields or lease mutation", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      const result = await runPrReviewLeasesCommand(["read-status"]);
      const after = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(after).toBe(before);
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(Object.keys(status)).toEqual([
        "lease_state",
        "worktree_path",
        "worktree_digest",
        "worktree_exists",
        "worktree_registered",
        "worktree_dirty",
        "identity_match",
        "result_file",
        "result_sha256",
        "result_validated_at",
        "lease_updated_at",
        "presentation_status",
        "presented_at",
      ]);
      expect(status).toMatchObject({
        lease_state: "gated",
        worktree_path: workspace.physicalWorktree,
        worktree_digest: workspace.worktreeDigest,
        worktree_exists: true,
        worktree_registered: true,
        identity_match: true,
        result_file: workspace.resultFile,
        result_sha256: workspace.resultSha256,
        result_validated_at: "2026-06-11T00:02:00Z",
        lease_updated_at: "2026-06-11T00:02:00Z",
        presentation_status: "preview-current",
        presented_at: "2026-06-11T00:02:00Z",
      });
      expect(typeof status.worktree_dirty).toBe("boolean");
      for (const forbidden of [
        "can_remove",
        "force_remove_allowed",
        "refusal_reason",
        "requires_confirmation",
        "metadata_outcome",
      ]) {
        expect(status).not.toHaveProperty(forbidden);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("inspects worktree dirtiness with optional git locks disabled", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-locks-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const traceFile = path.join(workspace.tempRoot, "git-trace2.jsonl");
      const originalTrace = process.env.GIT_TRACE2_EVENT;
      process.env.GIT_TRACE2_EVENT = traceFile;
      try {
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, result.stderr).toBe(0);
      } finally {
        if (originalTrace === undefined) {
          unsetEnv("GIT_TRACE2_EVENT");
        } else {
          process.env.GIT_TRACE2_EVENT = originalTrace;
        }
      }

      const statusArgs = (await readFile(traceFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event?: unknown; argv?: unknown })
        .filter(
          (event): event is { event: "start"; argv: string[] } =>
            event.event === "start" &&
            Array.isArray(event.argv) &&
            event.argv.every((value) => typeof value === "string"),
        )
        .map((event) => event.argv)
        .find((argv) => argv.includes("status"));
      expect(statusArgs).toBeDefined();
      if (statusArgs === undefined) {
        throw new Error("missing git status trace2 start event");
      }
      expect(statusArgs).toEqual(
        expect.arrayContaining([
          "--no-optional-locks",
          "-C",
          workspace.physicalWorktree,
          "status",
          "--porcelain",
        ]),
      );
      expect(statusArgs.indexOf("--no-optional-locks")).toBeLessThan(
        statusArgs.indexOf("status"),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts dirty but valid registered worktrees as status", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-dirty-");

    try {
      await writeFile(path.join(workspace.worktree, "dirty.txt"), "dirty\n");
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        worktree_dirty: true,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when git status cannot inspect the worktree", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-git-failure-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const originalGitIndexFile = process.env.GIT_INDEX_FILE;
      process.env.GIT_INDEX_FILE = workspace.tempRoot;
      const result = await runPrReviewLeasesCommand(["read-status"]);
      if (originalGitIndexFile === undefined) {
        unsetEnv("GIT_INDEX_FILE");
      } else {
        process.env.GIT_INDEX_FILE = originalGitIndexFile;
      }
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("git status inspection failed");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for missing worktrees", async () => {
    const missing = await makeGatedStatusWorkspace("pr-review-status-missing-");
    try {
      process.chdir(missing.physicalPrimary);
      setReadStatusEnv(missing);
      await rm(missing.worktree, { recursive: true, force: true });
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
    } finally {
      process.chdir(originalCwd);
      await rm(missing.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for unregistered worktrees", async () => {
    const unregisteredBase = await makeRegisteredWorkspace(
      "pr-review-status-unregistered-",
    );
    try {
      const separate = path.join(unregisteredBase.tempRoot, "separate");
      await mkdir(path.join(separate, ".ephemeral"), { recursive: true });
      const physicalSeparate = await realpath(separate);
      process.chdir(unregisteredBase.physicalPrimary);
      setLeaseCommandEnv(unregisteredBase.physicalPrimary, physicalSeparate);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparate,
      );
      const resultFile =
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-result.json";
      await writeResultArtifact(
        separate,
        physicalSeparate,
        resultFile,
        "1111111111111111111111111111111111111111",
        "preview-current",
      );
      await writeFile(
        path.join(unregisteredBase.primary, leaseFile),
        `${JSON.stringify(
          gatedCommandLease({
            leaseFile,
            worktreePath: physicalSeparate,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(separate, resultFile)),
          }),
          null,
          2,
        )}\n`,
      );
      process.env.LEASE_FILE = leaseFile;
      process.env.RESULT_FILE = resultFile;
      process.env.HEAD_SHA = "1111111111111111111111111111111111111111";
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("not registered");
    } finally {
      process.chdir(originalCwd);
      await rm(unregisteredBase.tempRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "fails closed for unreadable worktrees where chmod permissions are enforced",
    async () => {
      const unreadable = await makeGatedStatusWorkspace(
        "pr-review-status-unreadable-",
      );
      try {
        process.chdir(unreadable.physicalPrimary);
        setReadStatusEnv(unreadable);
        await chmod(unreadable.worktree, 0);
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      } finally {
        await chmod(unreadable.worktree, 0o755).catch(() => undefined);
        process.chdir(originalCwd);
        await rm(unreadable.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("fails closed for identity-mismatched worktrees", async () => {
    const mismatch = await makeGatedStatusWorkspace(
      "pr-review-status-mismatch-",
    );
    try {
      const lease = await readLease(mismatch.primary, mismatch.leaseFile);
      await writeFile(
        path.join(mismatch.primary, mismatch.leaseFile),
        `${JSON.stringify({ ...lease, repository: "other/repo" }, null, 2)}\n`,
      );
      process.chdir(mismatch.physicalPrimary);
      setReadStatusEnv(mismatch);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("lease repository mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(mismatch.tempRoot, { recursive: true, force: true });
    }
  });

  for (const testCase of [
    {
      name: "wrong-result-file",
      env: () => {
        process.env.RESULT_FILE = ".ephemeral/pr-432-other-result.json";
      },
      stderr: "RESULT_FILE must match",
    },
    {
      name: "stale-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = "0".repeat(64);
        }),
      stderr: "digest mismatch",
    },
    {
      name: "stale-timestamp",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.validated_at =
            "2026-06-11T00:01:00Z";
        }),
      stderr: "validation is stale",
    },
    {
      name: "presentation-mismatch",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.status = "edited";
        }),
      stderr: "presentation status mismatch",
    },
    {
      name: "null-presented-at",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.presented_at = null;
        }),
      stderr: "lease schema mismatch",
    },
    {
      name: "missing-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = null;
        }),
      stderr: "digest missing",
    },
    {
      name: "wrong-review-head",
      env: () => {
        process.env.HEAD_SHA = "2222222222222222222222222222222222222222";
      },
      stderr: "result review head mismatch",
    },
  ] as const) {
    it(`rejects stale or mismatched gated result evidence: ${testCase.name}`, async () => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-status-${testCase.name}-`,
      );
      try {
        await testCase.mutate?.(workspace);
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        testCase.env?.();
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    });
  }

  it("fails closed for nested result artifact drift before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for lease base/head mismatch before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.head_ref = "other-topic";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff head ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records post-gated preview-render failure without invalid recovery artifacts", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const gated = await readLease(primary, leaseFile);
      await rm(path.join(worktree, resultFile), { force: true });

      unsetEnv("RESULT_FILE");
      unsetEnv("PRESENTED_AT");
      unsetEnv("PRESENTATION_STATUS");
      process.env.EXPECTED_STATE = "gated";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "audit summary render failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      await writeLeaseCommandState({
        state: "failed",
        updatedAt: "2026-06-11T00:03:00Z",
      });

      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records reviewed failure after nested result drift by clearing invalid recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-reviewed-failure-nested-drift-",
    );

    try {
      const reviewed = reviewedCommandLease(
        workspace.leaseFile,
        workspace.physicalWorktree,
        workspace.worktreeDigest,
        workspace.resultFile,
        workspace.resultSha256,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(reviewed, null, 2)}\n`,
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:03:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects failed-to-failed writes that replace the result pointer", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-result-replacement-",
    );

    try {
      const failed: PrReviewLease = {
        ...(await readLease(workspace.primary, workspace.leaseFile)),
        state: "failed",
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: null,
        },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failed, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.RESULT_FILE = `.ephemeral/pr-432-${workspace.reviewHead}-replacement-result.json`;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview still failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "RESULT_FILE must match existing failed result",
      );
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves valid failed recovery evidence without requiring failure timestamp freshness", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-preserve-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = approvedReviewFile;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      let failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.updated_at).toBe("2026-06-11T00:03:00Z");
      expect(failed.validation.result_manifest.validated_at).toBe(
        "2026-06-11T00:02:00Z",
      );
      expect(failed.artifacts).toMatchObject({
        result_file: workspace.resultFile,
        approved_review_file: approvedReviewFile,
      });

      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected retry";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        updated_at: "2026-06-11T00:04:00Z",
        artifacts: {
          result_file: workspace.resultFile,
          approved_review_file: approvedReviewFile,
        },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:02:00Z",
            sha256: workspace.resultSha256,
          },
        },
        presentation: {
          presented_at: "2026-06-11T00:02:00Z",
          status: "preview-current",
        },
        failure: {
          phase: "github-post",
          reason: "GitHub API rejected retry",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure when the worktree is missing", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-audit-worktree-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        {
          cwd: workspace.primary,
        },
      );

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation timestamp after strict status rejection", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.presented_at = null;
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const validateBefore = await runPrReviewLeasesCommand(["validate"]);
      expect(validateBefore.exitCode).toBe(1);
      expect(validateBefore.stderr).toContain("lease schema mismatch");

      const statusBefore = await runPrReviewLeasesCommand(["read-status"]);
      expect(statusBefore).toMatchObject({ exitCode: 1, stdout: "" });
      expect(statusBefore.stderr).toContain("lease schema mismatch");

      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });

      process.env.WORKTREE_PATH = workspace.physicalWorktree;
      const validateAfter = await runPrReviewLeasesCommand(["validate"]);
      expect(validateAfter.exitCode, validateAfter.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation status by clearing recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-status-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts for Phase 5 audit failure when worktree directory is unregistered", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-audit-worktree-",
    );

    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        {
          cwd: workspace.primary,
        },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });
      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves current recovery artifacts for registered Phase 5 audit failures", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-current-audit-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBe(workspace.resultFile);
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-nested-digest-audit-evidence-",
    );

    try {
      await writeFile(
        path.join(workspace.worktree, workspace.findingsFile),
        `${JSON.stringify({ findings: [{ stale: true }], carry_forward: [] })}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears stale recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-stale-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.validated_at = "2026-06-11T00:01:00Z";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears missing-digest recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-digest-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears presentation-mismatched recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-presentation-mismatch-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = "edited";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects audit failure recovery when the prior lease is not gated", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-audit-not-gated-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.state = "reviewed";
        lease.presentation = { presented_at: null, status: null };
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "record-audit-failure requires gated preview-render failure",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease Git cleanup safety", () => {
  it("reports missing worktrees as skipped cleanup when lease identity matches", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-missing-worktree-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(worktree, { recursive: true, force: true });

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for missing terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await rm(workspace.worktree, { recursive: true, force: true });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before archive-on-recreate writes", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-nested-drift-`,
      );

      try {
        process.chdir(workspace.physicalPrimary);
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        await mutateNestedFindingsWithoutUpdatingResult(workspace);

        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
        process.env.PR_REVIEW_DIR = workspace.prReviewDir;
        process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
          workspace.prReviewManifestHelperScript;
        process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
          workspace.prReviewLeaseHelperScript;
        process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(1);
        expect(result.stderr, state).toContain("findings digest mismatch");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const archived = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          archived.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("retries helper-recorded terminal archival after fresh creation is interrupted", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-after-cleanup-`,
        true,
      );

      try {
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        await writeFile(
          path.join(workspace.primary, ".git", "info", "exclude"),
          ".ephemeral/\n",
        );
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(cleanup.exitCode, state).toBe(0);
        expect(cleanup.stdout, state).toContain("OUTCOME=removed");
        const removedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(removedLease.cleanup).toMatchObject({ last_outcome: "removed" });
        expect(removedLease.cleanup?.removed_at).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
        );
        const removedAt = removedLease.cleanup?.removed_at;
        const retry = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(retry.exitCode, state).toBe(0);
        expect(retry.stdout, state).toContain("OUTCOME=skipped");
        const retriedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(retriedLease.cleanup).toMatchObject({
          last_outcome: "skipped",
          removed_at: removedAt,
        });
        await execFileAsync(
          "git",
          ["worktree", "add", workspace.worktree, "review-topic"],
          { cwd: workspace.primary },
        );

        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        const writeSpy = vi
          .spyOn(artifacts, "writeTextAtomically")
          .mockRejectedValueOnce(new Error("interrupted fresh lease write"));
        const interrupted = await runPrReviewLeasesCommand(["write"]);
        expect(interrupted.exitCode).toBe(1);
        expect(interrupted.stderr).toContain("interrupted fresh lease write");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const interruptedEntries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        const interruptedArchive = interruptedEntries.find((entry) =>
          entry.includes(`-${state}-archived-lease.json`),
        );
        expect(interruptedArchive).toBeDefined();
        await expect(
          readFile(
            path.join(
              workspace.primary,
              ".ephemeral",
              interruptedArchive ?? "",
            ),
            "utf8",
          ),
        ).resolves.toBe(before);
        writeSpy.mockRestore();

        expect(await discoverPrReviewSession()).toMatchObject({
          disposition: "create",
          canonical_worktree_present: true,
          active: [
            {
              lease_file: workspace.leaseFile,
              state,
              classification: "reentry",
              worktree_dirty: false,
              unmanaged_ephemeral_artifacts: false,
            },
          ],
          resume: null,
        });

        const archivePath = path.join(
          workspace.primary,
          ".ephemeral",
          interruptedArchive ?? "",
        );
        await writeFile(archivePath, '{"collision":true}\n');
        const collision = await runPrReviewLeasesCommand(["write"]);
        expect(collision.exitCode, state).toBe(1);
        expect(collision.stderr, state).toContain("archived lease collision");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        await expect(readFile(archivePath, "utf8")).resolves.toBe(
          '{"collision":true}\n',
        );
        await writeFile(archivePath, before);

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(0);
        const fresh = await readLease(workspace.primary, workspace.leaseFile);
        expect(fresh).toMatchObject({
          state: "created",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
        });
        expect("cleanup" in fresh).toBe(false);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) =>
            entry.includes(`-${state}-archived-lease.json`),
          ),
        ).toBe(true);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("keeps noncanonical helper-recorded removed terminal leases under strict archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-noncanonical-archive-after-cleanup-",
    );

    try {
      const prior = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeApprovedReviewArtifact(
        workspace.worktree,
        prior.artifacts.approved_review_file ?? "",
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(prior, null, 2)}\n`,
      );
      await writeFile(
        path.join(workspace.primary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(cleanup.exitCode, cleanup.stderr).toBe(0);
      expect(cleanup.stdout).toContain("OUTCOME=removed");

      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "result file missing or not a regular file",
      );
      expect(
        await readdir(path.join(workspace.primary, ".ephemeral")),
      ).not.toContain(expect.stringContaining("-posted-archived-lease.json"));
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps legacy removed cleanup observations under strict archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-legacy-cleanup-authority-",
    );

    try {
      const lease = await readLease(workspace.primary, workspace.leaseFile);
      const legacy = {
        ...lease,
        state: "aborted" as const,
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
        },
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "-f", workspace.worktree],
        { cwd: workspace.primary },
      );
      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result file missing");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
      const entries = await readdir(path.join(workspace.primary, ".ephemeral"));
      expect(
        entries.some((entry) => entry.includes("-archived-lease.json")),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps post-removal metadata writes outside git-removal failure handling", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/runtime/pr-review-leases.ts"),
      "utf8",
    );
    const cleanupStart = source.indexOf("async function cleanupWorktree()");
    const cleanupEnd = source.indexOf(
      "\nfunction shouldRecordCleanupMetadata",
      cleanupStart,
    );
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    const removalCall = cleanupSource.indexOf(
      'await execFileAsync("git", args);',
    );
    const removalCatch = cleanupSource.indexOf("  } catch {", removalCall);
    const postRemovalSuccessPath = cleanupSource.indexOf(
      "\n\n  if (shouldRecordCleanupMetadata(decision)) {",
      removalCatch,
    );
    const removedMetadata = cleanupSource.indexOf(
      '"removed",\n      false,',
      postRemovalSuccessPath,
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(removalCall).toBeGreaterThan(-1);
    expect(removalCatch).toBeGreaterThan(removalCall);
    expect(postRemovalSuccessPath).toBeGreaterThan(removalCatch);
    expect(removedMetadata).toBeGreaterThan(postRemovalSuccessPath);
  });

  it("skips cleanup targets that are clean separate clones, not registered worktrees", async () => {
    const { tempRoot, primary, physicalPrimary } =
      await makeRegisteredWorkspace("pr-review-separate-clone-");
    const separateClone = path.join(tempRoot, "separate-clone");

    try {
      await execFileAsync("git", ["clone", primary, separateClone]);
      const physicalSeparateClone = await realpath(separateClone);
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalSeparateClone);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparateClone,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalSeparateClone,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for unregistered terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("retains cleanup targets when git status inspection fails", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-status-cleanup-failure-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(path.join(worktree, ".git"), {
        recursive: true,
        force: true,
      });

      process.env.LEASE_FILE = leaseFile;
      let result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("OUTCOME=inspect");

      result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=retained");
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup metadata rewrites when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("treats provider scope evidence referenced by valid result chains as owned", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-owned-provider-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).not.toContain("provider-scope-evidence.json");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup when ignored worktree ephemeral artifacts are unmanaged", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-cleanup-");
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease: PrReviewLease = {
        schema: "pr-review/lease/v1",
        repository: "owner/repo",
        pr_number: 432,
        state: "aborted",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: physicalWorktree,
        worktree_digest: dynamicIdentity.worktreeDigest,
        lease_file: leaseFile,
        created_at: "2026-06-11T00:00:00Z",
        updated_at: "2026-06-11T00:01:00Z",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        terminal: {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "user-aborted",
        },
        failure: { phase: null, reason: null, recoverability: null },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      };
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).toContain(
        "MESSAGE=unmanaged .ephemeral artifacts: .ephemeral/unmanaged.txt",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats malformed result metadata as invalid before cleanup ownership", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-owned-");
    const resultFile = ".ephemeral/pr-432-result.json";
    const findingsFile = ".ephemeral/topic-findings.json";
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");
    await writeFile(path.join(worktree, findingsFile), "{}\n");
    await writeFile(
      path.join(worktree, resultFile),
      `${JSON.stringify({
        repository: "owner/repo",
        pr_number: 432,
        review_head_sha: "1111111111111111111111111111111111111111",
        findings_file: findingsFile,
        review_body_file: null,
        context_file: null,
        artifacts: {
          handoff_file: ".ephemeral/pr-432-handoff.json",
          scope_decision_file: ".ephemeral/pr-432-scope-decision.json",
          prior_threads_file: null,
          rendered_preview_file: null,
          extra: ".ephemeral/unmanaged.txt",
        },
      })}\n`,
    );

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function setLeaseCommandEnv(primary: string, worktree: string): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = primary;
  process.env.WORKTREE_PATH = worktree;
  unsetEnv("LEASE_FILE");
  unsetEnv("RESULT_FILE");
  unsetEnv("HEAD_SHA");
}

function unsetEnv(key: (typeof managedEnvKeys)[number]): void {
  delete process.env[key];
}

async function writeLeaseCommandState({
  state,
  updatedAt,
}: {
  state: PrReviewLease["state"];
  updatedAt: string;
}): Promise<void> {
  process.env.STATE = state;
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  const result = await runPrReviewLeasesCommand(["write"]);
  expect(result.exitCode, result.stderr).toBe(0);
}

async function readLease(
  primary: string,
  leaseFile: string,
): Promise<PrReviewLease> {
  return JSON.parse(await readFile(path.join(primary, leaseFile), "utf8"));
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

type GatedStatusWorkspace = Awaited<
  ReturnType<typeof makeRegisteredWorkspace>
> & {
  leaseFile: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  reviewHead: string;
  findingsFile: string;
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
};

async function makeGatedStatusWorkspace(
  prefix: string,
  canonicalWorktree = false,
): Promise<GatedStatusWorkspace> {
  const registeredWorkspace = await makeRegisteredWorkspace(prefix);
  const workspace = canonicalWorktree
    ? await moveWorkspaceToCanonicalPath(registeredWorkspace)
    : registeredWorkspace;
  const { stdout: reviewHeadOutput } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  const reviewHead = reviewHeadOutput.trim();
  const helpers = requireSharedReviewHelpers();
  const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
  const { findingsFile } = await writeResultArtifact(
    workspace.worktree,
    workspace.physicalWorktree,
    resultFile,
    reviewHead,
    "preview-current",
    true,
  );
  const resultSha256 = await sha256File(
    path.join(workspace.worktree, resultFile),
  );
  process.chdir(workspace.physicalPrimary);
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
  expect(pathResult.exitCode).toBe(0);
  const leaseFile = pathResult.stdout.trim();
  const dynamicIdentity = identityFromLeaseFile(
    leaseFile,
    workspace.physicalWorktree,
  );
  await writeFile(
    path.join(workspace.primary, leaseFile),
    `${JSON.stringify(
      gatedCommandLease({
        leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: dynamicIdentity.worktreeDigest,
        resultFile,
        resultSha256,
      }),
      null,
      2,
    )}\n`,
  );
  return {
    ...workspace,
    leaseFile,
    worktreeDigest: dynamicIdentity.worktreeDigest,
    resultFile,
    resultSha256,
    reviewHead,
    findingsFile,
    ...helpers,
  };
}

async function moveWorkspaceToCanonicalPath<
  T extends {
    physicalPrimary: string;
    physicalWorktree: string;
    worktree: string;
  },
>(workspace: T): Promise<T> {
  const canonicalWorktree = path.join(
    workspace.physicalPrimary,
    ".worktrees",
    "pr-432-review",
  );
  await mkdir(path.dirname(canonicalWorktree), { recursive: true });
  await execFileAsync("git", [
    "-C",
    workspace.physicalPrimary,
    "worktree",
    "move",
    workspace.physicalWorktree,
    canonicalWorktree,
  ]);
  return {
    ...workspace,
    worktree: canonicalWorktree,
    physicalWorktree: await realpath(canonicalWorktree),
  };
}

function setReadStatusEnv(workspace: GatedStatusWorkspace): void {
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  setHelperAuthorityEnv({
    prReviewDir: workspace.prReviewDir,
    prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
    prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
    playReviewHelper: workspace.playReviewHelper,
  });
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.HEAD_SHA = workspace.reviewHead;
}

function setAuditFailureEnv(
  workspace: GatedStatusWorkspace,
  updatedAt: string,
): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalPrimary;
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.STATE = "failed";
  process.env.EXPECTED_STATE = "gated";
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.FINISHED_AT = updatedAt;
  process.env.FAILURE_PHASE = "preview-render";
  process.env.FAILURE_REASON = "audit summary render failed";
  process.env.FAILURE_RECOVERABILITY = "recoverable";
  process.env.PR_REVIEW_DIR = workspace.prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
    workspace.prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
    workspace.prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;
}

function setHelperAuthorityEnv({
  prReviewDir,
  prReviewManifestHelperScript,
  prReviewLeaseHelperScript,
  playReviewHelper,
}: {
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}): void {
  process.env.PR_REVIEW_DIR = prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = playReviewHelper;
}

async function mutateLease(
  workspace: GatedStatusWorkspace,
  mutate: (lease: PrReviewLease) => void,
): Promise<void> {
  const lease = await readLease(workspace.primary, workspace.leaseFile);
  mutate(lease);
  await writeFile(
    path.join(workspace.primary, workspace.leaseFile),
    `${JSON.stringify(lease, null, 2)}\n`,
  );
}

async function mutateNestedFindingsWithoutUpdatingResult(
  workspace: GatedStatusWorkspace,
): Promise<void> {
  await writeFile(
    path.join(workspace.worktree, workspace.findingsFile),
    `${JSON.stringify(
      {
        schema: "play-review/findings/v2",
        findings: [{ stale: true }],
        carry_forward: [],
      },
      null,
      2,
    )}\n`,
  );
}

async function makeLeaseWorkspace(_prefix: string): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  return commandHarness.createPlainReviewWorkspace();
}

async function makeResultAuthorityWorkspace(prefix: string): Promise<
  Awaited<ReturnType<typeof makeRegisteredWorkspace>> & {
    reviewHead: string;
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  }
> {
  const workspace = await makeRegisteredWorkspace(prefix);
  const { stdout } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  return {
    ...workspace,
    reviewHead: stdout.trim(),
    ...requireSharedReviewHelpers(),
  };
}

async function makeRegisteredWorkspace(prefix: string): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  void prefix;
  return commandHarness.createRegisteredReviewWorkspace("review-topic");
}

function requireSharedReviewHelpers(): NonNullable<typeof sharedReviewHelpers> {
  if (sharedReviewHelpers === null) {
    throw new Error("shared PR-review helpers are not initialized");
  }
  return sharedReviewHelpers;
}

function identityFromLeaseFile(
  leaseFile: string,
  worktreePath: string,
): typeof identity {
  const match = /^\.ephemeral\/pr-432-([0-9a-f]{64})-lease\.json$/u.exec(
    leaseFile,
  );
  if (match === null) {
    throw new Error(`unexpected lease path: ${leaseFile}`);
  }
  return {
    ...identity,
    worktreePath,
    worktreeDigest: match[1],
    leaseFile,
  };
}

function discoveryWorktreeDigest(worktreePath: string): string {
  const normalized = worktreePath.replace(/\\/gu, "/");
  const comparable = /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
  return createHash("sha256").update(comparable).digest("hex");
}

function abortedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "aborted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: null,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: { status: null, validated_at: null, sha256: null },
    },
    presentation: { presented_at: null, status: null },
    terminal: {
      finished_at: "2026-06-11T00:01:00Z",
      reason: "user-aborted",
    },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function postedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
  approvedReviewFile,
  validatedPayloadFile = null,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  approvedReviewFile: string;
  validatedPayloadFile?: string | null;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "posted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:03:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: approvedReviewFile,
      validated_payload_file: validatedPayloadFile,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: "2026-06-11T00:03:00Z", reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: true,
      github_post_result: "succeeded",
      github_posted_at: "2026-06-11T00:03:00Z",
    },
  };
}

async function writeReviewHelperScripts(tempRoot: string): Promise<{
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}> {
  const skillsRoot = path.join(tempRoot, "skills");
  const prReviewDir = path.join(skillsRoot, "pr-review");
  const prReviewScripts = path.join(prReviewDir, "scripts");
  const playReviewScripts = path.join(skillsRoot, "play-review", "scripts");
  await mkdir(prReviewScripts, { recursive: true });
  await mkdir(playReviewScripts, { recursive: true });
  const scopeHelper = path.join(prReviewScripts, "prior-thread-artifacts.sh");
  const prReviewManifestHelperScript = path.join(
    prReviewScripts,
    "review-manifests.sh",
  );
  const prReviewLeaseHelperScript = path.join(
    prReviewScripts,
    "review-leases.sh",
  );
  const playReviewHelper = path.join(playReviewScripts, "review-artifacts.sh");
  const passThrough = "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n";
  const approvedReviewHelper = path.join(
    prReviewScripts,
    "approved-review-artifacts.sh",
  );
  await writeFile(scopeHelper, passThrough);
  await writeFile(prReviewManifestHelperScript, passThrough);
  await writeFile(prReviewLeaseHelperScript, passThrough);
  await writeFile(
    approvedReviewHelper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'command_name="${1:-}"',
      'if [ "$command_name" = "inspect-approved-review-ownership" ]; then',
      '  jq -cn --arg review_body_file ".ephemeral/pr-${PR_NUMBER}-${HEAD_SHA}-review-body.md" --arg review_payload_file ".ephemeral/review-topic-${HEAD_SHA}-review-payload.json" \'{review_body_file: $review_body_file, review_payload_file: $review_payload_file}\'',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await writeFile(playReviewHelper, passThrough);
  await chmod(scopeHelper, 0o755);
  await chmod(prReviewManifestHelperScript, 0o755);
  await chmod(prReviewLeaseHelperScript, 0o755);
  await chmod(approvedReviewHelper, 0o755);
  await chmod(playReviewHelper, 0o755);
  return {
    prReviewDir,
    prReviewManifestHelperScript,
    prReviewLeaseHelperScript,
    playReviewHelper,
  };
}

async function writeResultArtifact(
  worktree: string,
  physicalWorktree: string,
  resultFile: string,
  reviewHead: string,
  presentationStatus:
    | "not-presented"
    | "preview-current"
    | "edited" = "preview-current",
  includeSharedContext = false,
): Promise<{ findingsFile: string }> {
  const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;
  const findingsFile = `.ephemeral/review-topic-${reviewHead}-findings.json`;
  const reviewBodyFile = `.ephemeral/pr-432-${reviewHead}-review-body.md`;
  const scopeDecisionFile = ".ephemeral/review-topic-scope-decision.json";
  const providerScopeEvidenceFile = `.ephemeral/review-topic-${reviewHead}-provider-scope-evidence.json`;
  const providerPrDiffRange = `${reviewHead}..${reviewHead}`;
  await writeFile(
    path.join(worktree, providerScopeEvidenceFile),
    `${JSON.stringify(
      {
        schema: "pr-review/provider-scope-evidence/v2",
        provider: "github",
        repository: "owner/repo",
        pr_number: 432,
        baseRefOid: reviewHead,
        headRefOid: reviewHead,
        provider_pr_diff_base_sha: reviewHead,
        local_review_head_sha: reviewHead,
        full_pr_diff_range: providerPrDiffRange,
        evidence_complete: true,
        digest_provenance: {
          schema: "pr-review/digest-provenance/v1",
          provider_diff: "canonical-git-diff/v1",
          local_diff: "canonical-git-diff/v1",
          provider_patches: "canonical-git-diff/v1",
          local_patches: "canonical-git-diff/v1",
        },
        provider_files: [],
        local_files: [],
        provider_diff_sha256: "0".repeat(64),
        local_diff_sha256: "0".repeat(64),
      },
      null,
      2,
    )}\n`,
  );
  const providerScopeEvidenceSha256 = await sha256File(
    path.join(worktree, providerScopeEvidenceFile),
  );
  const scopeDecision = {
    head_sha: reviewHead,
    selected_range: providerPrDiffRange,
    full_range: providerPrDiffRange,
    language_hints: [],
    mode: "initial",
    is_followup_narrow: false,
    last_reviewed_sha: null,
    selection_reason: "Initial review scope.",
    prior_context: { kind: "none", path: null },
    artifacts: {
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, scopeDecisionFile),
    `${JSON.stringify(scopeDecision, null, 2)}\n`,
  );
  await writeFile(
    path.join(worktree, findingsFile),
    `${JSON.stringify({ findings: [], carry_forward: [] }, null, 2)}\n`,
  );
  await writeFile(path.join(worktree, reviewBodyFile), "Review preview.\n");
  const sharedContext = includeSharedContext
    ? await writeSharedContextFamily(
        physicalWorktree,
        findingsFile,
        reviewHead,
        providerPrDiffRange,
      )
    : null;
  const handoff = {
    schema: "pr-review/handoff/v1",
    pr_number: 432,
    repository: "owner/repo",
    execution: {
      kind: "review-worktree",
      working_directory: physicalWorktree,
    },
    base_ref: "main",
    head_ref: "topic",
    review_scope_base_ref: reviewHead,
    active_diff_range: providerPrDiffRange,
    full_pr_diff_range: providerPrDiffRange,
    review_head_sha: reviewHead,
    mode: "github-post",
    language_hints: [],
    follow_up: {
      state: "initial",
      last_reviewed_sha: null,
      is_followup_narrow: false,
    },
    artifacts: {
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, handoffFile),
    `${JSON.stringify(handoff, null, 2)}\n`,
  );
  const result = {
    schema: "pr-review/result/v1",
    repository: "owner/repo",
    pr_number: 432,
    review_head_sha: reviewHead,
    findings_file: findingsFile,
    review_body_file: reviewBodyFile,
    context_file: sharedContext?.contextFile ?? null,
    artifacts: {
      handoff_file: handoffFile,
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      rendered_preview_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
    },
    digests: {
      handoff_sha256: await sha256File(path.join(worktree, handoffFile)),
      findings_sha256: await sha256File(path.join(worktree, findingsFile)),
      review_body_sha256: await sha256File(path.join(worktree, reviewBodyFile)),
      context_sha256: sharedContext?.contextSha256 ?? null,
      scope_decision_sha256: await sha256File(
        path.join(worktree, scopeDecisionFile),
      ),
      prior_threads_sha256: null,
      rendered_preview_sha256: null,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
    scope_decision: {
      summary: "Initial review scope.",
      selected_range: providerPrDiffRange,
      full_range: providerPrDiffRange,
      is_followup_narrow: false,
    },
    presentation: { status: presentationStatus, notes: null },
    validation: {
      status: "valid",
      findings_validated: true,
      scope_decision_validated: true,
    },
  };
  await writeFile(
    path.join(worktree, resultFile),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { findingsFile };
}

async function writeSharedContextFamily(
  physicalWorktree: string,
  findingsFile: string,
  reviewHead: string,
  diffRange: string,
): Promise<{ contextFile: string; contextSha256: string }> {
  const priorCwd = process.cwd();
  const contextEnv = [
    "HEAD_SHA",
    "FINDINGS_FILE",
    "REVIEW_CONTEXT_INPUT_FILE",
    "REVIEW_CONTEXT_INPUT_JSON",
  ] as const;
  const priorEnv = new Map(contextEnv.map((key) => [key, process.env[key]]));

  try {
    process.chdir(physicalWorktree);
    process.env.HEAD_SHA = reviewHead;
    process.env.FINDINGS_FILE = findingsFile;
    process.env.REVIEW_CONTEXT_INPUT_JSON = JSON.stringify({
      schema: "play-review/shared-context-input/v1",
      header: {
        working_directory: physicalWorktree,
        base_ref: "main",
        head_sha: reviewHead,
        active_diff_range: diffRange,
        full_pr_diff_range: diffRange,
        mode: "github-post",
        language_hints: [],
      },
      changed_files: {
        command: "fixture",
        total_count: 0,
        truncated: false,
        records: [],
      },
      doc_impact_summary: {
        arch_files: [],
        new_adrs: [],
        modified_adrs: [],
        architecture_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        spec_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        notes: "fixture",
      },
      adr_references: [],
      discovered_guidelines: { records: [] },
      output_format: { markdown: "fixture" },
      prior_review_context: null,
    });
    const input = await runPlayReviewSharedContextCommand([
      "write-review-context-input",
    ]);
    if (input.exitCode !== 0) {
      throw new Error(input.stderr);
    }
    process.env.REVIEW_CONTEXT_INPUT_FILE = input.stdout.trim();
    const output = await runPlayReviewSharedContextCommand([
      "build-review-context",
    ]);
    if (output.exitCode !== 0) {
      throw new Error(output.stderr);
    }
    const contextFile = output.stdout.trim();
    return {
      contextFile,
      contextSha256: await sha256File(path.join(physicalWorktree, contextFile)),
    };
  } finally {
    process.chdir(priorCwd);
    for (const [key, value] of priorEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function writeApprovedReviewArtifact(
  worktree: string,
  approvedReviewFile: string,
  reviewHead: string,
): Promise<void> {
  await writeFile(
    path.join(worktree, approvedReviewFile),
    `${JSON.stringify({
      schema: "pr-review/approved-review/v1",
      review_head_sha: reviewHead,
      review_body_file: `.ephemeral/pr-432-${reviewHead}-review-body.md`,
      payload: reviewPayload(reviewHead),
    })}\n`,
  );
}

async function writeValidatedPayloadArtifact(
  worktree: string,
  reviewHead: string,
): Promise<string> {
  const validatedPayloadFile = `.ephemeral/pr-432-${reviewHead}-validated-review-payload.json`;
  await writeFile(
    path.join(worktree, validatedPayloadFile),
    `${JSON.stringify(reviewPayload(reviewHead))}\n`,
  );
  return validatedPayloadFile;
}

function reviewPayload(reviewHead: string): Record<string, unknown> {
  return {
    commit_id: reviewHead,
    event: "COMMENT",
    body: "Review body\n",
    comments: [],
  };
}

function omitKey<T extends object, K extends keyof T>(
  object: T,
  key: K,
): Omit<T, K> {
  const { [key]: _omitted, ...rest } = object;
  return rest;
}

function reviewedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
  resultFile: string,
  resultSha256: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "reviewed",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:01:00Z",
        sha256: resultSha256,
      },
    },
    presentation: { presented_at: null, status: null },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function gatedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "gated",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: worktreePath,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:02:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

describe("pr-review lease wrapper trusted runtime bootstrap", () => {
  const wrapper = path.resolve("skills/pr-review/scripts/review-leases.sh");

  async function writeRuntime(
    root: string,
    directoryName: string,
  ): Promise<{
    runtimeDir: string;
    resolverSentinel: string;
    typedSentinel: string;
  }> {
    const runtimeDir = path.join(root, directoryName);
    const scriptsDir = path.join(runtimeDir, "scripts");
    const typedRuntimeDir = path.join(scriptsDir, "runtime");
    const resolverSentinel = path.join(
      root,
      `${directoryName.length}-resolver-executed`,
    );
    const typedSentinel = path.join(
      root,
      `${directoryName.length}-typed-executed`,
    );
    await mkdir(typedRuntimeDir, { recursive: true });
    const resolver = path.join(scriptsDir, "devcanon-runtime.sh");
    await writeFile(
      resolver,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'case "${1:-}" in',
        "  runtime)",
        "    printf 'executed\\n' >\"$DEVCANON_TEST_RESOLVER_SENTINEL\"",
        "    printf 'runtime-ok\\n'",
        "    ;;",
        "  *) exit 64 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(resolver, 0o755);
    await writeFile(
      path.join(typedRuntimeDir, "cli.js"),
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.DEVCANON_TEST_TYPED_SENTINEL, "executed\\n");',
        'process.stdout.write("runtime-ok\\n");',
        "",
      ].join("\n"),
    );
    return { runtimeDir, resolverSentinel, typedSentinel };
  }

  async function runWrapper(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { exitCode, stdout, stderr } = await commandHarness.run(
      bashExecutable,
      [wrapper, "derive-path"],
      {
        env: {
          ...process.env,
          DEVCANON_RUNTIME_DIR: runtimeDir,
          DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
          DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
        },
        acceptedExitCodes: [0, 1],
      },
    );
    return { exitCode, stdout, stderr };
  }

  async function expectAccepted(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: "runtime-ok\n",
      stderr: "",
    });
    const executedSentinel =
      process.platform === "win32" ? typedSentinel : resolverSentinel;
    const idleSentinel =
      process.platform === "win32" ? resolverSentinel : typedSentinel;
    expect(await readFile(executedSentinel, "utf8")).toBe("executed\n");
    await expect(readFile(idleSentinel, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(executedSentinel);
  }

  async function expectRejected(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    expectedStderr: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${expectedStderr}\n`,
    });
    for (const sentinel of [resolverSentinel, typedSentinel]) {
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  }

  it.runIf(process.platform !== "win32")(
    "preserves POSIX backslashes, line feeds, and valid dot aliases despite a poisoned OSTYPE",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const ordinary = await writeRuntime(root, "ordinary-runtime");
        await expectAccepted(
          ordinary.runtimeDir,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );
        await expectAccepted(
          `${ordinary.runtimeDir}/.`,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );

        const literalBackslashes = await writeRuntime(
          root,
          "literal\\..\\runtime",
        );
        await expectAccepted(
          literalBackslashes.runtimeDir,
          literalBackslashes.resolverSentinel,
          literalBackslashes.typedSentinel,
        );

        const lineFeed = await writeRuntime(root, "line-feed-runtime\n");
        await expectAccepted(
          lineFeed.runtimeDir,
          lineFeed.resolverSentinel,
          lineFeed.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects POSIX traversal and final symlink aliases before resolver execution",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const target = await writeRuntime(root, "target-runtime");
        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(target.runtimeDir, linkedRuntime);
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          linkedRuntime,
          `${linkedRuntime}/`,
          `${linkedRuntime}/.`,
        ]) {
          await expectRejected(
            spelling,
            target.resolverSentinel,
            target.typedSentinel,
            containmentError,
          );
        }
        await expectRejected(
          `${linkedRuntime}/scripts/..`,
          target.resolverSentinel,
          target.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "preserves the logical macOS /var ancestor alias",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const logicalRoot = root.startsWith("/private/var/")
          ? root.replace(/^\/private\/var\//u, "/var/")
          : root;
        const logicalRuntime = path.join(logicalRoot, "runtime");
        await expectAccepted(
          logicalRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "uses Git-for-Windows Bash capability for native and mixed-separator containment",
    async () => {
      const bashExecutable = await resolveGitForWindowsBash();
      const { stdout: windowsPwd } = await execFileAsync(bashExecutable, [
        "-lc",
        "builtin pwd -W",
      ]);
      expect(Buffer.byteLength(windowsPwd, "utf8")).toBeLessThanOrEqual(65_536);
      const windowsPwdRecord = /^([^\r\n]+)\r?\n$/u.exec(windowsPwd);
      expect(windowsPwdRecord).not.toBeNull();
      const reportedWindowsCwd = windowsPwdRecord?.[1] ?? "";
      expect(path.win32.isAbsolute(reportedWindowsCwd)).toBe(true);
      expect(path.win32.normalize(reportedWindowsCwd).toLowerCase()).toBe(
        path.win32.normalize(process.cwd()).toLowerCase(),
      );

      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        await expectAccepted(
          native,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
        await expectAccepted(
          `${native}\\.`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );

        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(fixture.runtimeDir, linkedRuntime, "junction");
        const { stdout: nativeLinkOutput } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: linkedRuntime,
            },
          },
        );
        const nativeLink = nativeLinkOutput.trim();
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          nativeLink,
          `${nativeLink}\\`,
          `${nativeLink}\\.`,
          `${nativeLink.replace(/\\/gu, "/")}\\`,
        ]) {
          await expectRejected(
            spelling,
            fixture.resolverSentinel,
            fixture.typedSentinel,
            containmentError,
            bashExecutable,
          );
        }
        await expectRejected(
          `${nativeLink}\\scripts/..`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
        await expectRejected(
          "\\\\?\\UNC\\localhost\\unavailable\\linked\\scripts\\..",
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "runs URL-representable real UNC runtime containment or reports the unavailable capability",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const computerName = process.env.COMPUTERNAME?.trim() ?? "";
        if (
          computerName.length === 0 ||
          computerName.toLowerCase() === "localhost"
        ) {
          skip(
            "UNC runtime integration unavailable: COMPUTERNAME does not provide a non-special host",
          );
        }
        const uncRuntime = `\\\\${computerName}\\${drive}$${native.slice(2)}`;
        try {
          await realpath(uncRuntime);
        } catch {
          skip(
            "UNC runtime integration unavailable: machine-name administrative drive share is not accessible",
          );
        }
        const physicalTypedEntrypoint = await realpath(
          path.win32.join(uncRuntime, "scripts", "runtime", "cli.js"),
        );
        const typedEntrypointUrl = pathToFileURL(physicalTypedEntrypoint);
        expect(typedEntrypointUrl.hostname.toLowerCase()).toBe(
          computerName.toLowerCase(),
        );
        expect(
          path.win32.normalize(fileURLToPath(typedEntrypointUrl)).toLowerCase(),
        ).toBe(path.win32.normalize(physicalTypedEntrypoint).toLowerCase());
        await expectAccepted(
          uncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects an accessible localhost UNC runtime before resolver or typed entrypoint execution",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const localhostUncRuntime = `\\\\localhost\\${drive}$${native.slice(2)}`;
        try {
          await realpath(localhostUncRuntime);
        } catch {
          skip(
            "localhost UNC rejection unavailable: localhost administrative drive share is not accessible",
          );
        }
        await expectRejected(
          localhostUncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "devcanon-runtime typed entrypoint is not representable as a Windows file URL",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
