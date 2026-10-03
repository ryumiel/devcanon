# Publication and Thread Closeout

Read this procedure before any push, GitHub reply, resolve, or comment side effect for review-response work, including no-code replies. The entry owns route selection and follow-up commit continuity.

## Pre-Push Review Gate

Before any push, GitHub reply, GitHub resolve, or GitHub comment side effect for
review-response work, stop at the Pre-Push Review Gate and wait for explicit
approval unless an active owning workflow already has an approved posting gate
that covers the same side effects.

The gate summary must include:

- Local changes since the review-response work began, including follow-up
  commit SHA when a commit exists.
- Verification run and result, including regression coverage or a clear reason
  no code change was needed.
- Thread disposition for each concern: behavioral fix, no-code explanation,
  stale/invalid/already-addressed, unresolved, or needs clarification.
- Intended external actions, such as push, in-thread reply, top-level PR
  comment, thread resolution, or leaving a thread unresolved.

Do not treat "push it", "respond", or "looks good" as permission to skip this
gate when the workflow has not yet seen the local-state, verification, and
intended-action summary. After approval, perform only the listed side effects;
new side effects require another gate summary.

## Pushed-Fix and Outcome Thread Closure

Use this closeout sequence only after current classification and the applicable
selected outcome confirm a GitHub reply or closure on an already-pushed or
reviewed PR branch.

Applicable outcomes:

- **Inline execution** - an already-authorized inline fix.
- **Planned execution after executor returns** - the returned fix evidence.
- **No-code response** - an evidence-backed explanation.

1. Verify the current review comments, current classification, and applicable
   selected outcome.
2. For inline execution, implement the already-authorized inline fix. For
   planned execution after executor returns, use the returned fix evidence. For
   a no-code response, prepare the explanation.
3. Run the relevant checks for the selected outcome.
   If a failed command may already have executed a generating stage, follow
   the main skill's
   [Interrupted Validation Recovery](../SKILL.md#interrupted-validation-recovery)
   condition before choosing recovery or retry.
4. When the selected outcome changes code, commit the response work with a
   follow-up commit when the branch is already pushed or reviewed.
5. Run the Pre-Push Review Gate before push, reply, resolve, or comment side
   effects.
6. When the selected outcome requires a push, push normally only after the gate
   approves that push.
7. Re-fetch PR review thread state after any intended push, or immediately
   before a no-code reply, and before any reply.
8. Confirm GitHub writes are permitted by explicit user approval or the active
   workflow's approved posting gate.
9. Reply in-thread with concise fix or explanation evidence.
10. Re-fetch PR review thread state again after the reply and immediately before
    any resolution. Re-fetch authorship/ownership after the reply and
    immediately before any resolution in that same current state so resolution
    is based on the latest reviewer identity or ownership, not on stale
    pre-reply metadata.
11. Resolve only eligible threads.

Safe-to-resolve criteria:

Permission to reply is not permission to resolve. Posting fix or no-code
evidence after GitHub write approval only authorizes the reply; resolving the
thread requires the separate eligibility gate below.

- GitHub writes are permitted by explicit user approval or the active
  workflow's approved posting gate.
- The latest fetched thread after the reply is still unresolved.
- The current post-reply fetched thread state identifies reviewer identity or
  ownership clearly enough to classify the thread as human-authored,
  bot-authored, or self-authored.
- The thread maps to the same concern that you verified and addressed.
- The pushed branch contains the fix, the in-thread reply carries returned
  correction evidence, or it explains an explicit no-code disposition that
  proves no code change is required.
- An adjacent independently releasable defect handoff alone is not resolution
  evidence; resolution requires returned correction evidence, an actual branch
  fix, or that explicit no-code disposition.
- For outdated unresolved threads, current code and current thread state show
  the underlying concern is stale, invalid, already addressed, or fully
  addressed by pushed or replied evidence.
- The post-reply refetch still maps the thread to the same concern and does not
  show new disagreement, new reviewer feedback, unclear ownership, or a newer
  conflicting state.
- The relevant checks have passed.
- The current actor has permission to resolve the thread.
- Human-authored review threads are eligible only with explicit current-list
  resolve approval, reviewer confirmation that the concern is addressed, or
  explicit repository policy delegation for resolving human-authored review
  threads.
- Bot-authored and self-authored review threads remain eligible for resolution
  under the Safe-to-resolve criteria when every other criterion passes.
- Replying or resolving does not bypass `pr-review`'s user-gated
  posting/resolution workflow when that workflow is the active owner.

Edge dispositions:

- Explanation-only comments get an in-thread reply, then resolution only when
  the reply fully addresses the concern and the post-reply fetched thread is
  still unresolved.
- Human-authored review threads stay unresolved by default after fix or no-code
  replies unless explicit current-list resolve approval, reviewer confirmation,
  or explicit repository policy delegation exists.
- Stale or outdated threads are not resolved merely because they are outdated.
  Re-fetch current thread state, verify the underlying concern first, confirm
  pushed or replied evidence addresses that same concern, re-fetch after the
  reply, and apply the normal Safe-to-resolve criteria.
- Already-resolved threads are left alone. Do not add duplicate replies unless
  new information is needed.
- Unclear ownership stays unresolved and is reported to the user.
- Threads with unclear, partially fixed, or newly conflicting feedback stay
  unresolved and are reported to the user.

## GitHub Thread Replies

Before replying or closeout, confirm the current classification and applicable
selected outcome.
When replying to inline review comments on GitHub, use the configured CLI
invocation in the entry's GitHub Thread Replies section to reply in the
existing comment thread, not as a top-level PR comment.

Reference the follow-up commit or fix in that reply while preserving the
existing thread context. When a follow-up commit exists, include its commit SHA.
Each reply should state the behavioral fix or no-code disposition; include
regression coverage or reason no code change was needed and a concise
verification summary. Because replies are shared comments, apply the
`Agent-Local Evidence Reuse Boundary` in
`docs/specs/afds-workflow-routing.md`. Do not include raw `.ephemeral` paths,
transcripts, prompts, logs, validation-log dumps, stack traces, internal
decision trails, or session chronology. Follow `Pushed-Fix and Outcome Thread
Closure` before resolving any thread.
Do not resolve continuity by replacing reviewed history unless the user
explicitly asked for that cleanup or the repository workflow requires rewritten
history.
