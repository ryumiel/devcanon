import * as fsPromises from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPrReviewLeaseFixtures } from "../__test-helpers__/pr-review-lease-fixtures.js";
import type { PrReviewLease } from "./pr-review-leases.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: vi.fn(actual.link),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
    writeFile: vi.fn(actual.writeFile),
  };
});

const {
  execFileAsync,
  rm,
  runPrReviewLeasesCommand,
  discoverPrReviewSession,
  readLease,
  sha256File,
  makeGatedStatusWorkspace,
  setReadStatusEnv,
  discoveryWorktreeDigest,
  abortedCommandLease,
  makeTerminalAdvanceRefusalFixture,
  addAmbiguousTerminalCandidate,
  setTerminalAdvanceEnv,
  expectTerminalAdvanceUnchanged,
  postedCommandLease,
  writeResultArtifact,
  writeApprovedReviewArtifact,
  writeValidatedPayloadArtifact,
  reviewPayload,
  commandHarness,
  originalCwd,
} = createPrReviewLeaseFixtures();

describe("pr-review lease command validation", () => {
  it("leaves retained terminals unchanged without exact terminal-advance opt-in", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    try {
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );
      Reflect.deleteProperty(process.env, "ALLOW_TERMINAL_ADVANCE");
      await expectTerminalAdvanceUnchanged(
        fixture,
        await runPrReviewLeasesCommand(["session-create"]),
      );
      process.env.ALLOW_TERMINAL_ADVANCE = "true";
      await expectTerminalAdvanceUnchanged(
        fixture,
        await runPrReviewLeasesCommand(["session-create"]),
        "ALLOW_TERMINAL_ADVANCE must be yes when supplied",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it("advances a complete posted artifact family without retaining unmanaged evidence", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-advance-posted-",
      true,
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const validatedPayloadFile = await writeValidatedPayloadArtifact(
      workspace.worktree,
      workspace.reviewHead,
    );
    const reviewPayloadFile = `.ephemeral/review-topic-${workspace.reviewHead}-review-payload.json`;

    try {
      await writeFile(
        path.join(workspace.physicalPrimary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      await execFileAsync("git", [
        "-C",
        workspace.worktree,
        "checkout",
        "--detach",
        workspace.reviewHead,
      ]);
      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
        true,
        "detached",
      );
      await Promise.all(
        [
          workspace.findingsFile,
          workspace.findingsFile.replace(
            "-findings.json",
            "-review-context-input.json",
          ),
          workspace.findingsFile.replace(
            "-findings.json",
            "-review-context.md",
          ),
        ].map((file) => rm(path.join(workspace.worktree, file))),
      );
      const inputFile = `.ephemeral/detached-${workspace.reviewHead}-review-context-input.json`;
      const contextFile = `.ephemeral/detached-${workspace.reviewHead}-review-context.md`;
      const detachedFindingsFile = `.ephemeral/detached-${workspace.reviewHead}-findings.json`;
      const contextInput = JSON.parse(
        await readFile(path.join(workspace.worktree, inputFile), "utf8"),
      );
      const originalDocBytes = Buffer.byteLength(
        await readFile(path.join(workspace.worktree, "README.md")),
      );
      contextInput.prior_review_context = {
        records: [
          {
            source: {
              kind: "verified-repository-doc-navigation",
              reference: "README.md",
            },
            bytes: originalDocBytes,
            summary: `head:${workspace.reviewHead}; side:head; verified read`,
            untrusted: true,
          },
          {
            source: { kind: "github-review-thread", reference: "README.md" },
            bytes: originalDocBytes,
            summary: "Earlier review prose is ordinary untrusted context.",
            untrusted: true,
          },
        ],
      };
      await writeFile(
        path.join(workspace.worktree, inputFile),
        `${JSON.stringify(contextInput)}\n`,
      );
      const helperScript = path.join(
        originalCwd,
        "skills/play-review/scripts/shared-review-context.sh",
      );
      const helperEnv = {
        ...process.env,
        DEVCANON_RUNTIME_DIR: path.join(originalCwd, "skills/devcanon-runtime"),
        HEAD_SHA: workspace.reviewHead,
        FINDINGS_FILE: detachedFindingsFile,
        REVIEW_CONTEXT_INPUT_FILE: inputFile,
        REVIEW_CONTEXT_OUTPUT_FILE: contextFile,
      };
      await execFileAsync("bash", [helperScript, "build-review-context"], {
        cwd: workspace.worktree,
        env: helperEnv,
      });
      const { stdout: bindingJson } = await execFileAsync(
        "bash",
        [helperScript, "create-family-binding"],
        { cwd: workspace.worktree, env: helperEnv },
      );
      const family = JSON.parse(bindingJson);
      const { stdout: validatedJson } = await execFileAsync(
        "bash",
        [helperScript, "validate-family-binding"],
        {
          cwd: workspace.worktree,
          env: { ...helperEnv, REVIEW_CONTEXT_FAMILY_JSON: bindingJson.trim() },
        },
      );
      expect(JSON.parse(validatedJson)).toEqual(family);
      const detachedNavigation =
        contextInput.prior_review_context.records.filter(
          (record: { source: { kind: string } }) =>
            record.source.kind === "verified-repository-doc-navigation",
        );
      const resultArtifact = JSON.parse(
        await readFile(
          path.join(workspace.worktree, workspace.resultFile),
          "utf8",
        ),
      );
      resultArtifact.digests.context_sha256 = await sha256File(
        path.join(workspace.worktree, contextFile),
      );
      await writeFile(
        path.join(workspace.worktree, workspace.resultFile),
        `${JSON.stringify(resultArtifact, null, 2)}\n`,
      );
      const resultSha256 = await sha256File(
        path.join(workspace.worktree, workspace.resultFile),
      );
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      await writeFile(
        path.join(workspace.worktree, reviewPayloadFile),
        `${JSON.stringify(reviewPayload(workspace.reviewHead))}\n`,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      const oldLeaseBytes = `${JSON.stringify(posted, null, 2)}\n`;
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        oldLeaseBytes,
      );
      await writeFile(path.join(workspace.primary, "next.txt"), "next\n");
      await writeFile(
        path.join(workspace.primary, "README.md"),
        "baseline\nnext.txt records the next review marker: next.\n",
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "add",
        "next.txt",
        "README.md",
      ]);
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "commit",
        "-m",
        "next head",
      ]);
      const { stdout: newHeadOutput } = await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "rev-parse",
        "HEAD",
      ]);
      const newHead = newHeadOutput.trim();
      const diagnosticsDirectory = path.join(
        workspace.physicalPrimary,
        ".ephemeral",
        "pr-432-controller-diagnostics-advance-run",
      );
      await mkdir(diagnosticsDirectory);
      const diagnosticsFile = path.join(
        diagnosticsDirectory,
        "terminal-report.txt",
      );
      const diagnosticBytes = "terminal report before advancement\n";
      await writeFile(diagnosticsFile, diagnosticBytes);
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      Object.assign(process.env, {
        HEAD_SHA: newHead,
        BASE_REF: "main",
        HEAD_REF: "topic",
        UPDATED_AT: "2026-07-31T00:00:00Z",
        ALLOW_TERMINAL_ADVANCE: "yes",
      });

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_present: true,
        active: [
          {
            lease_file: workspace.leaseFile,
            worktree_path: workspace.physicalWorktree,
            classification: "terminal",
            state: "posted",
            worktree_dirty: false,
            unmanaged_ephemeral_artifacts: false,
          },
        ],
      });
      const validation = await runPrReviewLeasesCommand(["validate"]);
      expect(validation.exitCode, validation.stderr).toBe(0);

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(result.exitCode, `${result.stdout}${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "success",
        canonical_worktree_path: workspace.physicalWorktree,
        immutable_head: newHead,
        lease_file: workspace.leaseFile,
      });
      await expect(readFile(diagnosticsFile, "utf8")).resolves.toBe(
        diagnosticBytes,
      );
      expect(await readLease(workspace.primary, workspace.leaseFile)).toEqual({
        schema: "pr-review/lease/v1",
        repository: "owner/repo",
        pr_number: 432,
        state: "created",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: workspace.physicalWorktree,
        worktree_digest: workspace.worktreeDigest,
        lease_file: workspace.leaseFile,
        created_at: "2026-07-31T00:00:00Z",
        updated_at: "2026-07-31T00:00:00Z",
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
      });
      await expect(
        readdir(path.join(workspace.worktree, ".ephemeral")),
      ).resolves.toEqual([]);
      expect(detachedNavigation).toEqual([
        {
          source: {
            kind: "verified-repository-doc-navigation",
            reference: "README.md",
          },
          bytes: originalDocBytes,
          summary: `head:${workspace.reviewHead}; side:head; verified read`,
          untrusted: true,
        },
      ]);
      expect(family.input_file).toBe(inputFile);
      await expect(
        lstat(path.join(workspace.worktree, inputFile)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        lstat(path.join(workspace.worktree, contextFile)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const { stdout: currentRead } = await execFileAsync("git", [
        "-C",
        workspace.worktree,
        "show",
        `${newHead}:README.md`,
      ]);
      expect(currentRead).toBe(
        await readFile(path.join(workspace.worktree, "README.md"), "utf8"),
      );
      expect(currentRead).toContain("next.txt records the next review marker");
      await expect(
        execFileAsync("git", ["-C", workspace.worktree, "rev-parse", "HEAD"]),
      ).resolves.toMatchObject({ stdout: `${newHead}\n` });
      await expect(
        readFile(
          path.join(
            workspace.primary,
            `.ephemeral/pr-432-${workspace.worktreeDigest}-20260611T000300-posted-archived-lease.json`,
          ),
          "utf8",
        ),
      ).resolves.toBe(oldLeaseBytes);
      await expect(
        lstat(
          path.join(
            workspace.primary,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("retains changed terminal artifacts and the reservation after head advancement", async () => {
    const repository = await commandHarness.createReviewRepository();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    await mkdir(path.dirname(canonical), { recursive: true });
    const { stdout: oldHeadOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const oldHead = oldHeadOutput.trim();
    await writeFile(
      path.join(repository.physicalRepository, ".git", "info", "exclude"),
      ".ephemeral/\n",
    );
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "worktree",
      "add",
      "--detach",
      canonical,
      oldHead,
    ]);
    const worktreeDigest = discoveryWorktreeDigest(canonical);
    const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
    const handoffFile = ".ephemeral/pr-432-retained-handoff.json";
    const oldLease = abortedCommandLease(leaseFile, canonical, worktreeDigest);
    oldLease.artifacts.handoff_file = handoffFile;
    await mkdir(path.join(repository.physicalRepository, ".ephemeral"), {
      recursive: true,
    });
    await writeFile(
      path.join(repository.physicalRepository, leaseFile),
      `${JSON.stringify(oldLease, null, 2)}\n`,
    );
    const oldLeaseBytes = await readFile(
      path.join(repository.physicalRepository, leaseFile),
    );
    await mkdir(path.join(canonical, ".ephemeral"), { recursive: true });
    await writeFile(
      path.join(canonical, handoffFile),
      `${JSON.stringify({ repository: "owner/repo", pr_number: 432, base_ref: "main", head_ref: "topic" })}\n`,
    );
    await writeFile(
      path.join(repository.physicalRepository, "next.txt"),
      "next\n",
    );
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "add",
      "next.txt",
    ]);
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "commit",
      "-m",
      "next head",
    ]);
    const { stdout: newHeadOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const newHead = newHeadOutput.trim();
    const hookPath = path.join(
      repository.physicalRepository,
      ".git",
      "hooks",
      "post-checkout",
    );
    await writeFile(
      hookPath,
      [
        "#!/bin/sh",
        'worktree_root="$(git rev-parse --show-toplevel)"',
        `printf '%s\\n' changed >"$worktree_root/${handoffFile}"`,
        "",
      ].join("\n"),
    );
    await chmod(hookPath, 0o755);
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: newHead,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
      ALLOW_TERMINAL_ADVANCE: "yes",
    });

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: "manual-cleanup",
      reason: "rollback-incomplete",
      immutable_head: newHead,
    });
    expect(
      await readFile(path.join(repository.physicalRepository, leaseFile)),
    ).toEqual(oldLeaseBytes);
    await expect(
      readFile(path.join(canonical, handoffFile), "utf8"),
    ).resolves.toBe("changed\n");
    await expect(
      lstat(
        path.join(
          repository.physicalRepository,
          ".ephemeral/pr-432-session-create-reservation.json",
        ),
      ),
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
    const token = JSON.parse(result.stdout).invocation_token;
    const held = await runPrReviewLeasesCommand([
      "session-reconcile",
      "--invocation-token",
      token,
    ]);
    expect(held.exitCode).toBe(1);
    expect(await readFile(path.join(canonical, handoffFile), "utf8")).toBe(
      "changed\n",
    );
    await writeFile(
      path.join(canonical, handoffFile),
      `${JSON.stringify({ repository: "owner/repo", pr_number: 432, base_ref: "main", head_ref: "topic" })}\n`,
    );
    const resumed = await runPrReviewLeasesCommand([
      "session-reconcile",
      "--invocation-token",
      token,
    ]);
    expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      outcome: "success",
      immutable_head: newHead,
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(repository.physicalRepository, leaseFile),
          "utf8",
        ),
      ),
    ).toMatchObject({
      state: "created",
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
    });
    expect(
      (
        await runPrReviewLeasesCommand([
          "session-reconcile",
          "--invocation-token",
          token,
        ])
      ).exitCode,
    ).toBe(0);
  });

  it.each(["unknown", "replaced", "absent"] as const)(
    "validates original targets after synchronous checkout hook: %s",
    async (effect) => {
      const fixture = await makeTerminalAdvanceRefusalFixture({
        canonical: true,
      });
      const primary = fixture.repository.physicalRepository;
      const originalTarget = path.join(fixture.worktree, fixture.handoffFile);
      const originalIdentity = await lstat(originalTarget);
      const parked = path.join(primary, ".ephemeral/parked-hook-original.json");
      const unknown = path.join(
        fixture.worktree,
        ".ephemeral/hook-unknown.json",
      );
      const hookPath = path.join(primary, ".git/hooks/post-checkout");
      const command =
        effect === "unknown"
          ? `printf '%s\\n' foreign >"$worktree_root/.ephemeral/hook-unknown.json"`
          : effect === "replaced"
            ? `mv "$worktree_root/${fixture.handoffFile}" "$PRIMARY_REPOSITORY_ROOT/.ephemeral/parked-hook-original.json"\ncp "$PRIMARY_REPOSITORY_ROOT/.ephemeral/parked-hook-original.json" "$worktree_root/${fixture.handoffFile}"`
            : `rm "$worktree_root/${fixture.handoffFile}"`;
      await writeFile(
        hookPath,
        [
          "#!/bin/sh",
          'worktree_root="$(git rev-parse --show-toplevel)"',
          command,
          "",
        ].join("\n"),
      );
      await chmod(hookPath, 0o755);
      process.chdir(primary);
      setTerminalAdvanceEnv(primary, fixture.newHead);
      const result = await runPrReviewLeasesCommand(["session-create"]);
      expect(
        (
          await execFileAsync("git", [
            "-C",
            fixture.worktree,
            "rev-parse",
            "HEAD",
          ])
        ).stdout.trim(),
      ).toBe(fixture.newHead);
      const archivePath = path.join(primary, ".ephemeral", fixture.archiveName);
      expect(await readFile(archivePath, "utf8")).toBe(fixture.leaseBytes);
      if (effect === "absent") {
        expect(result.exitCode, result.stderr + result.stdout).toBe(0);
        expect(
          JSON.parse(await readFile(fixture.leasePath, "utf8")).state,
        ).toBe("created");
        await expect(lstat(originalTarget)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        expect(JSON.parse(result.stdout)).toMatchObject({
          outcome: "manual-cleanup",
          reason: "rollback-incomplete",
          immutable_head: fixture.newHead,
        });
        expect(await readFile(fixture.leasePath, "utf8")).toBe(
          fixture.leaseBytes,
        );
        expect(await readFile(originalTarget, "utf8")).toBe(
          fixture.handoffBytes,
        );
        const reservationPath = path.join(
          primary,
          ".ephemeral/pr-432-session-create-reservation.json",
        );
        const reservation = JSON.parse(await readFile(reservationPath, "utf8"));
        const intent = JSON.parse(
          await readFile(
            path.join(
              primary,
              `.ephemeral/pr-432-session-advance-${reservation.invocation_token}.json`,
            ),
            "utf8",
          ),
        );
        expect(intent.outcome).toBe("held");
        expect(intent.artifacts).toContainEqual({
          file: fixture.handoffFile,
          sha256: await sha256File(originalTarget),
          dev: originalIdentity.dev,
          ino: originalIdentity.ino,
        });
        if (effect === "unknown")
          expect(await readFile(unknown, "utf8")).toBe("foreign\n");
        else {
          const replacement = await lstat(originalTarget);
          expect([replacement.dev, replacement.ino]).not.toEqual([
            originalIdentity.dev,
            originalIdentity.ino,
          ]);
          expect(await readFile(parked, "utf8")).toBe(fixture.handoffBytes);
          expect([
            (await lstat(parked)).dev,
            (await lstat(parked)).ino,
          ]).toEqual([originalIdentity.dev, originalIdentity.ino]);
        }
      }
    },
  );

  it.each([
    "same-head",
    "dirty",
    "unmanaged",
    "ambiguous",
    "noncanonical",
    "invalid-terminal-lease",
    "invalid-referenced-evidence",
    "unregistered",
    "unavailable-target-commit",
    "annotated-tag",
  ] as const)(
    "refuses opted terminal advancement before mutation: %s",
    async (kind) => {
      const fixture = await makeTerminalAdvanceRefusalFixture({
        canonical: kind !== "noncanonical",
      });
      try {
        let expectedLeaseBytes = fixture.leaseBytes;
        let targetHead = fixture.newHead;
        if (kind === "same-head") {
          targetHead = fixture.oldHead;
        }
        if (kind === "dirty") {
          await writeFile(path.join(fixture.worktree, "dirty.txt"), "dirty\n");
        }
        if (kind === "unmanaged") {
          await writeFile(
            path.join(fixture.worktree, ".ephemeral", "unmanaged.json"),
            "{}\n",
          );
        }
        if (kind === "ambiguous") {
          await addAmbiguousTerminalCandidate(fixture);
        }
        if (kind === "invalid-terminal-lease") {
          expectedLeaseBytes = "{invalid terminal lease}\n";
          await writeFile(fixture.leasePath, expectedLeaseBytes);
        }
        if (kind === "invalid-referenced-evidence") {
          fixture.handoffBytes = `${JSON.stringify({
            repository: "other/repo",
            pr_number: 432,
            base_ref: "main",
            head_ref: "topic",
          })}\n`;
          await writeFile(
            path.join(fixture.worktree, fixture.handoffFile),
            fixture.handoffBytes,
          );
        }
        if (kind === "unregistered") {
          await execFileAsync("git", [
            "-C",
            fixture.repository.physicalRepository,
            "worktree",
            "remove",
            "-f",
            fixture.worktree,
          ]);
          await mkdir(fixture.worktree, { recursive: true });
        }
        if (kind === "unavailable-target-commit") {
          targetHead = "b".repeat(40);
        }
        if (kind === "annotated-tag") {
          await execFileAsync("git", [
            "-C",
            fixture.repository.physicalRepository,
            "tag",
            "-a",
            "terminal-advance-target",
            "-m",
            "annotated target",
            fixture.newHead,
          ]);
          const { stdout } = await execFileAsync("git", [
            "-C",
            fixture.repository.physicalRepository,
            "rev-parse",
            "terminal-advance-target^{tag}",
          ]);
          targetHead = stdout.trim();
        }
        process.chdir(fixture.repository.physicalRepository);
        setTerminalAdvanceEnv(
          fixture.repository.physicalRepository,
          targetHead,
        );

        const result = await runPrReviewLeasesCommand(["session-create"]);

        await expectTerminalAdvanceUnchanged(
          fixture,
          result,
          kind === "unavailable-target-commit" || kind === "annotated-tag"
            ? "HEAD_SHA must name an available commit"
            : undefined,
          expectedLeaseBytes,
          kind !== "unregistered",
        );
      } finally {
        process.chdir(originalCwd);
        await rm(fixture.repository.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("preserves every terminal artifact when a late target collision is detected", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const scopeDecisionFile = ".ephemeral/pr-432-retained-scope.json";
    const priorThreadsFile = ".ephemeral/pr-432-retained-prior.json";
    const providerEvidenceFile = ".ephemeral/pr-432-retained-provider.json";
    const scopeDecisionBytes = "retained scope\n";
    const priorThreadsBytes = "retained prior threads\n";
    const providerEvidenceBytes = "target-tracked collision\n";
    const handoffBytes = `${JSON.stringify({
      repository: "owner/repo",
      pr_number: 432,
      base_ref: "main",
      head_ref: "topic",
      artifacts: {
        scope_decision_file: scopeDecisionFile,
        prior_threads_file: priorThreadsFile,
        provider_scope_evidence_file: providerEvidenceFile,
      },
    })}\n`;
    try {
      const lease = JSON.parse(
        await readFile(fixture.leasePath, "utf8"),
      ) as PrReviewLease;
      const leaseBytes = `${JSON.stringify(lease, null, 2)}\n`;
      await writeFile(fixture.leasePath, leaseBytes);
      await writeFile(
        path.join(fixture.worktree, fixture.handoffFile),
        handoffBytes,
      );
      await writeFile(
        path.join(fixture.worktree, scopeDecisionFile),
        scopeDecisionBytes,
      );
      await writeFile(
        path.join(fixture.worktree, priorThreadsFile),
        priorThreadsBytes,
      );
      await writeFile(
        path.join(fixture.worktree, providerEvidenceFile),
        "old provider evidence\n",
      );
      await writeFile(
        path.join(fixture.repository.physicalRepository, providerEvidenceFile),
        providerEvidenceBytes,
      );
      await execFileAsync("git", [
        "-C",
        fixture.repository.physicalRepository,
        "add",
        "-f",
        providerEvidenceFile,
      ]);
      await execFileAsync("git", [
        "-C",
        fixture.repository.physicalRepository,
        "commit",
        "-m",
        "track late terminal artifact collision",
      ]);
      const { stdout: targetHeadOutput } = await execFileAsync("git", [
        "-C",
        fixture.repository.physicalRepository,
        "rev-parse",
        "HEAD",
      ]);
      const targetHead = targetHeadOutput.trim();
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(fixture.repository.physicalRepository, targetHead);

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "manual-cleanup",
        reason: "rollback-incomplete",
        immutable_head: targetHead,
      });
      await expect(
        readFile(path.join(fixture.worktree, fixture.handoffFile), "utf8"),
      ).resolves.toBe(handoffBytes);
      await expect(
        readFile(path.join(fixture.worktree, scopeDecisionFile), "utf8"),
      ).resolves.toBe(scopeDecisionBytes);
      await expect(
        readFile(path.join(fixture.worktree, priorThreadsFile), "utf8"),
      ).resolves.toBe(priorThreadsBytes);
      await expect(
        readFile(path.join(fixture.worktree, providerEvidenceFile), "utf8"),
      ).resolves.toBe("old provider evidence\n");
      await expect(
        execFileAsync("git", ["-C", fixture.worktree, "rev-parse", "HEAD"]),
      ).resolves.toMatchObject({ stdout: `${fixture.oldHead}\n` });
      await expect(
        readFile(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral",
            fixture.archiveName,
          ),
          "utf8",
        ),
      ).resolves.toBe(leaseBytes);
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally {
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses a terminal artifact tracked at the old head before checkout", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    try {
      await execFileAsync("git", [
        "-C",
        fixture.worktree,
        "add",
        "-f",
        fixture.handoffFile,
      ]);
      await execFileAsync("git", [
        "-C",
        fixture.worktree,
        "commit",
        "-m",
        "track retained handoff",
      ]);
      const { stdout: trackedOldHeadOutput } = await execFileAsync("git", [
        "-C",
        fixture.worktree,
        "rev-parse",
        "HEAD",
      ]);
      const trackedOldHead = trackedOldHeadOutput.trim();
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "conflict",
        reason: "discovery-not-create",
      });
      await expect(
        execFileAsync("git", ["-C", fixture.worktree, "rev-parse", "HEAD"]),
      ).resolves.toMatchObject({ stdout: `${trackedOldHead}\n` });
      await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
        fixture.leaseBytes,
      );
      await expect(
        readFile(path.join(fixture.worktree, fixture.handoffFile), "utf8"),
      ).resolves.toBe(fixture.handoffBytes);
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral",
            fixture.archiveName,
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const actualFs =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
        await actualFs.rm(...args);
        throw Object.assign(new Error("reservation disappeared"), {
          code: "ENOENT",
        });
      });

      const missingReservation = await runPrReviewLeasesCommand([
        "session-create",
      ]);

      expect(JSON.parse(missingReservation.stdout)).toMatchObject({
        outcome: "manual-cleanup",
        reason: "rollback-incomplete",
        observed_artifacts: [],
      });
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it.each(["changes-lease", "deletes-lease", "deletes-reservation"] as const)(
    "reports actual evidence when a checkout hook %s",
    async (operation) => {
      const fixture = await makeTerminalAdvanceRefusalFixture({
        canonical: true,
      });
      const driftedLeaseBytes = "checkout-hook drift\\n";
      const leaseFile = path.relative(
        fixture.repository.physicalRepository,
        fixture.leasePath,
      );
      try {
        const hookPath = path.join(
          fixture.repository.physicalRepository,
          ".git",
          "hooks",
          "post-checkout",
        );
        const hookCommand =
          operation === "changes-lease"
            ? `printf '%s' ${JSON.stringify(driftedLeaseBytes)} >\"$PRIMARY_REPOSITORY_ROOT/${leaseFile}\"`
            : operation === "deletes-lease"
              ? `rm \"$PRIMARY_REPOSITORY_ROOT/${leaseFile}\"`
              : 'rm "$PRIMARY_REPOSITORY_ROOT/.ephemeral/pr-432-session-create-reservation.json"';
        await writeFile(hookPath, ["#!/bin/sh", hookCommand, ""].join("\n"));
        await chmod(hookPath, 0o755);
        process.chdir(fixture.repository.physicalRepository);
        setTerminalAdvanceEnv(
          fixture.repository.physicalRepository,
          fixture.newHead,
        );

        const result = await runPrReviewLeasesCommand(["session-create"]);

        expect(JSON.parse(result.stdout)).toMatchObject({
          outcome: "manual-cleanup",
          reason: "rollback-incomplete",
          immutable_head: fixture.newHead,
          observed_artifacts:
            operation === "changes-lease"
              ? ["reservation", "worktree", "registration", "lease"]
              : operation === "deletes-lease"
                ? ["reservation", "worktree", "registration"]
                : ["worktree", "registration", "lease"],
        });
        if (operation === "changes-lease") {
          await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
            driftedLeaseBytes,
          );
        } else if (operation === "deletes-lease") {
          await expect(lstat(fixture.leasePath)).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else {
          await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
            fixture.leaseBytes,
          );
        }
        await expect(
          readFile(
            path.join(
              fixture.repository.physicalRepository,
              ".ephemeral",
              fixture.archiveName,
            ),
            "utf8",
          ),
        ).resolves.toBe(fixture.leaseBytes);
        await expect(
          readFile(path.join(fixture.worktree, fixture.handoffFile), "utf8"),
        ).resolves.toBe(fixture.handoffBytes);
        const reservationPath = path.join(
          fixture.repository.physicalRepository,
          ".ephemeral/pr-432-session-create-reservation.json",
        );
        if (operation === "deletes-reservation") {
          await expect(lstat(reservationPath)).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else {
          await expect(lstat(reservationPath)).resolves.toMatchObject({
            isFile: expect.any(Function),
          });
        }
      } finally {
        process.chdir(originalCwd);
        await rm(fixture.repository.tempRoot, {
          recursive: true,
          force: true,
        });
      }
    },
  );

  it("preserves checkout-hook archive drift after head advancement", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const driftedArchiveBytes = "checkout-hook archive drift\\n";
    try {
      const hookPath = path.join(
        fixture.repository.physicalRepository,
        ".git",
        "hooks",
        "post-checkout",
      );
      await writeFile(
        hookPath,
        [
          "#!/bin/sh",
          `printf '%s' ${JSON.stringify(driftedArchiveBytes)} >\"$PRIMARY_REPOSITORY_ROOT/.ephemeral/${fixture.archiveName}\"`,
          "",
        ].join("\n"),
      );
      await chmod(hookPath, 0o755);
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "manual-cleanup",
        reason: "rollback-incomplete",
        immutable_head: fixture.newHead,
        observed_artifacts: [
          "reservation",
          "worktree",
          "registration",
          "lease",
        ],
      });
      await expect(
        readFile(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral",
            fixture.archiveName,
          ),
          "utf8",
        ),
      ).resolves.toBe(driftedArchiveBytes);
      await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
        fixture.leaseBytes,
      );
      await expect(
        readFile(path.join(fixture.worktree, fixture.handoffFile), "utf8"),
      ).resolves.toBe(fixture.handoffBytes);
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally {
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it("does not report a reservation removed during final cleanup", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const reservationPath = path.join(
      fixture.repository.physicalRepository,
      ".ephemeral/pr-432-session-create-reservation.json",
    );
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const mockedRm = vi.mocked(fsPromises.rm);
    try {
      mockedRm.mockImplementation(async (...args) => {
        if (args[0] === reservationPath) {
          await actualFs.rm(...args);
          throw Object.assign(new Error("reservation disappeared"), {
            code: "ENOENT",
          });
        }
        return await actualFs.rm(...args);
      });
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "manual-cleanup",
        reason: "rollback-incomplete",
        immutable_head: fixture.newHead,
        lease_sha256: expect.any(String),
        observed_artifacts: ["worktree", "registration", "lease"],
      });
      await expect(
        execFileAsync("git", ["-C", fixture.worktree, "rev-parse", "HEAD"]),
      ).resolves.toMatchObject({ stdout: `${fixture.newHead}\n` });
      await expect(readFile(fixture.leasePath, "utf8")).resolves.toContain(
        '"state": "created"',
      );
      await expect(
        readFile(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral",
            fixture.archiveName,
          ),
          "utf8",
        ),
      ).resolves.toBe(fixture.leaseBytes);
      await expect(lstat(reservationPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      mockedRm.mockImplementation(actualFs.rm);
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "absent",
    "equal",
    "divergent",
    "partial",
    "open-refusal",
    "complete",
    "complete-owned-target-absent",
    "complete-unknown-old-head",
    "complete-unknown-pending-successor",
    "complete-unknown-coherent-successor",
    "complete-changed-old-head",
    "complete-changed-pending-successor",
    "complete-replaced-old-head",
    "changed-reservation",
    "changed-archive",
  ] as const)(
    "recovers first operation publication failure with %s archive evidence",
    async (archiveState) => {
      const fixture = await makeTerminalAdvanceRefusalFixture({
        canonical: true,
      });
      const primary = fixture.repository.physicalRepository;
      const archive = path.join(primary, ".ephemeral", fixture.archiveName);
      if (archiveState === "equal" || archiveState === "divergent")
        await writeFile(
          archive,
          archiveState === "equal" ? fixture.leaseBytes : "divergent archive\n",
        );
      process.chdir(primary);
      setTerminalAdvanceEnv(primary, fixture.newHead);
      const actual =
        await vi.importActual<typeof fsPromises>("node:fs/promises");
      let faulted = false;
      vi.mocked(fsPromises.writeFile).mockImplementation(async (...args) => {
        if (
          String(args[0]).includes("-session-advance-") &&
          String(args[0]).endsWith(".json")
        ) {
          faulted = true;
          throw new Error("first operation publication failed");
        }
        return actual.writeFile(...args);
      });
      vi.mocked(fsPromises.open).mockImplementation(async (...args) => {
        if (
          archiveState === "open-refusal" &&
          String(args[0]).includes("-session-advance-") &&
          String(args[0]).endsWith(".json")
        ) {
          faulted = true;
          throw new Error("exclusive operation open failed");
        }
        const handle = await actual.open(...args);
        if (
          String(args[0]).includes("-session-advance-") &&
          String(args[0]).endsWith(".json")
        ) {
          const originalWrite = handle.writeFile.bind(handle);
          vi.spyOn(handle, "writeFile").mockImplementationOnce(
            async (...writeArgs) => {
              faulted = true;
              if (archiveState.startsWith("complete"))
                await originalWrite(...writeArgs);
              if (
                archiveState === "partial" ||
                archiveState.startsWith("changed-")
              )
                await originalWrite("{invalid partial intent\n", "utf8");
              if (archiveState === "changed-reservation")
                await actual.writeFile(
                  path.join(
                    primary,
                    ".ephemeral/pr-432-session-create-reservation.json",
                  ),
                  "another owner's unknown reservation\n",
                );
              if (archiveState === "changed-archive")
                await actual.writeFile(
                  archive,
                  "changed archive during failure\n",
                );
              throw new Error("first operation publication failed");
            },
          );
        }
        return handle;
      });
      let failed: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>;
      try {
        failed = await runPrReviewLeasesCommand(["session-create"]);
      } finally {
        vi.mocked(fsPromises.writeFile).mockImplementation(actual.writeFile);
        vi.mocked(fsPromises.open).mockImplementation(actual.open);
      }
      expect(failed.exitCode).toBe(1);
      expect(await readFile(fixture.leasePath, "utf8")).toBe(
        fixture.leaseBytes,
      );
      expect(
        (
          await execFileAsync("git", [
            "-C",
            fixture.worktree,
            "rev-parse",
            "HEAD",
          ])
        ).stdout.trim(),
      ).toBe(fixture.oldHead);
      expect(
        await readFile(
          path.join(fixture.worktree, fixture.handoffFile),
          "utf8",
        ),
      ).toBe(fixture.handoffBytes);
      expect(faulted).toBe(archiveState !== "divergent");
      const reservationPath = path.join(
        primary,
        ".ephemeral/pr-432-session-create-reservation.json",
      );
      const retained =
        archiveState.startsWith("complete") ||
        archiveState.startsWith("changed-");
      if (retained) {
        const reservationBytes = await readFile(reservationPath, "utf8");
        if (archiveState === "changed-reservation")
          expect(reservationBytes).toBe(
            "another owner's unknown reservation\n",
          );
        if (archiveState.startsWith("complete")) {
          const token = JSON.parse(reservationBytes).invocation_token;
          const intent = JSON.parse(
            await readFile(
              path.join(
                primary,
                `.ephemeral/pr-432-session-advance-${token}.json`,
              ),
              "utf8",
            ),
          );
          expect(intent).not.toHaveProperty("pending_file");
          expect(intent).not.toHaveProperty("removed_files");
          if (archiveState === "complete-owned-target-absent")
            await actual.rm(path.join(fixture.worktree, fixture.handoffFile));
          const unknown = path.join(
            fixture.worktree,
            ".ephemeral/provider-scope-capture.unrelated-replay",
          );
          if (archiveState.startsWith("complete-unknown")) {
            if (archiveState !== "complete-unknown-old-head")
              await execFileAsync("git", [
                "-C",
                fixture.worktree,
                "checkout",
                "--detach",
                fixture.newHead,
              ]);
            if (archiveState === "complete-unknown-coherent-successor")
              await actual.writeFile(fixture.leasePath, intent.successor_bytes);
            await mkdir(unknown);
            await actual.writeFile(
              path.join(unknown, "foreign.txt"),
              "unrelated ignored bytes\n",
            );
            const beforeLease = await readFile(fixture.leasePath);
            const beforeOwned = await readFile(
              path.join(fixture.worktree, fixture.handoffFile),
            );
            const beforeHead = (
              await execFileAsync("git", [
                "-C",
                fixture.worktree,
                "rev-parse",
                "HEAD",
              ])
            ).stdout.trim();
            const held = await runPrReviewLeasesCommand([
              "session-reconcile",
              "--invocation-token",
              token,
            ]);
            expect(held.exitCode, held.stderr + held.stdout).toBe(1);
            expect(
              (
                await execFileAsync("git", [
                  "-C",
                  fixture.worktree,
                  "rev-parse",
                  "HEAD",
                ])
              ).stdout.trim(),
            ).toBe(beforeHead);
            expect(await readFile(fixture.leasePath)).toEqual(beforeLease);
            expect(
              await readFile(path.join(unknown, "foreign.txt"), "utf8"),
            ).toBe("unrelated ignored bytes\n");
            expect(await readFile(reservationPath, "utf8")).toBe(
              reservationBytes,
            );
            if (archiveState === "complete-unknown-coherent-successor") {
              // Already coherent successor cleanup is resource-local. The
              // separate final discovery still truthfully holds unknowns.
              await expect(
                lstat(path.join(fixture.worktree, fixture.handoffFile)),
              ).rejects.toMatchObject({ code: "ENOENT" });
              expect(JSON.parse(held.stdout).reason).toBe(
                "session reconciliation final state uncertain",
              );
            } else {
              expect(
                await readFile(
                  path.join(fixture.worktree, fixture.handoffFile),
                ),
              ).toEqual(beforeOwned);
              expect(JSON.parse(held.stdout).reason).toBe(
                "session reconciliation unknown artifacts before advancement",
              );
            }
            return;
          }
          if (
            archiveState.startsWith("complete-changed") ||
            archiveState === "complete-replaced-old-head"
          ) {
            if (archiveState === "complete-changed-pending-successor")
              await execFileAsync("git", [
                "-C",
                fixture.worktree,
                "checkout",
                "--detach",
                fixture.newHead,
              ]);
            const target = path.join(fixture.worktree, fixture.handoffFile);
            const parked = path.join(
              primary,
              ".ephemeral/parked-original-replay-target.json",
            );
            if (archiveState === "complete-replaced-old-head") {
              const original = await lstat(target);
              await fsPromises.rename(target, parked);
              await actual.writeFile(target, fixture.handoffBytes);
              const replacement = await lstat(target);
              expect([replacement.dev, replacement.ino]).not.toEqual([
                original.dev,
                original.ino,
              ]);
            } else
              await actual.writeFile(target, "changed known ignored bytes\n");
            const beforeLease = await readFile(fixture.leasePath);
            const beforeTarget = await readFile(target);
            const beforeHead = (
              await execFileAsync("git", [
                "-C",
                fixture.worktree,
                "rev-parse",
                "HEAD",
              ])
            ).stdout.trim();
            const held = await runPrReviewLeasesCommand([
              "session-reconcile",
              "--invocation-token",
              token,
            ]);
            expect(held.exitCode, held.stderr + held.stdout).toBe(1);
            expect(
              (
                await execFileAsync("git", [
                  "-C",
                  fixture.worktree,
                  "rev-parse",
                  "HEAD",
                ])
              ).stdout.trim(),
            ).toBe(beforeHead);
            expect(await readFile(fixture.leasePath)).toEqual(beforeLease);
            expect(await readFile(target)).toEqual(beforeTarget);
            expect(await readFile(reservationPath, "utf8")).toBe(
              reservationBytes,
            );
            expect(JSON.parse(held.stdout).reason).toContain(
              archiveState === "complete-replaced-old-head"
                ? "physical identity changed"
                : "bytes changed",
            );
            if (archiveState === "complete-replaced-old-head")
              expect(await readFile(parked, "utf8")).toBe(fixture.handoffBytes);
            return;
          }
          const reconciled = await runPrReviewLeasesCommand([
            "session-reconcile",
            "--invocation-token",
            token,
          ]);
          expect(
            reconciled.exitCode,
            reconciled.stderr + reconciled.stdout,
          ).toBe(0);
          expect(
            (
              await execFileAsync("git", [
                "-C",
                fixture.worktree,
                "rev-parse",
                "HEAD",
              ])
            ).stdout.trim(),
          ).toBe(fixture.newHead);
        } else {
          const retry = await runPrReviewLeasesCommand(["session-create"]);
          expect(retry.exitCode).toBe(1);
          expect(await readFile(reservationPath, "utf8")).toBe(
            reservationBytes,
          );
          expect(await readFile(fixture.leasePath, "utf8")).toBe(
            fixture.leaseBytes,
          );
        }
      } else {
        await expect(lstat(reservationPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(archive, "utf8")).toBe(
          archiveState === "divergent"
            ? "divergent archive\n"
            : fixture.leaseBytes,
        );
        if (archiveState === "partial") {
          const failedIntent = (
            await readdir(path.join(primary, ".ephemeral"))
          ).find((file) => file.includes("-session-advance-"));
          expect(failedIntent).toBeDefined();
          expect(
            await readFile(
              path.join(primary, ".ephemeral", failedIntent as string),
              "utf8",
            ),
          ).toBe("{invalid partial intent\n");
        }
        const retry = await runPrReviewLeasesCommand(["session-create"]);
        expect(JSON.parse(retry.stdout).outcome).toBe(
          archiveState === "divergent" ? "conflict" : "success",
        );
      }
    },
  );

  it("reports complete evidence when checkout advances then a hook fails", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    try {
      const hookPath = path.join(
        fixture.repository.physicalRepository,
        ".git",
        "hooks",
        "post-checkout",
      );
      await writeFile(
        hookPath,
        `#!/bin/sh\nrm "$PRIMARY_REPOSITORY_ROOT/.ephemeral/${fixture.archiveName}"\nexit 1\n`,
      );
      await chmod(hookPath, 0o755);
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "manual-cleanup",
        reason: "rollback-incomplete",
        immutable_head: fixture.newHead,
        registration_identity: { worktree_path: fixture.worktree },
        observed_artifacts: [
          "reservation",
          "worktree",
          "registration",
          "lease",
        ],
      });
      await expect(
        execFileAsync("git", ["-C", fixture.worktree, "rev-parse", "HEAD"]),
      ).resolves.toMatchObject({ stdout: `${fixture.newHead}\n` });
      await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
        fixture.leaseBytes,
      );
      await expect(
        readFile(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral",
            fixture.archiveName,
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        lstat(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally {
      process.chdir(originalCwd);
      await rm(fixture.repository.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves the published lease when final verification sees a resumed dirty session", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const leaseFile = `.ephemeral/pr-432-${discoveryWorktreeDigest(canonical)}-lease.json`;
    const leasePath = path.join(repository.physicalRepository, leaseFile);
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: head,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });

    const markResumedSessionDirty = (async () => {
      for (let attempt = 0; attempt < 1_000; attempt += 1) {
        try {
          await lstat(leasePath);
          await writeFile(
            path.join(canonical, "resumed-session.txt"),
            "dirty\n",
          );
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
      throw new Error("session lease was not published");
    })();

    const result = await runPrReviewLeasesCommand(["session-create"]);
    await markResumedSessionDirty;

    expect(result.exitCode, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      reason: "lease-unverifiable",
      canonical_worktree_path: canonical,
      immutable_head: head,
      observed_artifacts: ["reservation", "worktree", "registration", "lease"],
    });
    await expect(readFile(leasePath, "utf8")).resolves.toContain(
      '"state": "created"',
    );
  });

  it("preserves manual-cleanup evidence for an unsupported publication primitive", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const reservationPath = path.join(
      repository.physicalRepository,
      ".ephemeral",
      "pr-432-session-create-reservation.json",
    );
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: head,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });
    vi.mocked(fsPromises.link).mockRejectedValueOnce(
      Object.assign(new Error("unsupported hard link"), { code: "EOPNOTSUPP" }),
    );

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(result.exitCode, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      reason: "lease-unverifiable",
      canonical_worktree_path: canonical,
      immutable_head: head,
      lease_sha256: null,
      observed_artifacts: ["reservation", "worktree", "registration", "lease"],
    });
    await expect(readFile(reservationPath, "utf8")).resolves.toContain(
      '"schema":"pr-review/session-create-reservation/v1"',
    );
    await expect(lstat(canonical)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it("preserves manual-cleanup evidence when failed staging cannot remove its temporary file", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const reservationPath = path.join(
      repository.physicalRepository,
      ".ephemeral",
      "pr-432-session-create-reservation.json",
    );
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: head,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const mockedOpen = vi.mocked(fsPromises.open);
    const mockedRm = vi.mocked(fsPromises.rm);
    mockedOpen.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (
        typeof args[0] === "string" &&
        args[0].endsWith(".session-create.tmp")
      ) {
        vi.spyOn(handle, "writeFile").mockRejectedValueOnce(
          new Error("staging write failed"),
        );
      }
      return handle;
    });
    mockedRm.mockImplementation(async (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].endsWith(".session-create.tmp")
      ) {
        throw new Error("temporary cleanup failed");
      }
      return await actualFs.rm(...args);
    });

    let result: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>;
    try {
      result = await runPrReviewLeasesCommand(["session-create"]);
    } finally {
      mockedOpen.mockImplementation(actualFs.open);
      mockedRm.mockImplementation(actualFs.rm);
    }

    expect(result.exitCode, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      reason: "lease-unverifiable",
      canonical_worktree_path: canonical,
      immutable_head: head,
      lease_sha256: null,
      observed_artifacts: ["reservation", "worktree", "registration", "lease"],
    });
    await expect(readFile(reservationPath, "utf8")).resolves.toContain(
      '"schema":"pr-review/session-create-reservation/v1"',
    );
    const temporaryEntries = (
      await readdir(path.dirname(reservationPath))
    ).filter((entry) => entry.endsWith(".session-create.tmp"));
    expect(temporaryEntries).toHaveLength(1);
  });

  it("[SC-F3] preserves ignored post-checkout output when lease staging fails", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const reservationPath = path.join(
      repository.physicalRepository,
      ".ephemeral",
      "pr-432-session-create-reservation.json",
    );
    const ignoredOutput = path.join(
      canonical,
      "ignored-session-hook-output.txt",
    );
    await writeFile(
      path.join(repository.physicalRepository, ".git", "info", "exclude"),
      "ignored-session-hook-output.txt\n",
    );
    const hookPath = path.join(
      repository.physicalRepository,
      ".git",
      "hooks",
      "post-checkout",
    );
    await writeFile(
      hookPath,
      [
        "#!/bin/sh",
        'worktree_root="$(git rev-parse --show-toplevel)"',
        'printf "%s\\n" retained >"$worktree_root/ignored-session-hook-output.txt"',
        "",
      ].join("\n"),
    );
    await chmod(hookPath, 0o755);
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: head,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const mockedOpen = vi.mocked(fsPromises.open);
    mockedOpen.mockImplementation(async (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].endsWith(".session-create.tmp")
      ) {
        throw new Error("lease staging failed");
      }
      return await actualFs.open(...args);
    });

    let result: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>;
    try {
      result = await runPrReviewLeasesCommand(["session-create"]);
    } finally {
      mockedOpen.mockImplementation(actualFs.open);
    }

    expect(result.exitCode, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      reason: "lease-unverifiable",
      canonical_worktree_path: canonical,
      immutable_head: head,
      lease_sha256: null,
      observed_artifacts: ["reservation", "worktree", "registration"],
    });
    await expect(readFile(ignoredOutput, "utf8")).resolves.toBe("retained\n");
    await expect(readFile(reservationPath, "utf8")).resolves.toContain(
      '"schema":"pr-review/session-create-reservation/v1"',
    );
  });

  it("[SC-F3] preserves post-checkout per-worktree Git output", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const reservationPath = path.join(
      repository.physicalRepository,
      ".ephemeral",
      "pr-432-session-create-reservation.json",
    );
    const hookPath = path.join(
      repository.physicalRepository,
      ".git",
      "hooks",
      "post-checkout",
    );
    await writeFile(
      hookPath,
      [
        "#!/bin/sh",
        'git_dir="$(git rev-parse --path-format=absolute --git-dir)"',
        'printf "%s\\n" retained >"$git_dir/session-hook-output"',
        "",
      ].join("\n"),
    );
    await chmod(hookPath, 0o755);
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: head,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const mockedOpen = vi.mocked(fsPromises.open);
    mockedOpen.mockImplementation(async (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].endsWith(".session-create.tmp")
      ) {
        throw new Error("lease staging failed");
      }
      return await actualFs.open(...args);
    });

    let result: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>;
    try {
      result = await runPrReviewLeasesCommand(["session-create"]);
    } finally {
      mockedOpen.mockImplementation(actualFs.open);
    }

    expect(result.exitCode, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      reason: "lease-unverifiable",
      canonical_worktree_path: canonical,
      immutable_head: head,
      lease_sha256: null,
      observed_artifacts: ["reservation", "worktree", "registration"],
    });
    const { stdout: gitDirectoryOutput } = await execFileAsync("git", [
      "-C",
      canonical,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);
    await expect(
      readFile(
        path.join(gitDirectoryOutput.trim(), "session-hook-output"),
        "utf8",
      ),
    ).resolves.toBe("retained\n");
    await expect(readFile(reservationPath, "utf8")).resolves.toContain(
      '"schema":"pr-review/session-create-reservation/v1"',
    );
  });
});
