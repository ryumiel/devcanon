# Wrapper Helper Contracts - `play-review`

Wrappers use the installed `skills/play-review/scripts/review-artifacts.sh`
helper for rendered review surfaces and GitHub payload construction. These are
executable contracts, not examples to manually reimplement.

Run them from the target repository root with `HEAD_SHA` bound to the immutable
review head captured before any wrapper edits, fixups, or posting.
The helper reads source snippets from `git show "$HEAD_SHA:<path>"`; it must
render review-head source, not the mutable working tree.

## `render-review-preview`

Renders the operator preview from a validated `play-review/findings/v1`
envelope:

```bash
HEAD_SHA="$REVIEW_HEAD_SHA" \
FINDINGS_FILE="$REVIEW_FINDINGS_FILE" \
REVIEW_SURFACE="pr-review" \
REVIEW_BODY_FILE="$REVIEW_BODY_FILE" \
  bash "$PLAY_REVIEW_HELPER" render-review-preview
```

Inputs:

- `HEAD_SHA`: trusted 40-hex review head.
- `FINDINGS_FILE`: repo-relative findings notice path matching the deterministic
  `.ephemeral/<branch_slug>-<HEAD_SHA>-findings.json` shape.
- `REVIEW_SURFACE`: exactly `pr-review` or `branch-review`.
- `REVIEW_BODY_FILE`: required only for `REVIEW_SURFACE=pr-review`; ignored for
  branch review.

Output is the complete preview text for the wrapper. The command validates cwd,
SHA, findings path, surface, body file where relevant, findings schema, and
review-head source anchors. It exits nonzero on unsafe paths, missing files,
schema mismatch, unsupported surfaces, stale/missing review-head source, or
invalid anchors. `REVIEW_SURFACE=branch-review` never reads or requires
`REVIEW_BODY_FILE` and never builds a GitHub payload.

## `build-github-review-payload`

Builds the exact GitHub Reviews API JSON body for `pr-review` only:

```bash
HEAD_SHA="$REVIEW_HEAD_SHA" \
FINDINGS_FILE="$REVIEW_FINDINGS_FILE" \
REVIEW_SURFACE="pr-review" \
REVIEW_BODY_FILE="$REVIEW_BODY_FILE" \
REVIEW_EVENT="$REVIEW_EVENT" \
  bash "$PLAY_REVIEW_HELPER" build-github-review-payload
```

Inputs are the same validated `HEAD_SHA`, `FINDINGS_FILE`, `REVIEW_SURFACE`, and
`REVIEW_BODY_FILE` as preview rendering, plus `REVIEW_EVENT` set to `APPROVE`,
`REQUEST_CHANGES`, or `COMMENT`.
Allowed events: `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.

Output is one JSON object containing `commit_id`, `event`, `body`, and
`comments`. The command:

- uses the review-head SHA as `commit_id`;
- appends out-of-diff findings to the top-level body;
- converts natural and missing-file findings into inline comments;
- prefixes missing-file comment bodies;
- omits `start_line` and `start_side` when `start_line` is `null`;
- adds `"side": "RIGHT"` and `start_side: "RIGHT"` when a range is present;
- refuses `REVIEW_SURFACE=branch-review` with
  `build-github-review-payload requires REVIEW_SURFACE=pr-review`.

Every validation failure exits nonzero. Wrappers must not post or freeze a
payload built from stale mutable working-tree source.
