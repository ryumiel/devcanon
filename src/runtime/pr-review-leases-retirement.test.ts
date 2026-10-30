import * as fsPromises from "node:fs/promises";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPrReviewLeaseFixtures } from "../__test-helpers__/pr-review-lease-fixtures.js";
import * as artifacts from "./artifacts.js";
import { runPrReviewProviderScopeEvidenceCommand } from "./review-artifacts.js";

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
  readLease,
  sha256File,
  makeGatedStatusWorkspace,
  setReadStatusEnv,
  makeTerminalAdvanceRefusalFixture,
  setTerminalAdvanceEnv,
  expectTerminalAdvanceUnchanged,
  makeAttemptRetirementFixture,
  writeContinuationRequest,
  makeEnrolledRetirementFixture,
  makeIncompleteContinuationFixture,
  makeGuardedScratchCleanupFixture,
  originalCwd,
} = createPrReviewLeaseFixtures();

describe("pr-review lease command validation", () => {
  it("retires original-proven enrolled failures after verified successful posting without erasing accepted authority", async () => {
    const fixture = await makeEnrolledRetirementFixture("posted", true);
    const before = await readLease(fixture.physicalPrimary, fixture.leaseFile);
    expect(before).toMatchObject({
      state: "posted",
      github: { github_post_attempted: true, github_post_result: "succeeded" },
      preparation_failures: [{ directory: fixture.resource }],
    });
    const acceptedFiles = [
      before.artifacts.handoff_file,
      before.artifacts.result_file,
      before.artifacts.approved_review_file,
      before.artifacts.validated_payload_file,
    ].map((file) => file as string);
    const acceptedBytes = await Promise.all(
      acceptedFiles.map((file) => readFile(path.join(fixture.worktree, file))),
    );
    const heldByHistory = await runPrReviewLeasesCommand(["inspect-worktree"]);
    expect(heldByHistory.stdout).toContain(
      "REFUSAL_REASON=preparation-failure-history",
    );
    const actualRemove = (
      await vi.importActual<typeof fsPromises>("node:fs/promises")
    ).rm;
    // Exercise the real posted operation in bounded interrupted invocations,
    // retaining the harness deadline for each exact same-operation resume.
    vi.mocked(fsPromises.rm).mockImplementation(async (...args) => {
      await actualRemove(...args);
      if (
        typeof args[0] === "string" &&
        args[0].startsWith(path.join(fixture.worktree, fixture.resource))
      )
        throw new Error("interrupt posted retirement after leaf removal");
    });
    try {
      for (let leaf = 0; leaf < 2; leaf++) {
        const held = await runPrReviewLeasesCommand([
          "retire-attempt",
          "--request-file",
          fixture.requestFile,
        ]);
        expect(held.exitCode, held.stderr + held.stdout).toBe(1);
        expect(JSON.parse(held.stdout)).toMatchObject({
          outcome: "held",
          reason: "interrupt posted retirement after leaf removal",
        });
      }
    } finally {
      vi.mocked(fsPromises.rm).mockImplementation(actualRemove);
    }
    const retired = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(retired.exitCode, retired.stderr + retired.stdout).toBe(0);
    const after = await readLease(fixture.physicalPrimary, fixture.leaseFile);
    expect(after.preparation_failures).toBeUndefined();
    expect(after.state).toBe("posted");
    expect(after.artifacts).toEqual(before.artifacts);
    expect(after.github).toEqual(before.github);
    expect(after.validation).toEqual(before.validation);
    expect(after.presentation).toEqual(before.presentation);
    for (const [index, file] of acceptedFiles.entries())
      expect(await readFile(path.join(fixture.worktree, file))).toEqual(
        acceptedBytes[index],
      );
    expect(JSON.parse(retired.stdout).lease_sha256).toBe(
      await sha256File(path.join(fixture.physicalPrimary, fixture.leaseFile)),
    );
    const valid = await runPrReviewLeasesCommand(["validate"]);
    expect(valid.exitCode, valid.stderr).toBe(0);
    expect(
      (await runPrReviewLeasesCommand(["inspect-worktree"])).stdout,
    ).toContain("CAN_REMOVE=yes");
  }, 20_000);

  // All indirect members share the accepted-resource set guard; posted adds
  // the completed-posting branch, exercised once with the provider member.
  it.each([
    ["reviewed", "provider"],
    ["reviewed", "scope"],
    ["reviewed", "findings"],
    ["posted", "provider"],
  ] as const)(
    "protects accepted indirect %s evidence member %s before retirement effects",
    async (state, member) => {
      const fixture = await makeEnrolledRetirementFixture(state);
      const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
      const leaseBytes = await readFile(leasePath, "utf8");
      const result = JSON.parse(
        await readFile(path.join(fixture.worktree, fixture.resultFile), "utf8"),
      );
      const resource =
        member === "findings"
          ? result.findings_file
          : result.artifacts[
              member === "provider"
                ? "provider_scope_evidence_file"
                : "scope_decision_file"
            ];
      const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
      Reflect.deleteProperty(request, "original_records");
      request.schema = "pr-review/provider-scope-cleanup/v1";
      const accepted = await fsPromises.lstat(
        path.join(fixture.worktree, resource),
      );
      request.expected_scratch = [
        { resource, dev: accepted.dev, ino: accepted.ino, entries: [] },
      ];
      await writeFile(fixture.requestFile, JSON.stringify(request));
      const before = new Map<string, Buffer>();
      for (const file of await readdir(
        path.join(fixture.worktree, ".ephemeral"),
      )) {
        const absolute = path.join(fixture.worktree, ".ephemeral", file);
        if ((await lstat(absolute)).isFile())
          before.set(absolute, await readFile(absolute));
      }
      const retired = await runPrReviewProviderScopeEvidenceCommand([
        "remove-scratch",
        "--scratch-dir",
        resource,
        "--expected-snapshot-file",
        fixture.requestFile,
      ]);
      expect(retired.exitCode, retired.stdout).toBe(1);
      expect(retired.stderr).not.toBe("");
      expect(await readFile(leasePath, "utf8")).toBe(leaseBytes);
      for (const [file, bytes] of before)
        expect(await readFile(file)).toEqual(bytes);
      await expect(
        lstat(
          path.join(
            fixture.physicalPrimary,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
    20_000,
  );

  it("retains enrolled diagnostics when posting remains unsuccessful or unresolved", async () => {
    const fixture = await makeEnrolledRetirementFixture("post-failed");
    const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
    const before = await readFile(leasePath, "utf8");
    expect(JSON.parse(before)).toMatchObject({
      state: "failed",
      github: { github_post_attempted: true, github_post_result: "failed" },
      failure: { phase: "github-post", recoverability: "unknown" },
    });
    // Deliberately contradictory negative input: the caller claims exhausted
    // purposes while the authoritative lease still needs post reconciliation.
    // That assertion must not override the unsettled posting boundary.
    const result = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).reason).toContain("attempted-post");
    expect(await readFile(leasePath, "utf8")).toBe(before);
    expect(
      await readdir(path.join(fixture.worktree, fixture.resource)),
    ).toEqual(["failed-scope.json", "validator.stderr"]);
  });

  it("retains posted diagnostic history when accepted posting evidence changes", async () => {
    const fixture = await makeEnrolledRetirementFixture("posted");
    const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
    const before = await readFile(leasePath, "utf8");
    const approvedFile = JSON.parse(before).artifacts.approved_review_file;
    const approvedPath = path.join(fixture.worktree, approvedFile);
    const approved = JSON.parse(await readFile(approvedPath, "utf8"));
    approved.payload.body = "changed approved body";
    await writeFile(approvedPath, JSON.stringify(approved));
    const result = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).reason).toContain(
      "approved-review mismatch",
    );
    expect(await readFile(leasePath, "utf8")).toBe(before);
    expect(
      await readdir(path.join(fixture.worktree, fixture.resource)),
    ).toEqual(["failed-scope.json", "validator.stderr"]);
  });

  it("reports released current custody and valid lease after interrupted enrolled deletion", async () => {
    const fixture = await makeEnrolledRetirementFixture("aborted");
    const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
    const originalBytes = await readFile(leasePath, "utf8");
    const actualRemove = (
      await vi.importActual<typeof fsPromises>("node:fs/promises")
    ).rm;
    vi.mocked(fsPromises.rm).mockImplementationOnce(async () => {
      throw new Error("interrupt enrolled retirement");
    });
    const held = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(held.exitCode).toBe(1);
    expect(await readFile(leasePath, "utf8")).not.toBe(originalBytes);
    expect(
      (await readLease(fixture.physicalPrimary, fixture.leaseFile))
        .preparation_failures,
    ).toBeUndefined();
    const valid = await runPrReviewLeasesCommand(["validate"]);
    expect(valid.exitCode, valid.stderr).toBe(0);
    expect(JSON.parse(held.stdout)).toMatchObject({
      outcome: "held",
      lease_sha256: await sha256File(leasePath),
    });
    vi.mocked(fsPromises.rm).mockImplementation(actualRemove);
    const resumed = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0);
    expect(JSON.parse(resumed.stdout).lease_sha256).toBe(
      await sha256File(leasePath),
    );
    expect(
      (await readLease(fixture.physicalPrimary, fixture.leaseFile))
        .preparation_failures,
    ).toBeUndefined();
  });

  it("guarded scratch cleanup removes an existing aborted directory without changing its lease", async () => {
    const fixture = await makeGuardedScratchCleanupFixture();
    const leaseBytes = await readFile(fixture.leasePath);
    const result = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(await readFile(fixture.leasePath)).toEqual(leaseBytes);
    await expect(
      fsPromises.lstat(path.join(fixture.worktree, fixture.resource)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const replay = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(replay.exitCode, replay.stderr + replay.stdout).toBe(0);
    expect(await readFile(fixture.leasePath)).toEqual(leaseBytes);
  });

  it.each(["leaf", "directory", "head-change"] as const)(
    "cleans an independently owned target with absent %s before first invocation",
    async (absent) => {
      const fixture = await makeGuardedScratchCleanupFixture(true);
      const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
      request.expected_scratch = request.expected_scratch.slice(0, 1);
      await writeFile(fixture.requestFile, JSON.stringify(request));
      const target = path.join(fixture.worktree, fixture.resource);
      if (absent !== "head-change")
        await fsPromises.rm(
          absent === "leaf" ? path.join(target, "failed-scope.json") : target,
          { recursive: absent === "directory" },
        );
      else
        await execFileAsync("git", [
          "-C",
          fixture.worktree,
          "checkout",
          "--detach",
          fixture.newHead,
        ]);
      await execFileAsync("git", [
        "-C",
        fixture.worktree,
        "ls-files",
        "--error-unmatch",
        "README.md",
      ]);
      await writeFile(
        path.join(fixture.worktree, "README.md"),
        "leave unchanged\n",
      );
      const unrelated = path.join(
        fixture.worktree,
        fixture.resources[1] as string,
      );
      const unrelatedBytes = await Promise.all(
        (await readdir(unrelated)).map((name) =>
          readFile(path.join(unrelated, name)),
        ),
      );
      const beforeLease = await readFile(fixture.leasePath);
      for (let retry = 0; retry < 2; retry++) {
        const result = await runPrReviewProviderScopeEvidenceCommand([
          "remove-scratch",
          "--scratch-dir",
          fixture.resource,
          "--expected-snapshot-file",
          fixture.requestFile,
        ]);
        expect(result.exitCode, result.stderr + result.stdout).toBe(0);
        expect(await readFile(fixture.leasePath)).toEqual(beforeLease);
      }
      await expect(fsPromises.lstat(target)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        await readFile(path.join(fixture.worktree, "README.md"), "utf8"),
      ).toBe("leave unchanged\n");
      expect(
        await Promise.all(
          (await readdir(unrelated)).map((name) =>
            readFile(path.join(unrelated, name)),
          ),
        ),
      ).toEqual(unrelatedBytes);
    },
  );

  it.each(["unused", "active-consumer", "pending-publication"] as const)(
    "applies finite retirement to synthetic completed evidence: %s",
    async (purpose) => {
      // Tiny stand-ins for a completed evidence tree, allocated and sealed
      // through its actual scratch producer. This does not enroll a historical
      // primary-root archive or establish live #842 ownership/cleanup authority.
      const leaves = {
        "source-history.bundle": "synthetic source identity\n",
        "copied-guidance.md": "synthetic copied guidance\n",
        "review.log": "synthetic completed review detail\n",
      };
      const fixture = await makeAttemptRetirementFixture(leaves);
      const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
      request.publication = {
        status: "published",
        references: ["https://github.com/owner/repo/pull/432"],
      };
      if (purpose === "active-consumer")
        request.active_consumers = ["changed-head-comparison"];
      if (purpose === "pending-publication")
        request.publication = { status: "pending", references: [] };
      await writeFile(fixture.requestFile, JSON.stringify(request));
      const primaryEphemeral = path.join(
        fixture.repository.physicalRepository,
        ".ephemeral",
      );
      const primaryEntries = (await readdir(primaryEphemeral)).sort();
      const scratchEntries = (
        await readdir(path.join(fixture.worktree, ".ephemeral"))
      ).sort();
      const leaseBytes = await readFile(fixture.leasePath);
      const originalBytes = await readFile(fixture.recordFile);

      for (let invocation = 0; invocation < 2; invocation++) {
        const result = await runPrReviewLeasesCommand([
          "retire-attempt",
          "--request-file",
          fixture.requestFile,
        ]);
        expect(result.exitCode, result.stderr + result.stdout).toBe(
          purpose === "unused" ? 0 : 1,
        );
        if (purpose === "unused")
          expect(JSON.parse(result.stdout)).toMatchObject({
            outcome: "retired",
          });
        else
          expect(result.stderr).toContain(
            purpose === "active-consumer"
              ? "exhausted consumers/effects"
              : "retirement requires verified durable publication",
          );
        expect(await readFile(fixture.leasePath)).toEqual(leaseBytes);
        expect(await readFile(fixture.recordFile)).toEqual(originalBytes);
        // Neither cleanup nor repeat reporting creates replacement evidence.
        expect((await readdir(primaryEphemeral)).sort()).toEqual(
          primaryEntries,
        );
        expect(
          (await readdir(path.join(fixture.worktree, ".ephemeral"))).sort(),
        ).toEqual(
          purpose === "unused"
            ? scratchEntries.filter(
                (entry) => entry !== path.basename(fixture.resource),
              )
            : scratchEntries,
        );
        if (purpose === "unused")
          await expect(
            lstat(path.join(fixture.worktree, fixture.resource)),
          ).rejects.toMatchObject({ code: "ENOENT" });
        else
          for (const [name, bytes] of Object.entries(leaves))
            expect(
              await readFile(
                path.join(fixture.worktree, fixture.resource, name),
                "utf8",
              ),
            ).toBe(bytes);
      }
    },
  );

  it.each([
    "changed",
    "extra",
    "symlink",
    "replaced",
    "leaf-replaced",
    "lease",
    "concurrent",
    "tracked",
    "consumers",
    "pending",
    "publication",
    "unregistered",
    "argument",
  ] as const)(
    "guarded scratch cleanup preserves custody on %s refusal",
    async (dimension) => {
      const fixture = await makeGuardedScratchCleanupFixture();
      const directory = path.join(fixture.worktree, fixture.resource);
      const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
      const reservationPath = path.join(
        fixture.primary,
        ".ephemeral/pr-432-session-create-reservation.json",
      );
      if (dimension === "changed")
        await writeFile(
          path.join(directory, "failed-scope.json"),
          "changed original bytes\n",
        );
      if (dimension === "extra")
        await writeFile(path.join(directory, "extra.txt"), "extra bytes\n");
      if (dimension === "symlink") {
        const target = path.join(
          fixture.primary,
          ".ephemeral/foreign-source.json",
        );
        await writeFile(target, "foreign bytes\n");
        await fsPromises.rm(path.join(directory, "failed-scope.json"));
        await symlink(target, path.join(directory, "failed-scope.json"));
      }
      if (dimension === "replaced") {
        await fsPromises.rename(directory, `${directory}.parked-original`);
        await mkdir(directory);
        await writeFile(
          path.join(directory, "foreign.txt"),
          "foreign replacement\n",
        );
      }
      if (dimension === "leaf-replaced") {
        const leaf = path.join(directory, "failed-scope.json");
        const original = await fsPromises.lstat(leaf);
        const parked = path.join(
          fixture.primary,
          ".ephemeral/parked-original-leaf.json",
        );
        await fsPromises.rename(leaf, parked);
        await writeFile(leaf, await readFile(parked));
        const replacement = await fsPromises.lstat(leaf);
        expect([replacement.dev, replacement.ino]).not.toEqual([
          original.dev,
          original.ino,
        ]);
      }
      if (dimension === "lease") {
        const lease = JSON.parse(fixture.leaseBytes);
        lease.state = "created";
        lease.terminal.reason = null;
        await writeFile(fixture.leasePath, JSON.stringify(lease));
      }

      if (dimension === "concurrent")
        await writeFile(reservationPath, "another owner's reservation\n");
      if (dimension === "tracked") {
        await execFileAsync("git", [
          "-C",
          fixture.worktree,
          "add",
          "-f",
          fixture.resource,
        ]);
        await execFileAsync("git", [
          "-C",
          fixture.worktree,
          "commit",
          "-m",
          "fixture tracks scratch",
        ]);
        request.old_head = (
          await execFileAsync("git", [
            "-C",
            fixture.worktree,
            "rev-parse",
            "HEAD",
          ])
        ).stdout.trim();
      }
      // These truthful fixture-owner facts are unresolved cleanup obligations;
      // neither a matching snapshot nor the authority locator resolves them.
      if (dimension === "consumers")
        request.active_consumers = ["fixture-reviewer"];
      if (dimension === "pending")
        request.pending_effects = ["fixture-publication"];
      if (dimension === "publication")
        request.publication = { status: "pending", references: [] };

      if (dimension === "unregistered") {
        const parked = `${fixture.worktree}.parked-unregistered`;
        await fsPromises.rename(fixture.worktree, parked);
        await execFileAsync("git", [
          "-C",
          fixture.primary,
          "worktree",
          "prune",
          "--expire",
          "now",
        ]);
        await fsPromises.rename(parked, fixture.worktree);
      }
      await writeFile(fixture.requestFile, JSON.stringify(request));
      const beforeLease = await readFile(fixture.leasePath);
      const beforeReservation = await readFile(reservationPath).catch(
        () => null,
      );
      const before = new Map<string, Buffer>();
      for (const name of await readdir(directory).catch(() => []))
        before.set(name, await readFile(path.join(directory, name)));
      const result = await runPrReviewProviderScopeEvidenceCommand([
        "remove-scratch",
        "--scratch-dir",
        dimension === "argument"
          ? `${fixture.resource}-wrong`
          : fixture.resource,
        "--expected-snapshot-file",
        fixture.requestFile,
      ]);
      expect(result.exitCode, result.stdout).toBe(1);
      expect(await readFile(fixture.leasePath)).toEqual(beforeLease);
      expect(await readFile(reservationPath).catch(() => null)).toEqual(
        beforeReservation,
      );
      for (const [name, bytes] of before)
        expect(await readFile(path.join(directory, name))).toEqual(bytes);
      if (dimension === "leaf-replaced")
        expect(
          await readFile(
            path.join(fixture.primary, ".ephemeral/parked-original-leaf.json"),
            "utf8",
          ),
        ).toBe("original never-accepted bytes\n");
      if (dimension === "replaced")
        expect(
          await readFile(
            path.join(`${directory}.parked-original`, "failed-scope.json"),
            "utf8",
          ),
        ).toBe("original never-accepted bytes\n");
    },
  );

  it("guarded scratch cleanup retries current remaining targets after partial effects", async () => {
    const fixture = await makeGuardedScratchCleanupFixture();
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
      await actual.rm(...args);
      throw new Error("interrupt exact guarded leaf removal");
    });
    const held = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(JSON.parse(held.stdout)).toMatchObject({
      outcome: "held",
      reason: "interrupt exact guarded leaf removal",
    });
    const directory = path.join(fixture.worktree, fixture.resource);
    expect(await readdir(directory)).toEqual(["validator.stderr"]);
    const reservationPath = path.join(
      fixture.primary,
      ".ephemeral/pr-432-session-create-reservation.json",
    );
    await expect(fsPromises.lstat(reservationPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    vi.mocked(fsPromises.rm).mockImplementation(actual.rm);
    const resumed = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0);
    expect(await readFile(fixture.leasePath, "utf8")).toBe(fixture.leaseBytes);
    await expect(fsPromises.lstat(reservationPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([true, false])(
    "guarded cleanup selects a directory family or independent subset: %s",
    async (complete) => {
      const fixture = await makeGuardedScratchCleanupFixture(true);
      const original = await readFile(fixture.leasePath);
      if (!complete) {
        const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
        request.expected_scratch = request.expected_scratch.slice(0, 1);
        await writeFile(fixture.requestFile, JSON.stringify(request));
      }
      const result = await runPrReviewProviderScopeEvidenceCommand([
        "remove-scratch",
        "--scratch-dir",
        fixture.resource,
        "--expected-snapshot-file",
        fixture.requestFile,
      ]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(await readFile(fixture.leasePath)).toEqual(original);
      for (const resource of fixture.resources) {
        if (complete || resource === fixture.resource)
          await expect(
            fsPromises.lstat(path.join(fixture.worktree, resource)),
          ).rejects.toMatchObject({ code: "ENOENT" });
        else
          expect(await readdir(path.join(fixture.worktree, resource))).toEqual([
            "failed-scope.json",
            "validator.stderr",
          ]);
      }
    },
  );

  it("guarded family recovery preserves partial effects across both directories", async () => {
    const fixture = await makeGuardedScratchCleanupFixture(true);
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    let count = 0;
    vi.mocked(fsPromises.rm).mockImplementation(async (...args) => {
      await actual.rm(...args);
      if (++count === 3) throw new Error("interrupt second guarded directory");
    });
    const held = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(JSON.parse(held.stdout)).toMatchObject({
      outcome: "held",
      reason: "interrupt second guarded directory",
    });
    await expect(
      fsPromises.lstat(
        path.join(fixture.worktree, fixture.resources[0] as string),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readdir(
        path.join(fixture.worktree, fixture.resources[1] as string),
      ),
    ).toEqual(["validator.stderr"]);
    expect(await readFile(fixture.leasePath, "utf8")).toBe(fixture.leaseBytes);
    expect(JSON.parse(held.stdout).targets).toEqual([
      { resource: fixture.resources[0], status: "completed", present: [] },
      {
        resource: fixture.resources[1],
        status: "remaining",
        present: [`${fixture.resources[1]}/validator.stderr`],
      },
    ]);
    vi.mocked(fsPromises.rm).mockImplementation(actual.rm);
    const resumed = await runPrReviewProviderScopeEvidenceCommand([
      "remove-scratch",
      "--scratch-dir",
      fixture.resource,
      "--expected-snapshot-file",
      fixture.requestFile,
    ]);
    expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0);
    expect(await readFile(fixture.leasePath, "utf8")).toBe(fixture.leaseBytes);
  });

  it.each(["before", "after"] as const)(
    "current producer retries interruption %s custody release without persistent history",
    async (when) => {
      const fixture = await makeEnrolledRetirementFixture("aborted");
      const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
      const original = await readFile(leasePath, "utf8");
      const actualWrite = artifacts.writeTextAtomically;
      const spy = vi
        .spyOn(artifacts, "writeTextAtomically")
        .mockImplementationOnce(async (target, bytes) => {
          expect(target).toBe(leasePath);
          if (when === "after") await actualWrite(target, bytes);
          throw new Error(`interrupt ${when} custody release`);
        });
      let held: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>;
      try {
        held = await runPrReviewLeasesCommand([
          "retire-attempt",
          "--request-file",
          fixture.requestFile,
        ]);
      } finally {
        spy.mockRestore();
      }
      expect(JSON.parse(held.stdout)).toMatchObject({
        outcome: "held",
        reason: `interrupt ${when} custody release`,
      });
      expect(
        await readdir(path.join(fixture.worktree, fixture.resource)),
      ).toEqual(["failed-scope.json", "validator.stderr"]);
      const current = await readFile(leasePath, "utf8");
      if (when === "before") expect(current).toBe(original);
      else {
        expect(JSON.parse(current).preparation_failures).toBeUndefined();
        const valid = await runPrReviewLeasesCommand(["validate"]);
        expect(valid.exitCode, valid.stderr).toBe(0);
      }
      for (let retry = 0; retry < 2; retry++) {
        const result = await runPrReviewLeasesCommand([
          "retire-attempt",
          "--request-file",
          fixture.requestFile,
        ]);
        expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      }
      const valid = await runPrReviewLeasesCommand(["validate"]);
      expect(valid.exitCode, valid.stderr).toBe(0);
      expect(
        (await readdir(path.join(fixture.physicalPrimary, ".ephemeral"))).some(
          (name) => name.includes("-retirement-enrolled-retirement"),
        ),
      ).toBe(false);
    },
  );

  it.each(["leaf", "directory", "missing-original-record"] as const)(
    "requires original association for first-call enrolled absence: %s",
    async (dimension) => {
      const fixture = await makeEnrolledRetirementFixture("aborted");
      const target = path.join(fixture.worktree, fixture.resource);
      await fsPromises.rm(
        dimension === "leaf" ? path.join(target, "failed-scope.json") : target,
        { recursive: dimension !== "leaf" },
      );
      if (dimension === "missing-original-record")
        await fsPromises.rm(fixture.recordFile);
      const before = await readFile(
        path.join(fixture.physicalPrimary, fixture.leaseFile),
      );
      const result = await runPrReviewLeasesCommand([
        "retire-attempt",
        "--request-file",
        fixture.requestFile,
      ]);
      if (dimension === "missing-original-record") {
        expect(result.exitCode).toBe(1);
        expect(
          await readFile(path.join(fixture.physicalPrimary, fixture.leaseFile)),
        ).toEqual(before);
        expect(
          (await readLease(fixture.physicalPrimary, fixture.leaseFile))
            .preparation_failures,
        ).toHaveLength(1);
      } else {
        expect(result.exitCode, result.stderr + result.stdout).toBe(0);
        expect(
          (await readLease(fixture.physicalPrimary, fixture.leaseFile))
            .preparation_failures,
        ).toBeUndefined();
        const valid = await runPrReviewLeasesCommand(["validate"]);
        expect(valid.exitCode, valid.stderr).toBe(0);
        await expect(fsPromises.lstat(target)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    },
  );

  it.each(["conflict", "after-release-changed"] as const)(
    "holds selected enrolled target on %s without inventing custody",
    async (dimension) => {
      const fixture = await makeEnrolledRetirementFixture("aborted");
      const leasePath = path.join(fixture.physicalPrimary, fixture.leaseFile);
      const actual =
        await vi.importActual<typeof fsPromises>("node:fs/promises");
      if (dimension === "conflict") {
        const lease = await readLease(
          fixture.physicalPrimary,
          fixture.leaseFile,
        );
        const record = lease.preparation_failures?.[0];
        if (!record) throw new Error("fixture must retain enrolled custody");
        record.scope_sha256 = "a".repeat(64);
        await writeFile(leasePath, JSON.stringify(lease));
      } else {
        vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
          await actual.rm(...args);
          throw new Error("interrupt after first enrolled leaf");
        });
        const held = await runPrReviewLeasesCommand([
          "retire-attempt",
          "--request-file",
          fixture.requestFile,
        ]);
        expect(held.exitCode).toBe(1);
        expect(
          (await readLease(fixture.physicalPrimary, fixture.leaseFile))
            .preparation_failures,
        ).toBeUndefined();
        const valid = await runPrReviewLeasesCommand(["validate"]);
        expect(valid.exitCode, valid.stderr).toBe(0);
        await writeFile(
          path.join(fixture.worktree, fixture.resource, "validator.stderr"),
          "changed remaining bytes\n",
        );
      }
      const before = await readFile(leasePath);
      const present = await Promise.all(
        (await readdir(path.join(fixture.worktree, fixture.resource))).map(
          (name) =>
            readFile(path.join(fixture.worktree, fixture.resource, name)),
        ),
      );
      const result = await runPrReviewLeasesCommand([
        "retire-attempt",
        "--request-file",
        fixture.requestFile,
      ]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(1);
      expect(JSON.parse(result.stdout).reason).toContain(
        dimension === "conflict" ? "custody conflicts" : "bytes changed",
      );
      expect(await readFile(leasePath)).toEqual(before);
      expect(
        await Promise.all(
          (await readdir(path.join(fixture.worktree, fixture.resource))).map(
            (name) =>
              readFile(path.join(fixture.worktree, fixture.resource, name)),
          ),
        ),
      ).toEqual(present);
    },
  );

  it("retires two source-produced failed directories before canonical continuation", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    try {
      const records: { file: string; sha256: string }[] = [];
      process.chdir(fixture.worktree);
      Object.assign(process.env, {
        REPOSITORY: "owner/repo",
        PR_NUMBER: "432",
      });
      for (const index of [1, 2]) {
        const record = path.join(
          fixture.repository.physicalRepository,
          `.ephemeral/original-${index}.json`,
        );
        const allocation = await runPrReviewProviderScopeEvidenceCommand([
          "allocate-original",
          "--record-file",
          record,
        ]);
        expect(allocation.exitCode, allocation.stderr).toBe(0);
        const directory = allocation.stdout.trim();
        await writeFile(
          path.join(fixture.worktree, directory, "failed-scope.json"),
          `{ "invalid": ${index} }\n`,
        );
        await writeFile(
          path.join(fixture.worktree, directory, "validator.stderr"),
          "semantic check failed\n",
        );
        const sealed = await runPrReviewProviderScopeEvidenceCommand([
          "seal-original",
          "--record-file",
          record,
        ]);
        expect(sealed.exitCode, sealed.stderr).toBe(0);
        records.push({ file: record, sha256: await sha256File(record) });
      }
      process.chdir(fixture.repository.physicalRepository);
      setTerminalAdvanceEnv(
        fixture.repository.physicalRepository,
        fixture.newHead,
      );
      await expectTerminalAdvanceUnchanged(
        fixture,
        await runPrReviewLeasesCommand(["session-create"]),
      );
      const requestFile = path.join(
        fixture.repository.physicalRepository,
        ".ephemeral/retirement-request.json",
      );
      await writeFile(
        requestFile,
        JSON.stringify({
          schema: "pr-review/attempt-retirement/v1",
          repository: "owner/repo",
          pr_number: 432,
          worktree_path: fixture.worktree,
          old_head: fixture.oldHead,
          lease_file: path.relative(
            fixture.repository.physicalRepository,
            fixture.leasePath,
          ),
          original_records: records,
          authority_ref: "original-owner/current-correction",
          active_consumers: [],
          pending_effects: [],
          publication: { status: "not-required", references: [] },
        }),
      );
      const retired = await runPrReviewLeasesCommand([
        "retire-attempt",
        "--request-file",
        requestFile,
      ]);
      expect(retired.exitCode, retired.stderr).toBe(0);
      expect(JSON.parse(retired.stdout)).toMatchObject({ outcome: "retired" });
      const replay = await runPrReviewLeasesCommand([
        "retire-attempt",
        "--request-file",
        requestFile,
      ]);
      expect(replay.exitCode, replay.stderr).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({ outcome: "retired" });
      const continued = await runPrReviewLeasesCommand(["session-create"]);
      expect(continued.exitCode, continued.stderr).toBe(0);
      expect(JSON.parse(continued.stdout)).toMatchObject({
        outcome: "success",
        immutable_head: fixture.newHead,
      });
      const successor = JSON.parse(await readFile(fixture.leasePath, "utf8"));
      expect(successor).toMatchObject({
        state: "created",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
        },
        github: { github_post_attempted: false },
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it.each([
    "changed",
    "extra",
    "symlink",
    "active-reader",
    "publication",
    "concurrent",
    "obsolete-lease-digest",
    "unknown-producer",
    "current-hash-only",
    "duplicate-member",
  ])(
    "holds original scratch without destructive effects: %s",
    async (dimension) => {
      const fixture = await makeAttemptRetirementFixture();
      const before = await readFile(fixture.recordFile, "utf8");
      const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
      const scopeFile = path.join(
        fixture.worktree,
        fixture.resource,
        "failed-scope.json",
      );
      if (dimension === "changed") await writeFile(scopeFile, "changed");
      if (dimension === "extra")
        await writeFile(
          path.join(fixture.worktree, fixture.resource, "extra"),
          "unknown",
        );
      if (dimension === "symlink")
        await symlink(
          scopeFile,
          path.join(fixture.worktree, fixture.resource, "extra"),
        );
      if (dimension === "active-reader")
        request.active_consumers = ["reviewer"];
      if (dimension === "publication")
        request.publication = { status: "pending", references: [] };

      if (dimension === "concurrent")
        await writeFile(
          path.join(
            fixture.repository.physicalRepository,
            ".ephemeral/pr-432-session-create-reservation.json",
          ),
          "unknown reservation",
        );
      if (dimension === "obsolete-lease-digest")
        request.lease_sha256 = "a".repeat(64);
      if (
        dimension === "unknown-producer" ||
        dimension === "current-hash-only"
      ) {
        const record = JSON.parse(before);
        if (dimension === "unknown-producer") record.producer = "unknown";
        else {
          record.production = "allocated";
        }
        await writeFile(fixture.recordFile, JSON.stringify(record));
        request.original_records[0].sha256 = await sha256File(
          fixture.recordFile,
        );
      }
      let text = JSON.stringify(request);
      if (dimension === "duplicate-member")
        text = text.replace('"pr_number":', '"pr_number":999, "pr_number":');
      await writeFile(fixture.requestFile, text);
      const expectedScope = await readFile(scopeFile, "utf8");
      const result = await runPrReviewLeasesCommand([
        "retire-attempt",
        "--request-file",
        fixture.requestFile,
      ]);
      expect(result.exitCode, result.stdout).toBe(1);
      expect(await readFile(scopeFile, "utf8")).toBe(expectedScope);
      expect(await readFile(fixture.leasePath, "utf8")).toBe(
        fixture.leaseBytes,
      );
    },
  );

  it("retries interrupted retirement using present targets and current custody", async () => {
    const fixture = await makeAttemptRetirementFixture();
    const realRemove = (
      await vi.importActual<typeof fsPromises>("node:fs/promises")
    ).rm;
    vi.mocked(fsPromises.rm).mockImplementationOnce(async () => {
      throw new Error("interrupted destructive step");
    });
    const held = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(JSON.parse(held.stdout)).toMatchObject({ outcome: "held" });
    Object.assign(process.env, {
      WORKTREE_PATH: fixture.worktree,
      LEASE_FILE: path.relative(
        fixture.repository.physicalRepository,
        fixture.leasePath,
      ),
    });
    expect(await readFile(fixture.leasePath, "utf8")).toBe(fixture.leaseBytes);
    const inspected = await runPrReviewLeasesCommand(["inspect-worktree"]);
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    expect(inspected.stdout).toContain("CAN_REMOVE=no");

    vi.mocked(fsPromises.rm).mockImplementation(realRemove);
    const resumed = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({ outcome: "retired" });
    const request = JSON.parse(await readFile(fixture.requestFile, "utf8"));
    request.authority_ref = "different action";
    await writeFile(fixture.requestFile, JSON.stringify(request));
    const divergent = await runPrReviewLeasesCommand([
      "retire-attempt",
      "--request-file",
      fixture.requestFile,
    ]);
    expect(divergent.exitCode, divergent.stderr + divergent.stdout).toBe(0);
  });

  it("continues an exhausted failed attempt without fabricating an abort or approval", async () => {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const old = JSON.parse(fixture.leaseBytes);
    old.state = "failed";
    old.terminal.reason = null;
    old.failure = {
      phase: "review",
      reason: "incomplete route",
      recoverability: "recoverable",
    };
    await writeFile(fixture.leasePath, `${JSON.stringify(old, null, 2)}\n`);
    await writeContinuationRequest(fixture, "incomplete");
    const result = await runPrReviewLeasesCommand(["session-create"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: "success",
      immutable_head: fixture.newHead,
    });
    const successor = JSON.parse(await readFile(fixture.leasePath, "utf8"));
    expect(successor).toMatchObject({
      state: "created",
      failure: { phase: null },
      github: { github_post_attempted: false },
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
    });
    const archives = (await readdir(path.dirname(fixture.leasePath))).filter(
      (name) => name.endsWith("-failed-archived-lease.json"),
    );
    expect(archives).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(
          path.join(path.dirname(fixture.leasePath), archives[0]),
          "utf8",
        ),
      ),
    ).toMatchObject({
      state: "failed",
      terminal: { reason: null },
      failure: { reason: "incomplete route" },
    });
  });

  it.each(["reviewed", "gated", "failed"] as const)(
    "replaces completed unposted %s truthfully and clears successor authority",
    async (state) => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-completed-${state}-`,
        true,
      );
      await writeFile(
        path.join(workspace.physicalPrimary, ".git", "info", "exclude"),
        ".ephemeral/\n.worktrees/\n",
      );
      const leasePath = path.join(
        workspace.physicalPrimary,
        workspace.leaseFile,
      );
      const old = JSON.parse(await readFile(leasePath, "utf8"));
      old.state = state;
      if (state === "failed") {
        old.failure = {
          phase: "preview-render",
          reason: "mechanical finalization failed",
          recoverability: "recoverable",
        };
        old.terminal.finished_at = "2026-06-11T00:03:00Z";
        old.updated_at = "2026-06-11T00:03:00Z";
      }
      const oldBytes = `${JSON.stringify(old, null, 2)}\n`;
      await writeFile(leasePath, oldBytes);
      await writeFile(
        path.join(workspace.physicalPrimary, "next.txt"),
        "corrective commit\n",
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "add",
        "next.txt",
      ]);
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "commit",
        "-m",
        "corrective commit",
      ]);
      const newHead = (
        await execFileAsync("git", [
          "-C",
          workspace.physicalPrimary,
          "rev-parse",
          "HEAD",
        ])
      ).stdout.trim();
      setReadStatusEnv(workspace);
      await writeContinuationRequest(
        {
          repository: { physicalRepository: workspace.physicalPrimary },
          leasePath,
          worktree: workspace.physicalWorktree,
          oldHead: workspace.reviewHead,
          newHead,
        },
        "completed",
      );
      const discovery = await runPrReviewLeasesCommand(["discover"]);
      expect(
        JSON.parse(discovery.stdout).active,
        discovery.stdout,
      ).toMatchObject([
        {
          classification: "resumable",
          worktree_dirty: false,
          unmanaged_ephemeral_artifacts: false,
        },
      ]);
      const result = await runPrReviewLeasesCommand(["session-create"]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "success",
        immutable_head: newHead,
      });
      const successor = JSON.parse(await readFile(leasePath, "utf8"));
      expect(successor).toMatchObject({
        state: "created",
        artifacts: {
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: { result_manifest: { status: null } },
        presentation: { status: null },
        failure: { phase: null },
        github: { github_post_attempted: false },
      });
      const archive = (await readdir(path.dirname(leasePath))).find((name) =>
        name.endsWith(`-${state}-archived-lease.json`),
      );
      expect(archive).toBeDefined();
      expect(
        await readFile(
          path.join(path.dirname(leasePath), archive as string),
          "utf8",
        ),
      ).toBe(oldBytes);
    },
  );

  it.each([
    "active",
    "provider-head",
    "frozen",
    "attempted-post",
    "false-completion",
    "unavailable-continuity",
  ])(
    "refuses unqualified continuation before head or lease mutation: %s",
    async (dimension) => {
      const fixture = await makeTerminalAdvanceRefusalFixture({
        canonical: true,
      });
      const old = JSON.parse(fixture.leaseBytes);
      old.state = "failed";
      old.terminal.reason = null;
      old.failure = {
        phase: "review",
        reason: "incomplete route",
        recoverability: "recoverable",
      };
      await writeFile(fixture.leasePath, `${JSON.stringify(old, null, 2)}\n`);
      await writeContinuationRequest(fixture, "incomplete");
      const requestFile = process.env.CONTINUATION_REQUEST_FILE as string;
      const request = JSON.parse(await readFile(requestFile, "utf8"));
      if (dimension === "active") request.active_consumers = ["reviewer"];
      if (dimension === "provider-head") request.target_head = fixture.oldHead;
      if (dimension === "false-completion") request.baseline = "completed";
      if (dimension === "unavailable-continuity")
        request.continuity = [
          {
            file: path.join(
              fixture.repository.physicalRepository,
              ".ephemeral/missing.json",
            ),
            sha256: "a".repeat(64),
          },
        ];
      if (dimension === "frozen")
        old.artifacts.approved_review_file =
          ".ephemeral/frozen-approved-review.json";
      if (dimension === "attempted-post") {
        old.github.github_post_attempted = true;
        old.github.github_post_result = "failed";
      }
      if (["frozen", "attempted-post"].includes(dimension)) {
        await writeFile(fixture.leasePath, `${JSON.stringify(old, null, 2)}\n`);
        request.lease_sha256 = await sha256File(fixture.leasePath);
      }
      await writeFile(requestFile, JSON.stringify(request));
      const bytes = await readFile(fixture.leasePath, "utf8");
      const result = await runPrReviewLeasesCommand(["session-create"]);
      expect(result.exitCode).toBe(1);
      expect(await readFile(fixture.leasePath, "utf8")).toBe(bytes);
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
    },
  );

  it.each(["primary", "sibling"] as const)(
    "reads usable existing continuation baseline from accessible custody: %s",
    async (location) => {
      const fixture = await makeIncompleteContinuationFixture();
      const primary = fixture.repository.physicalRepository;
      let custodyRoot = primary;
      if (location === "sibling") {
        custodyRoot = path.join(primary, ".worktrees", "continuity-sibling");
        await execFileAsync("git", [
          "-C",
          primary,
          "worktree",
          "add",
          "--detach",
          custodyRoot,
          fixture.oldHead,
        ]);
        custodyRoot = await realpath(custodyRoot);
        await mkdir(path.join(custodyRoot, ".ephemeral"));
      }
      const file = path.join(custodyRoot, ".ephemeral/continuity.json");
      await writeFile(file, fixture.handoffBytes);
      const requestFile = process.env.CONTINUATION_REQUEST_FILE as string;
      const request = JSON.parse(await readFile(requestFile, "utf8"));
      request.continuity = [{ file, sha256: await sha256File(file) }];
      await writeFile(requestFile, JSON.stringify(request));
      const result = await runPrReviewLeasesCommand(["session-create"]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(await readFile(file, "utf8")).toBe(fixture.handoffBytes);
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
    },
  );

  it.each([
    ["https://github.com/owner/repo/not-an-issue", false],
    ["https://github.com/owner/repo/issues/no-number", false],
    ["https://github.com/owner/repo/pull/123/extra", false],
    ["https://github.com/other/repo/issues/123", false],
    ["https://github.com/owner/repo/issues/123#issuecomment-456", true],
    ["https://github.com/owner/repo/pull/789", true],
  ] as const)(
    "validates continuation publication grammar before effects: %s",
    async (reference, valid) => {
      const fixture = await makeIncompleteContinuationFixture();
      const requestFile = process.env.CONTINUATION_REQUEST_FILE as string;
      const request = JSON.parse(await readFile(requestFile, "utf8"));
      request.publication = { status: "published", references: [reference] };
      await writeFile(requestFile, JSON.stringify(request));
      const before = await readFile(fixture.leasePath, "utf8");
      const result = await runPrReviewLeasesCommand(["session-create"]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(
        valid ? 0 : 1,
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
      ).toBe(valid ? fixture.newHead : fixture.oldHead);
      if (!valid) {
        expect(await readFile(fixture.leasePath, "utf8")).toBe(before);
        expect(
          await readFile(
            path.join(fixture.worktree, fixture.handoffFile),
            "utf8",
          ),
        ).toBe(fixture.handoffBytes);
        await expect(
          lstat(
            path.join(
              fixture.repository.physicalRepository,
              ".ephemeral/pr-432-session-create-reservation.json",
            ),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );
});
