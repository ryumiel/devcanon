# Phase 3 Agent Briefing Template

Use this template when composing each Phase 3 reviewer's prompt in `skills/play-review/SKILL.md` Phase 3.

**Promotion classification:** Skill-local prompt template, single call site at `skills/play-review/SKILL.md` Phase 3 dispatch. Promotion to a source agent is gated by [`docs/guidelines/agent-authoring-guide.md`](../../../docs/guidelines/agent-authoring-guide.md) §4 (cross-skill reuse OR standalone-role boundary; two-call-sites operational threshold). Phase 3 reviewer roles are explicitly held inline per [ADR-0011](../../../docs/adr/adr-0011-reviewer-fanout-audit.md); the template stays here.

## Required prompt structure

```
Role: <one sentence — this agent's focus>

Read the shared review context at <path-to-context-file> before reviewing.
The file contains: working directory, refs, changed files (active diff),
discovered guidelines, doc-impact summary, output format specification,
and (if applicable) prior review threads.

Active diff: run `git diff <active_diff_range>` from <working_directory>.

Sub-checks for this review:

<role-specific sub-checks composed inline, each referencing actual files
and line counts visible in the diff. Generic prompts like "review this
diff" remain prohibited — the per-agent block must be specific to the
diff under review.>

Emit findings using the output format defined in the shared review
context.
```

## Placeholder reference

| Placeholder              | Source                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `<one sentence>`         | Per-agent role description (Correctness, Data-safety, …)      |
| `<path-to-context-file>` | `.ephemeral/<branch_slug>-<head_sha>-review-context.md`       |
| `<active_diff_range>`    | `active_diff_range` skill input                               |
| `<working_directory>`    | `working_directory` skill input                               |
| Sub-checks               | Per-agent — diff-specific, referencing actual files and lines |

## Notes

- The shared-context file is written by Phase 2.5 of `skills/play-review/SKILL.md` before Phase 3 dispatch.
- Per-agent role-specific sub-checks remain inline in the prompt — only the shared block is path-referenced.
- Generic prompts (e.g., "review this diff") remain prohibited at the per-agent level.
