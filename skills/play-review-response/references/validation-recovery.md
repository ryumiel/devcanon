# Interrupted Validation Recovery

Use this reference only when a required or relevant validation command fails
and may already have executed a stage that generates files, even if the stage
where it stopped does not generate files. The selected review-response outcome,
finding classification, and existing repair authority still govern what may
change.

Before recovery or retry, record the failed command, failed stage, and what is
known about earlier stages that ran. Inspect the actual worktree status,
relevant diff, and the command's known generated output paths, including
ignored paths that ordinary Git status and diff omit. Use documented outputs
and stages that may have run to bound the inspection. If those facts are
unknown, gather the evidence before retrying. A clean Git status alone does
not establish that no generated residue remains. Separate what the evidence
supports: the failure may be change-related, possibly independent of the
change, and/or accompanied by generated residue. These possibilities can
coexist; retain uncertainty where the cause is unproven.
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
