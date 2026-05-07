# Phase 3 Agent Briefing Template

Use this template when composing each Phase 3 reviewer's prompt in `skills/play-review/SKILL.md` Phase 3.

**Promotion classification:** Skill-local prompt template, single call site at `skills/play-review/SKILL.md` Phase 3 dispatch. Promotion to a source agent is gated on cross-skill reuse OR a role boundary that would still make sense outside this skill, with a two-call-sites operational threshold for reviewer-style delegates. Phase 3 reviewer roles are explicitly held inline (a deliberate fanout-audit decision: keep reviewer scaffolding workflow-local rather than promote to first-class agents); the template stays here.

## Required prompt structure

```
Role: <role>

Read the shared review context at <path-to-context-file> before reviewing.
The file contains: working directory, refs, changed files (active diff),
discovered guidelines, doc-impact summary, output format specification,
and (if applicable) prior review threads.

Active diff: run `git diff <active_diff_range>` from <working_directory>.

Open with one or two short narrative sentences naming what the
implementation got right before listing findings.

Sub-checks for this review:

<sub-checks>

Emit findings using the output format defined in the shared review
context.
```

## Placeholder reference

| Placeholder              | Source                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `<role>`                 | Per-agent role description, one sentence (Correctness, Data-safety, …) |
| `<path-to-context-file>` | `.ephemeral/<branch_slug>-<head_sha>-review-context.md`                |
| `<active_diff_range>`    | `active_diff_range` skill input                                        |
| `<working_directory>`    | `working_directory` skill input                                        |
| `<sub-checks>`           | Per-agent — diff-specific, referencing actual files and lines          |

## Notes

- The shared-context file is written by Phase 2.5 of `skills/play-review/SKILL.md` before Phase 3 dispatch.
- Per-agent role-specific sub-checks remain inline in the prompt — only the shared block is path-referenced.
- The `<sub-checks>` block must compose role-specific sub-checks inline, each referencing actual files and line counts visible in the diff. Generic prompts like "review this diff" remain prohibited — the per-agent block must be specific to the diff under review.
