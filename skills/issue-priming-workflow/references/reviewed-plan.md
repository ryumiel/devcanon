# Design and Reviewed-Plan Procedure

## Phase 4: Invoke Brainstorming

After research, return to Preparation Selection. Invoke `play-brainstorm`
with the combined context below only when design/planning remains needed;
settled findings may instead support a guarded Execution Note.

`<source-noun>` below is `Linear` when `payload.source` is `linear` and `GitHub` when `payload.source` is `github`.

In every brainstorming skeleton, include the literal
`Comment evidence: <repo-relative-path>` line only when
`payload.comment-evidence-path` is present; otherwise omit the line entirely.

**Args format when research was done:**

```
Resolve <source-noun> issue <ID>: <TITLE>

Issue body: <repo-relative-path from payload.issue-body-path>

Comment evidence: <repo-relative-path from payload.comment-evidence-path>

Research brief: <repo-relative-path captured from Phase 3's notice line>
```

`play-brainstorm` validates required issue-body/research paths plus the
optional comment-evidence path when present, then reads the referenced files
from disk (see `skills/play-brainstorm/SKILL.md` § Inputs).

**Args format when research was skipped:**

```
Resolve <source-noun> issue <ID>: <TITLE>

Issue body: <repo-relative-path from payload.issue-body-path>

Comment evidence: <repo-relative-path from payload.comment-evidence-path>

## Research Brief
Skipped — <actual assessor reason, or root source-grounded selection reason when no assessor ran>. Proceed with codebase exploration in brainstorming.
```

**Args format when internal research failed:**

```
Resolve <source-noun> issue <ID>: <TITLE>

Issue body: <repo-relative-path from payload.issue-body-path>

Comment evidence: <repo-relative-path from payload.comment-evidence-path>

## Research Brief
Partial — internal research failed: <reason>
<only source-referenced, issue-relevant, repository-grounded partial findings not contradicted by owning authority>
```

When no usable partial finding exists, replace the last two lines with
`Internal research failed: <reason>. Proceed with codebase exploration in
brainstorming.` Do not supply a research path on either internal-failure route.
Required external failure never reaches Phase 4.

**`--auto` mode behavior in brainstorming:**

When `--auto` is set, the brainstorming skill still runs through its required
classification path. If that path continues to an executable design, the skill
runs fully (exploration, option generation, design writing), but:

- Do NOT ask the user to choose between options — pick the architecturally cleanest approach
- Do NOT wait for user approval of the design — proceed immediately
- Do NOT ask clarifying questions — make reasonable assumptions and document them in the design

If `play-brainstorm` emits `Durable owner referral: <owner>.`, stop `--auto`
before Phase 5. Before returning to the user, follow the Phase 1 "don't
implement" cleanup rule: invoke `play-branch-finish` with option 4 (discard) for
the adopted issue worktree. Surface the durable owner referral notice and the
cleanup result to the user, and do not invoke `play-planning`,
`play-subagent-execution`, branch review, or PR creation. This is a clean
durable owner referral with cleanup, not a missing-design failure.

If brainstorming surfaces a genuinely ambiguous decision (two equally valid approaches with different trade-offs), **stop `--auto` mode and ask the user**. Resume autonomous execution after their answer.

See [`references/auto-mode-discipline.md`](auto-mode-discipline.md) for why "document the assumption and let the user override at PR review" is the same violation, and why third-party "either is fine" doesn't count as authorization.

Without `--auto`: hand off to `play-brainstorm` and return control to the
user after `play-brainstorm` completes. `play-brainstorm` owns its approved
handoff to `play-planning`; do not suppress or replace child skill approval
gates.

## Phase 5: Write Plan (reviewed-plan route)

For a fresh design, after `play-brainstorm` returns, first check whether it emitted the literal
durable owner referral notice:

```
Durable owner referral: <owner>.
```

When this notice is present, do not fall through to design-path validation or
later phases. Clean up the adopted issue worktree through `play-branch-finish`
option 4 (discard), then stop `--auto` and report the referral plus cleanup
result. When no durable owner referral notice is present, capture the literal
`Design written to <path>.` notice line it emitted. When Selection reuses an
accepted design instead, retain its actual guarded path and validated producer
provenance without claiming a new notice. Validate the selected path
before reading it:

```bash
node "$PHASE_ARTIFACTS_HELPER" validate-read design "$DESIGN_PATH"
```

Use the helper contract from the issue worktree root; success is silent and a
nonzero exit stops the phase.

Invoke `play-planning` and pass the design as a `Design: <path>` reference in the invocation prose, NOT as inline content. The invocation skeleton:

Include the literal `Comment evidence: <repo-relative-path>` line only when
`payload.comment-evidence-path` is present; otherwise omit the line entirely.

```
Write an implementation plan for <source-noun> issue <ID>: <TITLE>.

`--auto` flow active (invoked by `issue-priming-workflow`). Do NOT prompt for execution mode at the end — return after saving the plan and only after complete combined planning review passes both remits so the parent skill can invoke `play-subagent-execution`. Invalid combined review stops before `play-subagent-execution`.

Design: <repo-relative-path captured above>

Comment evidence: <repo-relative-path from payload.comment-evidence-path>
```

Do not wait for user review of the plan — proceed directly to implementation after `play-planning` returns. The plan path is captured from the producer notice line emitted by `play-planning`.

Current combined assurance may include the planning owner's narrow
[source-established declaration verification](../../play-planning/references/combined-review-contract.md#source-established-declaration-verification).
Before execution or an approval assessment, validate its current corrected
digest/tag, retained producer identity, explicit `Review mode: verification-only`,
complete current/carried coverage and exact prior session/tag/digest/row
provenance, original/current source identities, historical semantic results and
consumed passes. Rehash immediately before consumption. Historical PASS alone
cannot authorize changed bytes; missing, mixed, unsupported or stale composite
evidence stops without downgrade. Execution/publication authority, auto evidence
and final implementation review remain separate gates.

## Phase 6: Implement (reviewed-plan route)

After `play-planning` returns, capture its literal
`Plan written to <path>.`, `Reviewed digest: <sha256>`, and
`Planning review contract: planning-review/combined-v1` lines. That return
means complete current combined planning review assurance passed, either semantic review
or the qualifying verification-only composite. Preserve the reviewed digest and
combined producer provenance in controller-local state, validate them, and stop
if any value is missing or malformed. Invalid planning provenance must stop
inside `play-planning` and must not reach this phase. Validate
the captured path. Planning's
[unreviewed draft correction](../../play-planning/SKILL.md#producer-owned-unreviewed-draft-correction)
is local producer work, never a successful reviewed return. Failed or incomplete
intake returns to planning without substituting a digest, rewriting review
history, or downgrading provenance; retain the successful producer's exact
path/digest/tag and current combined review provenance for the executor.

```bash
node "$PHASE_ARTIFACTS_HELPER" validate-read plan "$PLAN_PATH"
```

Use the helper contract from the issue worktree root; success is silent and a
nonzero exit stops the phase.

Before invoking `play-subagent-execution`, invoke
`scripts/write-auto-handoff.mjs` from the issue worktree root. Resolve the
script from the installed `issue-priming-workflow` skill bundle, pass
`PLAN_PATH`, and capture stdout as the repo-relative auto-handoff artifact path.
Treat a nonzero helper exit as a contract failure and stop before invoking the
executor. Load [`phase-6-auto-handoff.md`](phase-6-auto-handoff.md) for the helper
interface, artifact schema, artifact path shape, and rationale. If it is
unavailable, stop before invoking the executor.

```bash
ISSUE_PRIMING_WORKFLOW_DIR="<installed-issue-priming-workflow-skill-bundle>"
AUTO_HANDOFF_HELPER="$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.mjs"
ISSUE_PRIMING_AUTO_HEAD="$(git rev-parse HEAD)"
AUTO_HANDOFF_FILE=$(
  PLAN_PATH="$PLAN_PATH" \
    node "$AUTO_HANDOFF_HELPER"
)
```

Before executor dispatch, run the `subagent-lifecycle` cleanup gate for
completed or superseded gate and research sessions as
[`references/phase-6-auto-handoff.md`](phase-6-auto-handoff.md)
§ "Lifecycle Before Handoff" defines it.

Immediately before invoking `play-subagent-execution`, compute SHA-256 over the
exact saved plan bytes with the same portable `shasum -a 256` / `sha256sum`
plus `awk '{print $1}'` pattern owned by `play-planning`. Validate the extracted
field as lowercase 64-hex and compare it with the preserved reviewed digest.
Any missing tool, unreadable plan, hashing failure, malformed digest, or
mismatch stops before executor handoff and requires a fresh planning wave; do
not update the expected digest to match changed bytes.

Before every default implementation spawn or same-route redispatch, the controller validates the
exact approved route from current issue authority, existing owner-route
identity, preserved reviewed plan digest, auto-handoff identity, and current
head when one exists. It carries only the current validated tuple in
controller-local state; after a default implementation commit changes that head, it must rebuild
and validate the attestation before another default implementation prompt. When an
`issue-batch-routing` parent is present, first
send the initial owner-handoff report defined in [Issue Batch Routing Reports](../SKILL.md#issue-batch-routing-reports) so the router can record
the same facts before any progress receipt. Then inject a `Verified auto-route
attestation` into each default implementation prompt that names the source provider and issue,
owner thread, exact approved route identity, reviewed plan digest, auto-handoff
identity, current head when present, and that current issue authority was
validated. Missing, unclear,
invalid, or unverified route facts produce no attestation and fail closed to
`spec-and-quality`; neither a plan nor copied invocation prose can supply it.

Invoke `play-subagent-execution` and pass the plan as a `Plan: <path>`
reference, the preserved `Expected digest: <sha256>`, `Auto handoff:
<repo-relative-path>`, and the controller-validated `Verified auto-route
attestation` in the invocation prose, NOT as inline content. The executor
controller must validate and retain a current controller-provided attestation
before every default implementation spawn or same-route redispatch, then substitute only that
current retained value; it must render `unverified` and use the
manual default implementation behavior when validation fails. Use the `$AUTO_HANDOFF_FILE`
path captured above. Carry
`ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true` and `ISSUE_PRIMING_AUTO_HEAD` in
controller-local state for the executor's handoff validation. Reduced routes
are allowed only through the verified `issue-priming-workflow --auto` handoff
path; missing, unclear, invalid, or unverified reduced-route state fails closed
to `spec-and-quality`. The executor-owned route authority is
`play-subagent-execution` and its
[`review-routing-policy.md`](../../play-subagent-execution/references/review-routing-policy.md)
reference. The invocation skeleton:

```
Execute the implementation plan for <source-noun> issue <ID>: <TITLE>.

`--auto` flow active (invoked by `issue-priming-workflow`). Apply `play-subagent-execution`'s executor-owned risk-based per-task review routing for multi-task plans (single-task plans skip per-task review; see `play-subagent-execution` § Single-Task Plans).

Parent-owned review contract: this invocation comes from `issue-priming-workflow --auto`, and the Phase 7 `branch-review --fix` loop is mandatory. A branch-review-owned fix commit invalidates downstream evidence and returns through Candidate Closure and Source Freeze before the paired Phase 7 rerun on the new `HEAD`; continue until a run reports zero blocking findings auto-fixed, no unresolved remaining `Blocking` findings except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`, a captured final approval-summary notice path, and fresh final approval-summary evidence after branch-review-owned fix commits. That final whole-diff review satisfies the final-review guarantee required by any reduced per-task review route. If the extracted plan has exactly one task, skip the final whole-implementation code-quality reviewer and return to this workflow after implementation completes.

Plan: <PLAN_PATH captured above>
Expected digest: <reviewed lowercase 64-hex digest captured above>
Planning review contract: planning-review/combined-v1
Auto handoff: <repo-relative-path>
Verified auto-route attestation: <controller-validated exact-route attestation>
```

All `play-subagent-execution` rules apply unmodified (fresh subagent per task,
executor-owned risk-based per-task review routing for multi-task plans;
single-task plans skip per-task review), except that the parent-owned contract
above activates the narrow single-task final-review carve-out and relies on the
Phase 7 final-review guarantee, both defined in
[`references/phase-6-auto-handoff.md`](phase-6-auto-handoff.md)
§§ "Single-Task Final-Review Carve-Out" and "Phase 7 Final-Review Guarantee".

`play-subagent-execution` may execute trivial single-task plans inline (skip-dispatch path; see its [skip-dispatch policy](../../play-subagent-execution/references/skip-dispatch-policy.md)). On the reviewed-plan route, Phase 6 remains "invoke `play-subagent-execution`" — the inline optimization is internal to that skill. Four runtime guardrails (single-task, `**Mode:** mechanical`, structural task-contract gate satisfied, no TDD expectations or legacy TDD step-pair markers) plus one upstream precondition (current combined planning review provenance from Phase 5) gate the path; the runtime guardrails are checked by the skill's controller after plan extraction. A missing or invalid required contract checklist stops before implementation rather than falling back to mechanical dispatch.

Successful `play-subagent-execution` completion returns control to this owning
workflow. Phase 6 completion enters
[Candidate Closure and Source Freeze](../SKILL.md#candidate-closure-and-source-freeze)
before any expensive downstream evidence.

Before an implementer runs focused tests, it inspects the target repository's
applicable test documentation and package scripts, then performs their required
preparation. A missing prerequisite is a setup failure that must be repaired
before treating the focused test result as product evidence; shared workflow
guidance does not prescribe repository-specific fixtures or wrappers.
