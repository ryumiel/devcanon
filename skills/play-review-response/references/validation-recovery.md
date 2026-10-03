# Interrupted Validation Recovery

Use this reference only when a required or relevant validation run stops in a
stage that may generate files. The selected review-response outcome, finding
classification, and existing repair authority still govern what may change.

Before recovery or retry, record the failed command and stage, then inspect the
actual worktree status and relevant diff for generated side effects. Separate
what the evidence supports: the failure may be change-related, possibly
independent of the change, and/or accompanied by generated residue. These
possibilities can coexist; retain uncertainty where the cause is unproven.
A passing rerun alone does not establish independence or flakiness.

Choose the next diagnostic, correction, or recovery from that evidence. Apply
only applicable documented recovery or normalization within current authority,
and preserve unrelated edits. Do not reset the worktree wholesale or delete
modified generated files indiscriminately. If a prerequisite is known to be
unsatisfied, correct it or establish the missing evidence before repeating the
same check; each retry needs a reason tied to the observed state.

Focused diagnostics can establish a cause or verify a bounded correction, but
they do not replace explicitly required full validation on the final state.
If the failure persists, repair exceeds current authority, or another decision
is needed, use the existing owner handoff with the failed stage, observed
worktree state, attempts, remaining uncertainty, and proposed next owner and
action. Failed required checks continue to block successful closeout and
thread resolution.
