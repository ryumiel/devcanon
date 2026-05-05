---
name: play-review
description: Internal multi-agent review pipeline shared by `branch-review` and `pr-review`. Use when invoked by one of those wrappers. Do not use directly — call `branch-review` for local diffs or `pr-review` for GitHub PRs.
claude:
  model: "{{model:deep}}"
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# play-review

Internal review pipeline. Body forthcoming.
