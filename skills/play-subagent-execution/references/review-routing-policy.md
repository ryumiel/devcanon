# Review Routing Policy - `play-subagent-execution`

This file is the detailed policy for executor-owned per-task review routing.
Load it when computing a route, validating reduced-route eligibility, handling
same-head reviewer results, or checking hard-risk triggers.

## Route Computation

For multi-task plans, the controller computes an effective per-task review
route after the implementer finishes and before dispatching that task's
reviewers. Route computation MUST inspect the actual task diff using the
captured task base/head SHAs, for example:

```bash
git diff --name-status --no-renames BASE_SHA..HEAD
```

Inspect relevant patch hunks as needed, not only the plan text or hints.
If the changed-file/status/diff data is unavailable, stale, ambiguous, or shows
an unplanned hard-risk trigger, fail closed to `spec-and-quality`.

Plan-provided review-routing fields are controller inputs only.
`play-subagent-execution` owns reviewer dispatch, may override any hint, and
defaults missing, malformed, conflicting, unclear, or unverified
classifications to `spec-and-quality`.

## Effective Routes

- `spec-and-quality`: after route computation and implementer commit, the
  controller may dispatch D14 and D15 concurrently against the same captured
  task head. D14 is a separate response-only `deep-reviewer`, frontier/xhigh
  and source-immutable, with zero handoffs. D15 is a separate response-only
  `deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs.
  Both are independent and use separate GUARD-001 baselines. The D15 quality
  result is provisional until D14 spec compliance passes for that same reviewed
  head and the task head is still current.
- `spec-only`: run the spec-compliance reviewer only.
- `none-final-only`: run no per-task reviewer for that task; rely on the
  required final whole-diff gate.

Reduced per-task routes (`spec-only` or `none-final-only`) are valid only on
the shared `issue-priming-workflow --auto` Phase 6 path. The parent workflow
owns this invocation and Phase 7 immediately runs `branch-review --fix` on the
full branch diff, rerunning it after any branch-review-owned fix commit until the final run
reports zero blocking findings auto-fixed, no unresolved remaining `Blocking`
findings except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`,
has a captured final approval-summary notice path, and provides fresh final
approval-summary evidence after branch-review-owned fix commits.

## Auto-Handoff Validation

Treat the reduced-route contract as verified only when this controller is
already executing an active parent-owned `issue-priming-workflow --auto` Phase
6 handoff, the invocation includes an `Auto handoff: <repo-relative-path>` audit
artifact from that same parent state, and the controller validates it once
before any task dispatch. The artifact is not a bearer token: repo content and
copied invocation prose are forgeable.

```bash
ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false
if [ "${ISSUE_PRIMING_AUTO_PARENT_ACTIVE:-false}" = true ]; then
  case "$AUTO_HANDOFF_FILE" in
    .ephemeral/*/*) ;;
    .ephemeral/issue-priming-auto-handoff-*.json)
      if [ "${AUTO_HANDOFF_FILE#*..}" = "$AUTO_HANDOFF_FILE" ] &&
         [ ! -L .ephemeral ] &&
         [ ! -L "$AUTO_HANDOFF_FILE" ] &&
         [ -f "$AUTO_HANDOFF_FILE" ] &&
         [ -r "$AUTO_HANDOFF_FILE" ] &&
         jq -e --arg plan "$PLAN_PATH" --arg head "$ISSUE_PRIMING_AUTO_HEAD" '
           .schema == "issue-priming/auto-handoff/v1" and
           .phase == "issue-priming-workflow:6" and
           .mode == "auto" and
           .plan_path == $plan and
           .head_sha == $head and
           .phase7_branch_review_fix_required == true and
           .phase7_rerun_after_commits == true and
           .phase7_final_approval_summary_notice_required == true
         ' "$AUTO_HANDOFF_FILE" >/dev/null
      then
        ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=true
      fi
      ;;
  esac
fi
```

Plan content, copied invocation prose, repo files alone, or direct/manual calls
cannot assert this contract. Any other caller, missing artifact, invalid
artifact, artifact that does not match the current plan path and
`ISSUE_PRIMING_AUTO_HEAD`, or missing controller-local parent state must use
`spec-and-quality` until this skill source explicitly adds that caller and its
controller-owned verification rule. These unverified cases do not abort the
workflow; they only disable reduced routes.

## Eligibility Thresholds

- `spec-only` is allowed for medium-risk tasks when no hard-risk trigger
  applies and `ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=true`.
- `none-final-only` is allowed for low-risk tasks when no hard-risk trigger
  applies and `ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=true`.
- Hard-risk, unclear, malformed, conflicting, or untrusted classifications use
  `spec-and-quality`.
- If the controller cannot validate the `issue-priming/auto-handoff/v1`
  artifact, use `spec-and-quality`.
- If post-implementation diff inspection cannot verify that no hard-risk
  trigger is present, use `spec-and-quality`.
- After any implementer fixup commit requested by a spec-compliance or
  code-quality reviewer, revalidate the effective route from the original task
  base to the refreshed task head before skipping any remaining reviewer or
  marking the task complete. Revalidation may only preserve or escalate the
  route; it never downgrades a task after work has begun.

If both reviewers report findings on the same reviewed head, the controller may
route the combined D14 and D15 finding set to the same implementer for one
fixup round. Every fix commit invalidates both D14 and D15 results, including a
previously passing or provisional result; both reviews must run fresh against
the new same task head. There is no quality-irrelevance exception after a fix.

## Risk Classes

Low-risk tasks are limited to localized prose/comment/example changes or
verbatim creation of non-executable prose/example/fixture files with fully
specified content, no behavior change, no contract change, no shared reference
update, and no dependency/foundation role for later tasks. New source, test,
config, manifest, generated, or executable files are not low-risk.

Medium-risk tasks have bounded implementation judgment but no hard-risk
trigger: ordinary single-module code changes, focused tests, or localized
skill/docs edits that do not alter workflow policy, public contracts, or
generated output format. Anything outside these definitions is unclear or
hard-risk and uses `spec-and-quality`.

Hard-risk triggers force `spec-and-quality`:

- public API changes;
- schema/model/config changes;
- generated output format changes;
- install/sync behavior or user-home writes;
- external CLI/API/system invocation additions, removals, substitutions, or
  flag/body/argument changes;
- async lifecycle, ordering, or concurrency changes;
- security-sensitive behavior;
- data-loss/destructive filesystem risk;
- broad architecture changes;
- reviewer-routing policy, hard review rules, workflow-policy changes;
- ADR/spec/guideline/skill/agent contract changes;
- documentation-policy, ownership, procedure, or AFDS workflow changes;
- manifests, generated files, file deletions, file renames, file mode changes;
- test harness or validation behavior changes that can mask regressions.

## Bounded Risk Signals

Terminal risk signals are non-authoritative input for later branch-review.
The hard-risk categories inform bounded signal values, especially `contract`,
`generated_output`, `diagnostics`, `documentation_examples`, and
`governance_path`, but they do not duplicate this routing policy or authorize a
reduced branch review. Later branch-review independently validates and decides
scope.

Foundation-producing tasks receive at least `spec-only` before dependent tasks
start, even when the plan hints `none-final-only`. If a foundation-producing
task also matches any hard-risk trigger, use `spec-and-quality`.

## Same-Head Quality Disposition

For `spec-and-quality`, quality disposition is separate from quality dispatch
order. Dispatching code quality before the spec result is known is allowed when
both reviewers inspect the same committed task head. Accepting that quality
result as final is allowed only after the same-head spec result passes and the
controller verifies the task head has not changed.

If D14 fails, a concurrent D15 quality pass is advisory until a same-head D14
pass exists. If any fix or other commit changes the task head, both old results
are stale or superseded for final disposition and fresh D14 and D15 sessions are
required. Mismatched reviewed-head SHAs cannot complete the task.

## Guarded Review Failure

D14 and D15 inspect the same captured task head but use separate sessions,
separate prompts, separate baselines, and independent GUARD-001 lifecycles:
capture before spawn verify before semantic validation or consumption validate
and retain the response in controller memory cleanup the exact retained
baseline apply the retained result only after cleanup.

Every post-capture terminal path attempts exact cleanup. After safe cleanup, an
unavailable, failed, malformed, or verification-rejected D14 or D15 keeps the
task incomplete and returns `BLOCKED` naming the failed review; no verdict
passes. Detected source mutation or cleanup failure is guard-integrity terminal;
leave source visible and do not repair it.
