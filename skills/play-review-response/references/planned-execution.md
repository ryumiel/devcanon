# Planned Review-Response Execution

Read this procedure after the entry selects planned execution and before writing its planning input, invoking `play-planning`, or handing a plan to `play-subagent-execution`. The entry owns the route and this reference supplies its required steps.

For planned execution, do not independently author the full executor-ready
implementation plan in this skill. Structural planned review-response work
writes a verified `.ephemeral/*-design.md` planning input and invokes
`play-planning` with:

```text
Route: review-response-parent-owned
Design: <path>
```

Before the `Write` tool call for that planning input, compute the design path
and apply the canonical `.ephemeral` write guard:

```bash
DESIGN_PATH=".ephemeral/$(date +%F)-review-response-design.md"
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$DESIGN_PATH" ] && rm "$DESIGN_PATH"
[ ! -d "$DESIGN_PATH" ] || { echo "design path is a directory: $DESIGN_PATH" >&2; exit 1; }
[ ! -e "$DESIGN_PATH" ] || [ -f "$DESIGN_PATH" ] || { echo "design path exists but is not a regular file: $DESIGN_PATH" >&2; exit 1; }
```

The planning input must explicitly include:

- review thread/comment mapping;
- current feedback-source state;
- current thread state evidence when feedback is GitHub/PR-thread-backed;
- current code evidence;
- concern dispositions;
- root-cause or structural diagnosis for related, policy-sensitive,
  contract-sensitive, lifecycle-sensitive, or cross-module feedback;
- authoritative source for each disputed behavior;
- required fix strategy by cluster;
- `Contract Decisions` or an equivalent clearly labeled contract-decision
  section when review-response work creates or changes a boundary, or an
  explicit blocker or intentional implementation choice disposition with
  authority, risk, and proof expectation for any missing contract decisions;
- GitHub side effects outside executor scope.

`play-planning` owns task decomposition, contract-heavy tables,
boundary-contract traceability, task contract checklists, traceability
matrices, plan review, and executor-ready plan shape. This skill owns
source-aware feedback intake, verification, execution-mode selection, no-code
dispositions, follow-up commit continuity, GitHub thread replies/refetching,
resolution eligibility, and final PR closeout. It also owns the verified
review-response planning input.

After `play-planning` emits `Plan written to <path>.`,
`Reviewed digest: <sha256>`, and
`Planning review contract: planning-review/combined-v1`, capture the path,
exact reviewed digest, and complete combined producer provenance in
controller-local state. Apply the Plan Approval Gate in this reference before invoking
`play-subagent-execution` with:

```text
Plan: <path>
Expected digest: <sha256>
Planning review contract: planning-review/combined-v1
```

Immediately before that executor handoff, compute SHA-256 over the exact saved
plan bytes with the portable `shasum -a 256` / `sha256sum` plus
`awk '{print $1}'` pattern. Validate the extracted field as lowercase 64-hex
and compare it with the preserved reviewed digest. Any missing tool, unreadable
plan, hashing failure, malformed digest, or mismatch stops before execution and
routes the changed plan through a fresh `play-planning` wave; do not update the
expected digest to match changed bytes.

The generated plan remains a valid direct/manual `play-subagent-execution`
handoff under the executor's current structural task-contract gate. It must not
rely on issue-priming `--auto` reduced-route behavior, because direct/manual
review-response plans do not carry parent-owned issue-priming state, validated
auto-handoff evidence, or a guaranteed downstream `branch-review --fix` loop.
For `Route: review-response-parent-owned`, `play-planning` emits the plan path
only after current combined D5 assurance covers both remits, including the
qualifying verification-only composite defined by the
[combined owner](../../play-planning/references/combined-review-contract.md#source-established-declaration-verification). Approval
satisfaction is separate from planning review, binds the exact reviewed digest,
and cannot repair missing, mixed, stale, or legacy planning provenance.

`play-subagent-execution` owns executor-owned mechanics after the handoff:
task-contract validation, dispatch/skip-dispatch, review routing, snapshot
handling, implementer lifecycle, final whole-implementation review for
direct/manual calls, and whole-diff gate validation only when a caller-owned
handoff supplies that gate.

Direct/manual review-response plans do not get an automatic whole-diff review
after the executor's final code-quality reviewer. Run `branch-review` before
opening or updating a PR when planned review-response work needs whole-diff
coverage.

## Plan Approval Gate

For planned review-response work, create and self-review the written
`.ephemeral/*-design.md` planning input, invoke `play-planning` with
`Route: review-response-parent-owned` and `Design: <path>`, and capture the
emitted `Plan written to <path>.`, `Reviewed digest: <sha256>`, and combined
contract notice before implementation, only after `play-planning` has completed
one D5 review covering both remits. This gate borrows the approval-gate shape from `play-brainstorm`
without invoking `play-brainstorm` and without making it a dependency of
`play-review-response`.

Before handing the generated plan to `play-subagent-execution`, assess approval
satisfaction against the exact reviewed plan. Explicit current-session user
authorization satisfies this gate without a repeated approval request only for
an eligible plan containing only otherwise qualified behavior-preserving
compliance or authorized necessary-completion corrections when it covers
**every** correction in that plan, every affected responsibility, the full
scope, and all proof obligations. First establish the mandatory rule,
current-source violation, and preservation evidence that classify each
compliance candidate under Writing Skills and the bundled
[finding-proportionality reference](finding-proportionality.md).
For necessary completion, record the five pre-edit facts in that reference,
including the violated approved contract and design-determined result. An
approved signature adaptation or cross-module caller correction may qualify;
new ownership, interface, architecture, dependency, or public-contract
decisions cannot.
Assess exact current authority separately for every planned mutation.
Retain the authority source and its whole-plan coverage assessment with the
plan path, exact reviewed digest, contract tag, and current combined producer
provenance in controller-local state. A finding, severity, classification,
reviewer tag, or planning PASS does not create implementation authority.

For all other planned review-response work, request explicit user approval of
the reviewed plan. Known missing authority withholds mutation and requires an
explicit existing owner or approval handoff; uncertain, partial, or ambiguous
coverage also withholds mutation until the existing approval or decision-owner
route resolves it. Behavior or control-flow changes may use this gate only as
authorized necessary completion of the already approved contract, with
executable regression proof; they cannot use the compliance category to bypass
that proof. A new public contract, interface, ownership, architecture or
dependency decision, widened responsibility, or a crossed approval boundary
stops at the existing approval or decision-owner handoff. When approval is
required, present the plan
with a distinct producer notice and prompt. Replace `{captured-plan-path}`
below with the path captured from `play-planning`. Do not include a second
`Plan written to <path>.` placeholder, because `play-planning` owns the single
contract notice.

```text
I wrote the review-response plan at {captured-plan-path}.
Please review it. I will not implement it until you approve the plan.
```

The plan approval gate is explicit:

- The planning input and generated plan must be Markdown-valid enough for
  explicit repository scans and remain agent-local evidence under
  `.ephemeral/`; they are not durable product, architecture, or workflow
  documentation.
- Run planning input self-review before invoking `play-planning`;
  `play-planning` owns plan self-review and combined D5 review before it emits
  `Plan written to <path>.`.
- Establish approval satisfaction after `Plan written to <path>.` and before
  `play-subagent-execution`. Use exact existing authority only under the
  whole-plan condition above; otherwise wait for explicit approval
  or use the existing owning handoff.
- Immediately before execution, recheck the retained authority against the
  current reviewed plan, its digest and producer provenance. Any changed plan
  bytes invalidate the prior review and approval assessment: use the remaining
  combined D5 pass, the qualifying declaration-verification exception, or the
  existing reassessment route, then reassess authority
  for the new exact plan. Do not reset the pass budget.
- `play-planning` returns `Plan written to <path>.` for this route only after
  combined D5 review passes both remits; invalid planning provenance remains
  inside `play-planning` and stops before this approval gate.
- If the user requests a generated-plan change, retain the accepted scope and
  complete D5 pass history, then derive the remaining budget from that history.
  A PASS from the initial first pass leaves one correction pass; route that edit
  through `play-planning`, including plan self-review and combined D5 review,
  before renewed approval assessment. A PASS reached on correction pass two
  leaves no pass, even when this is the user's first requested edit.
- A final complete mapping-only FAIL may instead use the combined owner's
  verification-only exception; validate explicit mode and full composite
  provenance before reassessing authority for the corrected digest. Historical
  FAILs and consumed semantic passes remain retained.
- For other exhausted cases, when no pass remains, pause the approval loop for the explicit owning
  reassessment and cycle-reopening decision required by the combined-review
  contract. Present the exhausted budget and retained scope/pass history; do
  not dispatch another review until that owner decision explicitly authorizes a
  new bounded cycle. A user request for another edit is not an implicit reset
  or reopening.
- Repeat the approval assessment after each reviewed revision until exact
  authority covers it, the user explicitly approves it, or work stops. User
  approval may continue indefinitely, but every edited plan remains subject
  to the current cycle's D5 pass budget and any required reopening.

## Planning Input Self-Review

Planning input self-review is semantic validation of the review-response
planning input before invoking `play-planning`. Markdown lint may be useful,
but it is not planning input self-review; formatting checks do not prove that
reviewer concerns are understood, current, correctly classified, or executable.

Before invoking `play-planning`, the planning input must include a named
`Planning Input Self-Review` section. The section must show every current
review concern/comment maps to one of these dispositions: executable,
stale/invalid, already addressed, explanation-only, unclear, or unresolved.
Put the evidence inside that named section so the approval gate has one
auditable review location.

For each concern, validate that:

- The reviewer concern is accurately restated.
- The current feedback-source state was captured and used.
- For GitHub/PR-thread-backed feedback, the current thread state was fetched
  and used.
- The current code evidence supports the disposition.
- The execution mode is justified under inline/planned/no-code rules.
- The authoritative source for each disputed behavior is identified.
- The required fix strategy by cluster is identified.
- Boundary-changing review-response planning inputs include `Contract Decisions`
  or an equivalent clearly labeled contract-decision section, or record an
  explicit blocker or intentional implementation choice disposition with
  authority, risk, and proof expectation for missing contract decisions.
- GitHub side effects are outside executor scope.
- The planning input is suitable for `play-planning` through
  `Route: review-response-parent-owned` and `Design: <path>`.

Treat review-feedback intake as a ledger of evidence. Record enough current
feedback-source state, current thread state when the feedback is
GitHub/PR-thread-backed, code evidence, disposition reasoning, and gaps to prove
every review concern/comment maps to either a no-code disposition or an
implementation work item. Then derive required fix strategy by cluster rather
than mechanically creating one implementation task per review comment. The work
items address the structural cause rather than only the visible comment text.

Invalid self-review examples:

- `Markdown lint passed`
- `Planning input looks good`
- `All comments listed` without concern-to-fix mapping

Valid self-review example:

```text
Comment mapping: C1 and C3 map to lifecycle or correlation gap; C2 is
explanation-only.
Current feedback-source and code evidence: captured the current reviewer
feedback state, fetched unresolved GitHub PR threads at 2026-06-02, and
confirmed `src/worker.ts` still accepts stale completion callbacks.
Gaps: no test covers same-tick cancellation followed by stale completion.
Root-cause diagnosis: missing validation boundary at the operation owner.
Root-cause-derived fix strategy: strengthen the owner-side completion guard and
add stale-callback coverage, rather than one task per comment.
Residual risks: retry cleanup still needs focused verification.
Planning handoff suitability: design has source authority, is ready for
`Route: review-response-parent-owned` and `Design: <path>`, and GitHub closeout
remains with `play-review-response`.
```

GitHub reply, refetch, and resolution closeout remain owned by
`play-review-response` and must not be dispatched as `play-subagent-execution`
implementation tasks.

After the executor returns, this skill resumes ownership of explanation-only
replies, thread refetching, resolution eligibility, and final PR-thread
closeout.

Plan-plus-executor handoff example:

```text
Reviewer: "This routed feedback needs a coordinated correction."
Verification: current evidence identifies a policy-sensitive,
contract-sensitive, multi-surface concern with traceability needs.
Classification: in-scope product blocker (Writing Skills).
Mode: Planned execution.
Action: Apply the canonical `.ephemeral` write guard, write
`.ephemeral/<date>-review-response-design.md`, invoke `play-planning` with
`Route: review-response-parent-owned` and `Design: <path>`. Follow the Plan
Approval Gate: wait for a current combined D5 PASS, capture
`Plan written to <path>.`, `Reviewed digest: <sha256>`, and
`Planning review contract: planning-review/combined-v1`, and retain validated
producer provenance. Request explicit user approval of this reviewed
product-blocker plan using `{captured-plan-path}` replaced with the captured
path. Wait for that approval, then perform the required exact-byte rehash and
invoke `play-subagent-execution` with:
Plan: <path>
Expected digest: <sha256>
Planning review contract: planning-review/combined-v1
```

Worked inline, no-code, and GitHub-closeout-exclusion scenarios:
[`examples/execution-mode-scenarios.md`](../examples/execution-mode-scenarios.md).
