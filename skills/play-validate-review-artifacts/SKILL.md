---
name: play-validate-review-artifacts
description: Support-only validation contract for shared Play review artifacts. Use when a Play review wrapper or adapter must delegate deterministic review-artifact validation across PR review, branch review, or generated and installed review skill bundles.
claude:
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Play Validate Review Artifacts

Support skill for deterministic review-artifact validation across Play review
surfaces.

This skill is not a normal human workflow entry point. Do not invoke it as a
standalone review workflow, and do not use it to decide review judgment,
severity, category, routing, or user approval. Human-facing review workflows
remain `pr-review`, `branch-review`, and their `play-review` handoff.

## Authority

The sibling script
`skills/play-validate-review-artifacts/scripts/review-artifacts.sh` exposes the
shared deterministic validation command surface for review artifacts consumed
by Play review surfaces. It forwards those commands to the packaged
`devcanon-runtime` typed runtime, whose authority is limited to executable
mechanics for review-artifact contracts, including schema checks, Git-derived
artifact facts, scope range invariants, follow-up SHA usability, changed-file
and language-hint derivation, escalation reasons, diff-anchor validation, and
approved-review payload equivalence. It also owns deterministic validation and
gate-result interpretation for `branch-review/approval-summary/v1`; approval
summary artifacts store `terminal_state`, never `gate_passed`.

The script does not own:

- human review workflow entry points;
- review finding judgment, severity, category, or critic decisions;
- GitHub posting or thread-resolution approval;
- `play-review/findings/v1` envelope production;
- a general shared runtime utility model for unrelated skills.

This support skill is a narrow exception because multiple review surfaces must
share one deterministic artifact-validation authority. That exception does not
make the skill a user-facing workflow or a general shared runtime model.

## Consumer Relationship

Consumer scripts in `pr-review`, `branch-review`, and related Play review
wrappers are adapters. They remain responsible for their surface-specific
inputs, existing command names, current stdout contracts, and compatibility
with their owning skill prose. They translate surface-specific paths, expected
schemas, prior-context kinds, provider details, configured path patterns, and
review event intent into explicit support-validator flags.

Adapters must not copy shared validation policy into their own script bodies.
If the support validator is missing, adapters fail before validation with:

```text
play-validate-review-artifacts validator missing
```

A missing support validator is a packaging, render, sync, or install problem.
It is not permission to silently trust the adapter's input artifact.

## Script Resolution Contract

Adapters locate the support validator as a sibling skill script. Given an
adapter under:

```text
<skills-root>/<consumer-skill>/scripts/<adapter>.sh
```

the default validator path is:

```text
<skills-root>/play-validate-review-artifacts/scripts/review-artifacts.sh
```

This sibling layout is part of the contract because source skills, generated
preview skills, and installed skill homes all place skills beside each other.
Generated outputs remain disposable previews and are not source authority.

Resolution order:

1. Use `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` when set. It must point to a
   regular executable file.
2. Otherwise derive the logical sibling path from the adapter script's
   `BASH_SOURCE[0]` location.
3. If the logical sibling path is missing, try the physical resolved path for
   symlink install modes where invocation and source locations differ.
4. If no executable validator exists, fail with
   `play-validate-review-artifacts validator missing`.

## Command Surface

The support validator exposes explicit commands and long flags. Adapters may
read their existing environment variables, but shared policy inputs must be
forwarded as flags rather than hidden global state.

Commands:

| Command                     | Consumer surface                          | Contract owned here                                                                                                                                                            |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validate-scope-decision`   | `pr-review`, `branch-review`              | Validates scope-decision shape, expected schema/kind/path, Git ranges, derived facts, and escalation policy.                                                                   |
| `validate-prior-threads`    | `pr-review`                               | Validates normalized GitHub prior-thread artifacts and shared review-thread invariants.                                                                                        |
| `validate-diff-anchors`     | `pr-review`                               | Validates that postable inline anchors target right-side lines in the selected review diff.                                                                                    |
| `compare-approved-payload`  | `pr-review` approved-review artifact flow | Regenerates the expected approved-review payload from validated scope and findings inputs and compares it to the supplied payload.                                             |
| `validate-approval-summary` | `branch-review` approval-summary flow     | Validates a `branch-review/approval-summary/v1` artifact, linked scope-decision and findings evidence, counts, digests, reviewed head, and terminal-state gate interpretation. |

Every command that validates or consumes a scope decision receives the same
explicit scope-policy inputs, including the surface, immutable head SHA,
scope-decision path, expected schema, prior-context kind and path, governed path
pattern, max narrow changed-file count, and optional configured path pattern.
Scope-consuming commands must not rely on hidden prior validation state.

`validate-approval-summary` requires `--approval-summary-file`, `--head-sha`,
and `--surface branch-review`. Callers that already captured linked evidence
may also pass `--expected-findings-file` and
`--expected-scope-decision-file`; supplied paths must exactly match the paths
embedded in the summary before the linked evidence is trusted. With
`--emit-gate-result`, successful validation prints one JSON object containing
`terminal_state` and `gate_result`, where `gate_result` is exactly `passing`
for `approved` and `approved_with_nits`, and `blocking` for `blocked` and
`invalid`. Without `--emit-gate-result`, callers rely on the zero exit status.
The command rejects non-`branch-review` surfaces, stale heads, unsafe or missing
paths, malformed linked evidence, digest drift, count drift, unknown terminal
states, and any `gate_passed` field.

The validator is runtime-backed through the packaged `devcanon-runtime` support
skill. It may require Node.js through that packaged support runtime, but it must
not require the installed `devcanon` CLI solely to validate review artifacts.

## Failure Contract

On success, validation commands print only their documented stdout, if any, and
exit zero. On failure, they exit nonzero and expose a specific stderr fragment
for known policy failures so adapters and tests can diagnose the rejected
artifact.

Adapters may wrap failures for their existing operator-facing contract, but the
shared failure must remain visible enough for tests and reviewers to identify
the violated invariant.
