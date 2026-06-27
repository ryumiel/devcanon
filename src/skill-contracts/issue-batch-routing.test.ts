import { describe, expect, it } from "vitest";
import {
  getMarkdownSection,
  normalizeWhitespace,
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
      "last_routed_ci_run_check_identifier",
      "last_routed_merge_conflict_key",
      "last_routed_bot_review_signal_key",
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
    const duplicateRoutes = getMarkdownSection(skill, "Duplicate Route Keys");
    const approvalEvidence = getMarkdownSection(
      skill,
      "Parent Approval Evidence",
    );

    for (const routeKey of [
      "review-response",
      "ci-fix",
      "merge-conflict",
      "source-issue-state",
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
    ]) {
      expect(duplicateRoutes).toContain(stateIdentifier);
    }

    expect(approvalEvidence).toContain(
      "same source issue or PR, gate kind, route key, and allowed side effect",
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
    const monitorLoop = normalizeWhitespace(
      getMarkdownSection(skill, "Monitor Loop"),
    );
    const fixtures = normalizeWhitespace(
      getMarkdownSection(skill, "Routing Fixtures"),
    );

    expect(monitorLoop).toContain("If `owner_thread_id` is missing");
    expect(monitorLoop).toContain(
      "GitHub items route to `github-issue-priming`, Linear items route to `linear-issue-priming`",
    );
    expect(monitorLoop).toContain(
      "Record the created or located owner-thread mapping before continuing the item",
    );

    expect(fixtures).toContain("Missing `owner_thread_id` for a GitHub item");
    expect(fixtures).toContain("Route to `github-issue-priming`");
    expect(fixtures).toContain("Missing `owner_thread_id` for a Linear item");
    expect(fixtures).toContain("Route to `linear-issue-priming`");
  });

  it("keeps existing workflow boundaries and PR gate precedence explicit", async () => {
    const skill = await readSkillSource("issue-batch-routing");
    const boundaries = getMarkdownSection(
      skill,
      "Provider And Workflow Boundaries",
    );
    const prGates = getMarkdownSection(skill, "PR Gate Precedence");

    for (const boundary of [
      "`github-issue-priming` owns GitHub issue fetching",
      "`linear-issue-priming` owns Linear issue fetching",
      "`issue-priming-workflow` owns gate, research, brainstorming, planning, implementation, branch review, and Phase 8 PR-creation handoff and preconditions",
      "`play-review-response` owns review-thread replies and resolution behavior",
      "`github:gh-fix-ci` owns investigation and fixes for routed failing GitHub checks",
      "`pr-merge` owns GitHub PR CI polling inside the merge path, final merge execution, and merge-result reporting",
      "`branch-review` is used only when the owning workflow requires a local branch-review gate before PR update or merge",
      "`play-branch-finish` owns pushing branches, running PR creation side effects, posting caller-supplied assumptions or nits, and preserving the branch and worktree after PR creation",
      "`pr-authoring` owns PR title/body policy, title/body composition, and pre-merge title/body validation, but must not create, edit, comment on, or merge PRs",
      "source-issue status updates remain provider-specific delegated work",
    ]) {
      expect(boundaries).toContain(boundary);
    }

    for (const precedence of [
      "Draft PRs wait unless the owner thread reports that draft status is stale",
      "Repository or branch policy requiring explicit human merge approval blocks merge routing until that approval is present",
      "Active blocking review-bot signals block merge",
      "Stale approval signals tied to an older head SHA do not count",
      "Merge conflicts route to the owner thread",
      "Unresolved inline review threads route to the review-response workflow",
      "Failing CI routes to the CI-fix workflow only when the current failing run/check requires repair work outside PR-merge's normal polling scope",
      "Merge-ready PRs route to `pr-merge` only when all configured gates pass",
    ]) {
      expect(prGates).toContain(precedence);
    }
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
      "Repository policy requires explicit human merge approval",
      "Wait until matching human merge approval evidence is present",
      "PR has failing check run `A`",
      "Route CI-fix once for check run `A`",
      "PR has unresolved review-thread digest `B`",
      "Route review-response once for digest `B`",
      "PR is merge-conflicted at head `C`",
      "Route owner thread once by PR, head SHA, and mergeability state",
      "Owner thread reports approval gate `D`",
      "Send approval only when parent approval evidence matches",
      "Owner thread reports source-issue reporting gate `E`",
      "Route only to a provider-specific workflow that owns that source-issue side effect",
      "PR is non-draft, green, conflict-free, no unresolved threads",
      "Route `pr-merge` once with `last_routed_merge_routing_key`",
      "PR merged and owner thread reports terminal state",
      "Archive only after terminal PR or source state, no active gate, no pending work, and `last_routed_archival_key` recording",
    ]) {
      expect(fixtures).toContain(fixtureOutcome);
    }
  });
});
