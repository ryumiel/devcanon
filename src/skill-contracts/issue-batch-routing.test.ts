import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

function getMarkdownSubsection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^### ${escapedHeading}\\s*$`, "m");
  const startMatch = headingPattern.exec(content);

  expect(startMatch, `Missing markdown subsection: ${heading}`).not.toBeNull();

  const start = startMatch?.index ?? 0;
  const afterStart = start + (startMatch?.[0].length ?? 0);
  const nextHeading = /^### .+$/m.exec(content.slice(afterStart));
  const end = nextHeading ? afterStart + nextHeading.index : content.length;

  return content.slice(start, end).trim();
}

describe("issue-batch-routing skill contract", () => {
  it("defines a routing-only provider-neutral batch ledger", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const normalized = normalizeWhitespace(skill);
    const ledger = getMarkdownSection(skill, "Batch Ledger");

    expect(normalized).toContain(
      "routing workflow only: it may inspect, classify, route, send evidence-bound approvals, and report",
    );

    for (const forbiddenSideEffect of [
      "must not directly implement code fixes",
      "must not author review responses",
      "must not rerun CI outside the delegated workflow",
      "must not merge PRs directly",
      "must not mutate source-issue status directly",
      "must not bypass owning workflows",
    ]) {
      expect(normalized).toContain(forbiddenSideEffect);
    }

    for (const field of [
      "source_provider",
      "source_issue_identifier",
      "source_issue_title",
      "owner_thread_id",
      "branch_name",
      "pr_provider",
      "pr_identifier",
      "current_head_sha",
      "current_gate_kind",
      "source_issue_state_snapshot_digest",
      "last_owner_thread_report_digest",
      "last_routed_review_thread_set_digest",
      "last_routed_review_response_route_key",
      "last_routed_ci_run_check_identifier",
      "last_routed_ci_fix_route_key",
      "last_routed_merge_conflict_key",
      "last_routed_bot_review_signal_key",
      "last_routed_source_issue_reporting_route_key",
      "last_routed_approval_gate_key",
      "last_routed_merge_routing_key",
      "last_routed_archival_key",
    ]) {
      expect(ledger).toContain(field);
    }

    expect(normalized).toContain("source_provider: github | linear");
    expect(normalized).toContain(
      "Unknown provider states are reported as waiting rather than coerced into GitHub or Linear terminology",
    );
  });

  it("pins route de-duplication and current-state approval evidence", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const normalized = normalizeWhitespace(skill);
    const ledger = getMarkdownSection(skill, "Batch Ledger");
    const normalizedLedger = normalizeWhitespace(ledger);
    const duplicateRoutes = getMarkdownSection(skill, "Duplicate Route Keys");
    const normalizedDuplicateRoutes = normalizeWhitespace(duplicateRoutes);
    const approvalEvidence = getMarkdownSection(
      skill,
      "Parent Approval Evidence",
    );
    const normalizedApprovalEvidence = normalizeWhitespace(approvalEvidence);

    for (const routeKey of [
      "review-response",
      "ci-fix",
      "merge-conflict",
      "source-issue-state",
      "source-issue-reporting",
      "approval-gate",
      "bot-review-signal",
      "merge-routing",
      "archival",
    ]) {
      expect(duplicateRoutes).toContain(routeKey);
    }

    for (const stateIdentifier of [
      "source provider",
      "source issue identifier",
      "PR provider",
      "PR identifier",
      "head SHA",
      "check run ID",
      "unresolved-thread-set digest",
      "mergeability state",
      "source-issue state digest",
      "bot signal digest",
      "approval-gate digest",
      "owner-thread report digest",
      "requested provider-specific side effect",
    ]) {
      expect(duplicateRoutes).toContain(stateIdentifier);
    }

    expect(approvalEvidence).toContain(
      "same source issue or PR, gate kind, route key, and allowed side effect",
    );
    expect(ledger).toContain("`last_reported_approval_waiting_key`");
    expect(normalizedLedger).toContain(
      "Waiting or report-only approval-gate key recorded when approval evidence is missing, stale, or too broad",
    );
    expect(normalizedLedger).toContain(
      "`last_routed_approval_gate_key` records only actual approval routes sent after matching approval evidence is present",
    );
    expect(normalizedDuplicateRoutes).toContain(
      "Report-only waiting state must not update `last_routed_approval_gate_key`",
    );
    expect(normalizedDuplicateRoutes).toContain(
      "`source-issue-reporting` is distinct from `source-issue-state` and must not reuse the source-state monitoring key for provider-specific reporting side effects",
    );
    expect(normalizedDuplicateRoutes).toContain(
      "`approval-gate` route keys include the source-issue state digest so source-state changes invalidate pre-PR approval routing",
    );
    expect(normalizedApprovalEvidence).toContain(
      "Missing, stale, or broad approval evidence may update only `last_reported_approval_waiting_key`",
    );
    expect(normalizedApprovalEvidence).toContain(
      "it must not consume the actual approval route key that suppresses sending a later matching approval",
    );

    for (const expiry of [
      "PR head changes",
      "unresolved-thread set changes",
      "failing CI run/check changes",
      "mergeability state changes",
      "source-issue state changes",
      "owner thread reports a newer gate",
    ]) {
      expect(approvalEvidence).toContain(expiry);
    }

    expect(normalized).toContain("preserve branch continuity");
    expect(normalized).toContain("forbid force-push");
  });

  it("routes missing owner threads through provider-specific issue priming", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const ledger = normalizeWhitespace(
      getMarkdownSection(skill, "Batch Ledger"),
    );
    const duplicateRoutes = normalizeWhitespace(
      getMarkdownSection(skill, "Duplicate Route Keys"),
    );
    const monitorLoop = normalizeWhitespace(
      getMarkdownSection(skill, "Monitor Loop"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(ledger).toContain("`last_routed_issue_priming_route_key`");
    expect(ledger).toContain(
      "Full replay-sensitive issue-priming route key last sent",
    );

    expect(duplicateRoutes).toContain(
      "`issue-priming` | source provider, source issue identifier, source-issue state digest, provider-native entrypoint argument, missing-owner state",
    );
    expect(duplicateRoutes).toContain(
      "`issue-priming` route keys suppress duplicate source-specific priming while `owner_thread_id` remains missing for the same complete key",
    );
    expect(duplicateRoutes).toContain(
      "Missing source-state digest or provider-native entrypoint argument makes the issue-priming key incomplete and must fail closed to waiting or manual action",
    );

    expect(monitorLoop).toContain("If `owner_thread_id` is missing");
    expect(monitorLoop).toContain(
      "GitHub items route to `github-issue-priming`, Linear items route to `linear-issue-priming`",
    );
    expect(monitorLoop).toContain(
      "Convert provider-prefixed `source_issue_identifier` values into provider-native entrypoint arguments before invoking source-specific issue priming",
    );
    expect(monitorLoop).toContain(
      "GitHub conversion must preserve repository identity as a full issue URL, or as a bare issue number only when current repository context is explicitly proven",
    );
    expect(monitorLoop).toContain(
      "Linear conversion must pass an accepted Linear identifier such as `ENG-123` or a Linear issue URL",
    );
    expect(monitorLoop).toContain(
      "If provider-native conversion cannot be proven, report waiting instead of guessing",
    );
    expect(monitorLoop).toContain(
      "Before routing source-specific issue priming, compute the complete `issue-priming` route key from source provider, source issue identifier, source-state digest, provider-native entrypoint argument, and missing-owner state",
    );
    expect(monitorLoop).toContain(
      "If `last_routed_issue_priming_route_key` already matches that complete key and `owner_thread_id` is still missing, wait, inspect, or report instead of routing another source-specific priming entrypoint",
    );
    expect(monitorLoop).toContain(
      "Record `last_routed_issue_priming_route_key` before or at handoff",
    );
    expect(monitorLoop).toContain(
      "Record the created or located owner-thread mapping before continuing the item",
    );

    expect(fixtures).toContain("Missing `owner_thread_id` for a GitHub item");
    expect(fixtures).toContain("Route to `github-issue-priming`");
    expect(fixtures).toContain(
      "Active GitHub source issue `github:owner/repo#123` with missing `owner_thread_id`",
    );
    expect(fixtures).toContain(
      "Convert to the full issue URL before routing to `github-issue-priming`; use a bare issue number only when current repository context is explicitly proven, and do not pass the prefixed ledger key or `owner/repo#123` shorthand",
    );
    expect(fixtures).toContain("Missing `owner_thread_id` for a Linear item");
    expect(fixtures).toContain("Route to `linear-issue-priming`");
    expect(fixtures).toContain(
      "Active Linear source issue `linear:ENG-123` with missing `owner_thread_id`",
    );
    expect(fixtures).toContain(
      "Convert to `ENG-123` or a Linear issue URL before routing to `linear-issue-priming`; do not pass the prefixed ledger key",
    );
    expect(fixtures).toContain(
      "Active GitHub source issue `github:owner/repo#511` at source-state digest `S1` has missing `owner_thread_id`, provider-native entrypoint argument `https://github.com/owner/repo/issues/511`, and matching `last_routed_issue_priming_route_key` already recorded",
    );
    expect(fixtures).toContain(
      "Wait, inspect, or report instead of routing another `github-issue-priming` call while `owner_thread_id` remains missing",
    );
    expect(fixtures).toContain(
      "Missing source-state digest or provider-native entrypoint argument for an issue-priming route key",
    );
    expect(fixtures).toContain(
      "Report waiting or manual action; do not route source-specific issue priming with an incomplete replay key",
    );
  });

  it("keeps existing workflow boundaries and PR gate precedence explicit", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const boundaries = getMarkdownSection(
      skill,
      "Provider And Workflow Boundaries",
    );
    const normalizedBoundaries = normalizeWhitespace(boundaries);
    const prGates = getMarkdownSection(skill, "PR Gate Precedence");

    for (const boundary of [
      "`github-issue-priming` owns GitHub issue fetching",
      "`linear-issue-priming` owns Linear issue fetching",
      "`issue-priming-workflow` owns gate, research, brainstorming, planning, implementation, branch review, and Phase 8 PR-creation handoff and preconditions",
      "`play-review-response` owns review-thread replies and resolution behavior",
      "CI-fix routing uses an available provider-specific CI-failure repair skill or workflow capability for the PR provider",
      "Availability requires observable capability evidence from the current session skill/workflow catalog or an explicit parent-provided provider-specific CI-fix workflow name",
      "`github:gh-fix-ci` is allowed only when it appears as observed session-provided capability evidence",
      "If no provider-specific CI-fix workflow is available for the PR provider, failing CI waits",
      "`pr-merge` owns GitHub PR CI polling inside the merge path, final merge execution, and merge-result reporting",
      "`branch-review` is used only when the owning workflow requires a local branch-review gate before PR update or merge",
      "`play-branch-finish` owns pushing branches, running PR creation side effects, posting caller-supplied assumptions or nits, and preserving the branch and worktree after PR creation",
      "`pr-authoring` owns PR title/body policy, title/body composition, and pre-merge title/body validation, but must not create, edit, comment on, or merge PRs",
      "source-issue status updates remain provider-specific delegated work",
      "If no provider-specific source-issue reporting workflow is available for the source provider and requested source-specific side effect, report waiting or manual action with the missing workflow and next safe action",
      "do not mutate the source issue directly",
      "do not route to a generic fallback workflow",
    ]) {
      expect(normalizedBoundaries).toContain(boundary);
    }

    const mergeConflictIndex = prGates.indexOf("Merge conflicts route");
    const reviewResponseIndex = prGates.indexOf(
      "Unresolved inline review threads route",
    );
    const ciFixIndex = prGates.indexOf("Failing CI routes");
    const humanApprovalIndex = prGates.indexOf(
      "Otherwise merge-ready PRs that require explicit human merge approval wait",
    );
    const mergeReadyIndex = prGates.indexOf("Merge-ready PRs route");

    expect(mergeConflictIndex).toBeGreaterThanOrEqual(0);
    expect(reviewResponseIndex).toBeGreaterThanOrEqual(0);
    expect(ciFixIndex).toBeGreaterThanOrEqual(0);
    expect(humanApprovalIndex).toBeGreaterThanOrEqual(0);
    expect(mergeReadyIndex).toBeGreaterThanOrEqual(0);
    expect(mergeConflictIndex).toBeLessThan(humanApprovalIndex);
    expect(reviewResponseIndex).toBeLessThan(humanApprovalIndex);
    expect(ciFixIndex).toBeLessThan(humanApprovalIndex);
    expect(humanApprovalIndex).toBeLessThan(mergeReadyIndex);

    for (const precedence of [
      "Draft PRs wait unless the owner thread reports that draft status is stale",
      "Active blocking review-bot signals block merge",
      "Stale approval signals tied to an older head SHA do not count",
      "Merge conflicts route to the owner thread",
      "Unresolved inline review threads route to the review-response workflow",
      "same complete review-response route key, including source issue, PR provider, PR identifier, head SHA, and unresolved-thread-set digest",
      "Failing CI routes to the CI-fix workflow only when the current failing run/check requires repair work outside PR-merge's normal polling scope",
      "CI-fix routing also requires a provider-specific CI-fix workflow to be available",
      "When that workflow is unavailable, report waiting with the missing workflow",
      "Otherwise merge-ready PRs that require explicit human merge approval wait until matching human merge approval evidence is present",
      "Merge-ready PRs route to `pr-merge` only when all configured gates pass",
    ]) {
      expect(prGates).toContain(precedence);
    }

    expect(normalizedBoundaries).not.toContain(
      "`github:gh-fix-ci` owns investigation and fixes for routed failing GitHub checks",
    );
  });

  it("routes pending-but-otherwise-ready CI into pr-merge while preserving CI-fix repair routing", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const prGates = normalizeWhitespace(
      getMarkdownSection(skill, "PR Gate Precedence"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(prGates).toContain(
      "Pending CI routes to `pr-merge` for polling only after every non-CI merge gate is satisfied",
    );
    expect(prGates).toContain(
      "Non-CI merge gates include non-draft status, conflict-free or mergeable state, no unresolved review threads, no active blocking bot signal, branch protection and review state compatible with waiting for CI, required human merge approval when policy requires it, and any configured approving bot signal fresh for the current head SHA",
    );
    expect(prGates).toContain(
      "`pr-merge` may merge only after pending CI becomes green and current merge protections still pass",
    );
    expect(prGates).toContain(
      "Failing CI that requires repair is not pending merge-path polling",
    );

    expect(fixtures).toContain(
      "PR is non-draft, pending CI, conflict-free, no unresolved threads, no active blocking bot signal, branch protection and review state allow waiting for CI, required human approval is present, and fresh required approval signal is present",
    );
    expect(fixtures).toContain(
      "Route `pr-merge` once with `last_routed_merge_routing_key` for CI polling; `pr-merge` may merge only after CI becomes green and protections still pass",
    );
    expect(fixtures).toContain(
      "PR has failing CI that requires repair while non-CI merge gates are otherwise satisfied",
    );
    expect(fixtures).toContain(
      "Route to provider-specific CI-fix when available, or wait/manual action when unavailable; do not treat failing CI as pending `pr-merge` polling",
    );
  });

  it("requires observable CI-fix capability evidence and fails closed when missing", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const normalized = normalizeWhitespace(skill);
    const boundaries = normalizeWhitespace(
      getMarkdownSection(skill, "Provider And Workflow Boundaries"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(boundaries).toContain(
      "CI-fix routing uses an available provider-specific CI-failure repair skill or workflow capability for the PR provider",
    );
    expect(boundaries).toContain(
      "Availability requires observable capability evidence from the current session skill/workflow catalog or an explicit parent-provided provider-specific CI-fix workflow name",
    );
    expect(boundaries).toContain(
      "`github:gh-fix-ci` is allowed only when it appears as observed session-provided capability evidence",
    );
    expect(boundaries).toContain(
      "the router must not name it as a source-owned required workflow",
    );
    expect(boundaries).toContain(
      "Missing provider-specific CI-fix capability fails closed to waiting or manual action",
    );
    expect(boundaries).toContain(
      "do not rerun CI directly and do not fall back to `pr-merge` for repair outside the merge path",
    );

    expect(fixtures).toContain(
      "PR has failing check run `A` at head `H`, source issue `S`, PR provider `github`, PR `P`, and observable provider-specific GitHub CI-failure repair capability evidence",
    );
    expect(fixtures).toContain(
      "Route CI-fix once using that observed capability evidence",
    );
    expect(fixtures).toContain(
      "The same PR with no observable provider-specific CI-fix capability",
    );
    expect(fixtures).toContain(
      "Report waiting or manual action with the missing provider-specific CI-fix capability; do not name `github:gh-fix-ci` as a required source workflow",
    );

    expect(normalized).not.toContain(
      "`github:gh-fix-ci` owns investigation and fixes for routed failing GitHub checks",
    );
  });

  it("keeps shared router prose target-neutral across parent/controller thread wording", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const normalized = normalizeWhitespace(skill);
    const ledger = getMarkdownSection(skill, "Batch Ledger");

    expect(normalized).toContain(
      "Use this skill when a parent or controller thread is responsible",
    );
    expect(ledger).toContain(
      "Delegated owner thread that owns implementation or source-specific follow-up",
    );
    expect(ledger).not.toContain(
      "Parent/controller thread that owns implementation or source-specific follow-up",
    );
    expect(normalized).toContain("parent/controller thread");
    expect(normalized).not.toContain("parent Codex thread");
    expect(normalized).not.toContain(
      "`owner_thread_id` | Codex thread that owns implementation",
    );
  });

  it("uses current or configured base evidence for merge-conflict routing", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const duplicateRoutes = normalizeWhitespace(
      getMarkdownSection(skill, "Duplicate Route Keys"),
    );
    const prGates = normalizeWhitespace(
      getMarkdownSection(skill, "PR Gate Precedence"),
    );
    const approvalTemplates = normalizeWhitespace(
      getMarkdownSection(skill, "Safe Approval Templates"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(duplicateRoutes).toContain(
      "`merge-conflict` | source provider, source issue identifier, PR provider, PR identifier, head SHA, mergeability state, proven base branch or base evidence digest",
    );
    expect(prGates).toContain(
      "Merge conflicts route to the owner thread for the PR's current base branch when a PR exists, or for configured/default base evidence when no PR base is known",
    );
    expect(prGates).toContain(
      "Unknown base evidence waits instead of assuming `origin/main`",
    );
    expect(approvalTemplates).toContain(
      "Approve only the named owner thread to merge the PR's current base branch, or the configured/default base only when no PR base is known",
    );
    expect(approvalTemplates).toContain(
      "Do not assume `origin/main` unless that branch is proven as the current or configured base",
    );
    expect(fixtures).toContain(
      "PR is merge-conflicted at head `C` against proven base `release/1.x`",
    );
    expect(fixtures).toContain(
      "Route owner thread once by PR, head SHA, mergeability state, and proven base branch or base evidence digest",
    );
    expect(fixtures).toContain(
      "PR base changes after prior merge-conflict routing",
    );
    expect(fixtures).toContain(
      "Treat the changed base evidence as a new `merge-conflict` route key",
    );
    expect(fixtures).toContain("Merge-conflicted PR has unknown base evidence");
    expect(fixtures).toContain(
      "Report waiting with missing base evidence; do not assume `origin/main`",
    );
  });

  it("documents producer-owned owner-thread report obligations", async () => {
    const router = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("issue-batch-routing"),
        "Owner-Thread Gate Reports",
      ),
    );
    const github = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("github-issue-priming"),
        "Issue Batch Routing Reports",
      ),
    );
    const linear = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("linear-issue-priming"),
        "Issue Batch Routing Reports",
      ),
    );
    const workflow = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("issue-priming-workflow"),
        "Issue Batch Routing Reports",
      ),
    );
    const reviewResponse = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("play-review-response"),
        "Issue Batch Routing Reports",
      ),
    );
    const prMerge = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("pr-merge"),
        "Issue Batch Routing Reports",
      ),
    );

    expect(router).toContain(
      "If a named delegated workflow does not own a gate family or cannot produce the route-specific report fields, the router waits or reports manual action instead of assuming a report exists",
    );
    expect(router).toContain("Source entrypoints report only pre-handoff");
    expect(router).toContain(
      "`issue-priming-workflow` is the producer after source-entrypoint handoff",
    );

    for (const entrypoint of [github, linear]) {
      expect(entrypoint).toContain(
        "produces issue-batch-routing reports only for source-specific fetch, comment-evidence capture, worktree setup, and handoff blockers before `issue-priming-workflow` starts",
      );
      expect(entrypoint).toContain(
        "delegated owner-thread identity when known",
      );
      expect(entrypoint).toContain(
        "After successful handoff, `issue-priming-workflow` owns post-entrypoint implementation, approval, branch-review, PR creation, and terminal owner-thread reports",
      );
    }

    for (const obligation of [
      "research, brainstorming, or design ambiguity stops",
      "user or parent approval gates",
      "implementation blockers",
      "branch-review blockers",
      "Phase 8 PR readiness, creation, or update blockers",
      "created PR and current head result reports",
      "terminal owner-thread state",
      "source-issue reporting gates surfaced from implementation",
      "Source-issue reporting without an available provider-specific workflow becomes a parent/manual-action report",
    ]) {
      expect(workflow).toContain(obligation);
    }
    expect(workflow).toContain("delegated owner-thread identity when known");

    for (const obligation of [
      "review-response plan approval gates",
      "pre-push approval gates",
      "PR-update or review-response closeout blockers",
      "pushed head and verification result reports",
      "review-thread disposition reports",
      "does not own merge, source-issue status mutation, or generic CI repair outside review-response scope",
    ]) {
      expect(reviewResponse).toContain(obligation);
    }
    expect(reviewResponse).toContain(
      "delegated owner-thread identity when known",
    );
    expect(`${github} ${linear} ${workflow} ${reviewResponse}`).not.toContain(
      "owner/controller thread identity",
    );

    for (const obligation of [
      "merge approval waits",
      "CI polling timeout or failure",
      "in-scope CI investigation result",
      "merge-conflict blockers",
      "missing-review blockers",
      "missing-protection blockers",
      "merge result",
      "post-merge cleanup outcome",
      "terminal merge-path reports",
      "does not perform pre-merge review-response work or source-issue status mutation",
    ]) {
      expect(prMerge).toContain(obligation);
    }
  });

  it("requires pr-merge reports to be source-attributable for router reconciliation", async () => {
    const prMerge = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("pr-merge"),
        "Issue Batch Routing Reports",
      ),
    );

    for (const requiredField of [
      "source provider",
      "source issue identifier",
      "PR provider and identifier",
      "head SHA",
      "gate kind",
      "relevant complete route key",
      "merge/CI/protection evidence",
    ]) {
      expect(prMerge).toContain(requiredField);
    }

    expect(prMerge).toContain(
      "Reports missing source provider, source issue identifier, gate kind, or the relevant complete route key are incomplete for router reconciliation",
    );
    expect(prMerge).toContain(
      "the router should wait or request manual action instead of inferring the source item from PR-only identity",
    );
  });

  it("requires review-response reports to be source-attributable for router reconciliation", async () => {
    const reviewResponse = normalizeWhitespace(
      getMarkdownSection(
        await readSkillSource("play-review-response"),
        "Issue Batch Routing Reports",
      ),
    );

    for (const requiredField of [
      "source provider",
      "source issue identifier",
      "PR provider and identifier",
      "head SHA",
      "gate kind",
      "relevant complete review-response route key",
      "thread disposition",
      "verification result",
    ]) {
      expect(reviewResponse).toContain(requiredField);
    }

    expect(reviewResponse).toContain(
      "Reports that name only a source issue or PR identity without provider-tagged source identity are incomplete for mixed-batch reconciliation",
    );
    expect(reviewResponse).toContain(
      "the router or owning workflow should wait or request manual action instead of accepting PR-only disposition",
    );
  });

  it("keeps issue-batch-routing discoverable from navigation surfaces", async () => {
    const map = await readRepoFile("MAP.md");
    const agents = await readRepoFile("AGENTS.md");

    expect(map).toContain(
      "Where is provider-neutral issue batch routing? -> [`skills/issue-batch-routing/SKILL.md`](skills/issue-batch-routing/SKILL.md)",
    );
    expect(agents).toContain(
      "- `issue-batch-routing`: provider-neutral controller workflow for routing mixed GitHub and Linear issue batches across owner threads, PR gates, CI/review handoffs, merge routing, reporting, and archival.",
    );
  });

  it("requires source-state classification before missing-owner priming", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const monitorLoop = normalizeWhitespace(
      getMarkdownSection(skill, "Monitor Loop"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    const sourceStateIndex = monitorLoop.indexOf("Classify source-issue state");
    const missingOwnerIndex = monitorLoop.indexOf(
      "If `owner_thread_id` is missing",
    );

    expect(sourceStateIndex).toBeGreaterThanOrEqual(0);
    expect(missingOwnerIndex).toBeGreaterThanOrEqual(0);
    expect(sourceStateIndex).toBeLessThan(missingOwnerIndex);
    expect(monitorLoop).toContain(
      "Only active source issues with missing owner threads route to source-specific issue priming",
    );
    expect(monitorLoop).toContain(
      "Terminal, duplicate, abandoned, blocked, or unknown no-owner states wait or report",
    );

    expect(fixtures).toContain(
      "Active GitHub source issue with missing `owner_thread_id`",
    );
    expect(fixtures).toContain("Route to `github-issue-priming`");
    expect(fixtures).toContain(
      "Closed/completed source issue with missing `owner_thread_id`",
    );
    expect(fixtures).toContain(
      "Report waiting or terminal disposition; do not create an owner thread",
    );
  });

  it("pins replay-safe route-key persistence for review-response and CI-fix", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const ledger = getMarkdownSection(skill, "Batch Ledger");
    const normalizedLedger = normalizeWhitespace(ledger);
    const duplicateRoutes = getMarkdownSection(skill, "Duplicate Route Keys");
    const normalizedDuplicateRoutes = normalizeWhitespace(duplicateRoutes);
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(ledger).toContain("`last_routed_review_response_route_key`");
    expect(ledger).toContain("Full replay-sensitive review-response route key");
    expect(ledger).toContain("`last_routed_ci_fix_route_key`");
    expect(ledger).toContain("Full replay-sensitive CI-fix route key");
    expect(ledger).toContain("`last_routed_source_issue_reporting_route_key`");
    expect(ledger).toContain(
      "Full replay-sensitive source-issue reporting route key last sent",
    );
    expect(normalizedLedger).toContain(
      "`last_routed_ci_run_check_identifier` is diagnostic only and is not authoritative for de-duplication",
    );

    expect(normalizedDuplicateRoutes).toContain(
      "Persist the complete route key after routing; partial fields such as only the unresolved-thread-set digest or only the check identifier are diagnostic hints, not replay authority",
    );
    expect(fixtures).toContain(
      "Route CI-fix once for check run `A`, keyed by source issue `S`, PR provider `github`, PR `P`, head SHA `H`, and check run ID `A`",
    );
    expect(fixtures).toContain(
      "No provider-specific CI-fix workflow is available for failing check run `A`",
    );
    expect(fixtures).toContain(
      "Report waiting with the missing CI-fix workflow; do not rerun CI directly and do not fall back to `pr-merge` for repair",
    );
    expect(fixtures).toContain(
      "Owner thread reports source-issue reporting gate `E` at source-state digest `S1` with requested side effect `close-as-completed`",
    );
    expect(fixtures).toContain(
      "Route source-issue reporting once for the complete `source-issue-reporting` key including source issue, owner thread, gate/report digest, requested side effect, source-state digest `S1`, and head SHA when known",
    );
  });

  it("defines owner reports, safe approvals, archival, monitor reports, and automation resume behavior", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const ownerReports = getMarkdownSection(skill, "Owner-Thread Gate Reports");
    const approvalTemplates = getMarkdownSection(
      skill,
      "Safe Approval Templates",
    );
    const normalizedApprovalTemplates = normalizeWhitespace(approvalTemplates);
    const archival = getMarkdownSection(skill, "Archival Rules");
    const monitorReports = getMarkdownSection(skill, "Monitor Pass Reports");
    const automation = getMarkdownSection(skill, "Automation And Resume");

    for (const reportField of [
      "source provider",
      "source issue identifier",
      "owner thread ID",
      "branch",
      "PR provider and identifier",
      "head SHA",
      "gate kind",
      "requested parent action",
      "evidence that the thread is blocked",
      "source-specific side effects requested",
      "next safe command or workflow to route",
    ]) {
      expect(ownerReports).toContain(reportField);
    }

    for (const template of [
      "Plan execution approval",
      "PR update or review-response closeout",
      "Merge-conflict resolution",
      "Narrow CI rerun",
      "Merge routing",
      "Source-issue reporting",
      "Archival confirmation",
    ]) {
      expect(approvalTemplates).toContain(template);
    }

    expect(archival).toContain("Do not archive an owner thread until");
    expect(archival).toContain("PR is verified merged");
    expect(archival).toContain(
      "verified closed/completed source issue state without a PR",
    );
    expect(archival).toContain("terminal owner-thread state");
    expect(archival).toContain("no pending user or agent work remains");

    for (const templateInvariant of [
      "Every template must also preserve issue scope",
      "require current issue/PR/thread refetch before acting",
      "preserve branch continuity",
      "forbid force-push",
      "require relevant verification gates for the delegated workflow",
      "require final reporting back to the parent",
    ]) {
      expect(normalizedApprovalTemplates).toContain(templateInvariant);
    }

    for (const template of [
      "Plan execution approval",
      "PR update or review-response closeout",
      "Merge-conflict resolution",
      "Narrow CI rerun",
      "Merge routing",
      "Source-issue reporting",
      "Archival confirmation",
    ]) {
      const section = normalizeWhitespace(
        getMarkdownSubsection(approvalTemplates, template),
      );

      for (const perTemplateInvariant of [
        "Preserve issue scope",
        "require current issue/PR/thread refetch before acting",
        "preserve branch continuity",
        "forbid force-push",
        "verification gates",
        "parent",
      ]) {
        expect(section).toContain(perTemplateInvariant);
      }
    }

    for (const reportItem of [
      "merged or closed items",
      "routed items",
      "approval/thread-state actions",
      "waiting items with reasons",
      "owner-thread reports received",
      "source-issue status actions requested",
      "archived threads",
      "next check time",
    ]) {
      expect(monitorReports).toContain(reportItem);
    }

    expect(automation).toContain("carry known owner-thread mappings");
    expect(automation).toContain("discover newly created owner threads");
    expect(automation).toContain(
      "avoid stale routes after resume or context compaction",
    );
    expect(automation).toContain(
      "stop or pause monitoring when the batch reaches a terminal state",
    );
  });

  it("covers required routing fixture cases concretely", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    for (const fixtureOutcome of [
      "GitHub issue and Linear issue are in the same batch",
      "preserve `source_provider: github` and `source_provider: linear`",
      "Source issue state is unknown to the generic workflow",
      "Report waiting; do not mutate source issue status",
      "PR has active blocking bot signal",
      "Wait for bot review; do not merge",
      "PR has approving bot signal from old head SHA",
      "Treat the approval as stale",
      "Repository policy requires explicit human merge approval and PR is otherwise merge-ready",
      "Wait until matching human merge approval evidence is present",
      "PR has failing check run `A`",
      "Route CI-fix once for check run `A`",
      "PR has unresolved review-thread digest `B` at head `H`, source issue `S`, PR provider `github`, and PR `P`",
      "Route review-response once for the complete key: source issue `S`, PR provider `github`, PR `P`, head SHA `H`, and unresolved-thread-set digest `B`",
      "PR is merge-conflicted at head `C`",
      "Route owner thread once by PR, head SHA, and mergeability state",
      "Owner thread reports approval gate `D`",
      "Send approval only when parent approval evidence matches",
      "Owner thread reports source-issue reporting gate `E`",
      "Route only to a provider-specific workflow that owns that source-issue side effect",
      "Owner thread reports source-issue reporting gate `E` at source-state digest `S1` with requested side effect `close-as-completed`",
      "Route source-issue reporting once for the complete `source-issue-reporting` key including source issue, owner thread, gate/report digest, requested side effect, source-state digest `S1`, and head SHA when known",
      "Owner thread reports source-issue reporting gate `E`, but no provider-specific source-issue reporting workflow is available",
      "Report waiting or manual action with the missing source-issue reporting workflow and next safe action; do not mutate the source issue directly and do not route to a generic fallback workflow",
      "Source issue is verified closed/completed without a PR and owner thread reports terminal state",
      "Archive only after verified closed/completed source state, terminal owner-thread state, no active gate, no pending work, no unresolved follow-up, and `last_routed_archival_key` recording",
      "PR has unresolved review-thread digest `B` and lacks required human merge approval",
      "Route review-response before waiting for human merge approval",
      "PR is otherwise merge-ready but lacks required human merge approval",
      "Wait for matching human merge approval evidence; do not route to `pr-merge`",
      "PR is non-draft, green, conflict-free, no unresolved threads",
      "Route `pr-merge` once with `last_routed_merge_routing_key`",
      "PR merged and owner thread reports terminal state",
      "Archive only after terminal PR or source state, no active gate, no pending work, and `last_routed_archival_key` recording",
    ]) {
      expect(fixtures).toContain(fixtureOutcome);
    }
  });
});
