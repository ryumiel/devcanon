# Phase 3 Research Controller Procedure

This is the research-selected operating procedure loaded by
[`SKILL.md`](../SKILL.md) only after `RESEARCH_NEEDED` or
`payload.research = forced`. It is subordinate to the main Phase 3 policy:
that policy owns selection, bindings, validation, classification, guard safety,
report consumption, outcome precedence, persistence, and Phase 4 continuation.
Do not use this reference for `SKIP_RESEARCH`, and do not replace an unavailable
copy with inline guidance.

## Prompt Preparation

After the root has loaded this reference, form a separate complete prompt tuple
for every permitted child. Substitute these values independently into
[`investigator-prompt.md`](investigator-prompt.md):

| Placeholder                       | Root-supplied value                                             |
| --------------------------------- | --------------------------------------------------------------- |
| `<SOURCE>`                        | `payload.source` (`github` or `linear`)                         |
| `<ID>`                            | `payload.identifier`                                            |
| `<TITLE>`                         | `payload.title`                                                 |
| `<ISSUE_BODY_PATH>`               | guarded `payload.issue-body-path`                               |
| `<COMMENT_EVIDENCE_PATH_OR_NONE>` | guarded comment path, otherwise `(none)`                        |
| `<GATE_REASON>`                   | gate reason, or `forced by --research`                          |
| `<REPO_ROOT>`                     | Phase 1 issue worktree root                                     |
| `<RESEARCH_SCOPE>`                | root-assigned `internal` or `external`                          |
| `<EXTERNAL_NECESSITY_OR_NONE>`    | `(none)` internally; recorded `required` or `useful` externally |
| `<EXTERNAL_QUESTION_OR_NONE>`     | `(none)` internally; one root-curated external question         |

Re-run the Phase 1 path guards before consuming issue-body or comment-evidence
paths. Validate every scalar independently before creating a pending row or
capturing a baseline. Reject missing, empty/whitespace-only, multiline,
over-limit, invalid-source, invalid-scope, invalid-necessity-pairing, and
invalid-question-pairing inputs independently. Pass guarded paths, never copied
untrusted content. A proposed child has no cleanup or ledger state before the
complete prompt passes.

For each D2 and D3 route independently, choose the next positive base-10
`<instance_ordinal>` not used by retained rows for that route; completed and
superseded rows remain reserved. Use `d2_<instance_ordinal>` or
`d3_<instance_ordinal>`, require `^[a-z0-9_]+$`, nonblankness, and absence from
all retained ledger task names. Keep scope and sibling identity in ledger
dimensions, not the task name.

## Exact Fresh Dispatch

Reconfirm the main skill's full tuple immediately before capture. Each child
receives no inherited turns and is created once only in its selected route:

```text
# D2 internal research; D2_MODEL is the Codex-bound balanced model
Codex.spawn_agent({
  task_name: d2_<instance_ordinal>,
  agent_type: "investigator",
  model: D2_MODEL,
  reasoning_effort: "high",
  fork_turns: "none",
  message: D2_PROMPT,
})
# D3 external research; D3_MODEL is the Codex-bound balanced model
Codex.spawn_agent({
  task_name: d3_<instance_ordinal>,
  agent_type: "investigator",
  model: D3_MODEL,
  reasoning_effort: "high",
  fork_turns: "none",
  message: D3_PROMPT,
})
```

If native Codex rejects the requested pair, retain the exact
`model=<D2_OR_D3_MODEL> effort=high` and take only the main policy's unavailable
investigator outcome after required cleanup. Do not retry or alter the route.

## Guarded Result Handling

Use the enclosing flow's resolved
`$ISSUE_PRIMING_WORKFLOW_DIR/scripts/source-immutability.mjs` binding and a
distinct `LEAF_BASELINE` for every internal, immediate-external, or late-external
leaf. This procedure invokes the helper; the adjacent source-immutability usage
reference retains its exclusive helper mechanics.

```bash
LEAF_BASELINE="$(node "$SOURCE_IMMUTABILITY_HELPER" capture)"
# Spawn this investigator, then capture its raw terminal response/status.
node "$SOURCE_IMMUTABILITY_HELPER" verify --baseline "$LEAF_BASELINE"
# Validate and retain this response in controller memory.
node "$SOURCE_IMMUTABILITY_HELPER" cleanup --baseline "$LEAF_BASELINE"
# Only now apply this retained investigator result.
```

Capture failure prevents only that spawn and records that investigator as
unavailable without inventing a baseline. An ordinary unavailable, failed,
malformed, or verification-rejected result follows the main outcome precedence
after safe cleanup. Preserve captured scope, report result, source references,
blocker state, lifecycle ledger, and repository anchors across the shared
slot-limit recovery procedure.
