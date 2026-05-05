# ADR-0009: Review Pipeline Consolidation Into Shared `play-review` Skill

## Status

Accepted

## Context

ADR-0008 wired AFDS v2 enforcement into `branch-review` and `pr-review`
by mirroring the Architecture and Documentation dynamic agents and the
ADR-coverage sub-check across both skills. That left two skills with
~70% overlapping prose — guideline discovery, doc-impact summary, agent
dispatch, agent briefings, sub-checks (Architecture ADR-coverage,
Correctness Sub-checks 1 and 2, Docs Sub-checks A and B), critic
verification, and finding format were duplicated between the two
SKILL.md files.

ADR-0008 acknowledged this duplication explicitly in its Consequences:

> Pr-review and branch-review now duplicate review logic for Architecture
> and Documentation agents. This duplication is intentional and time-bound:
> it motivates the deferred wrapper-refactor cycle that will make pr-review
> a thin GitHub-fetch + GitHub-post wrapper around shared review core.

Two further asymmetries were carved out as deferred follow-up work:

1. **Sub-check B (cross-document identifier drift)** existed only in
   `branch-review`'s Docs agent. PRs that bypassed `branch-review --fix`
   (e.g., PRs opened manually) escaped Sub-check B coverage.
2. **Architecture-agent missing-file anchoring rule** existed only in
   `pr-review`. Any future skill that posts inline GitHub comments based
   on review findings would have to re-derive it.

## Decision

Extract the shared review _procedure_ into a new internal skill,
`play-review`, and rewire `branch-review` and `pr-review` to be thin
wrappers around it.

`play-review`:

- Lives at `skills/play-review/SKILL.md` with the `play-` methodology-
  family prefix per ADR-0003. Internal-only (`claude.user-invocable: false`,
  `codex_sidecar.policy.allow_implicit_invocation: false`); the description
  text gates the auto-routing soft path. The frontmatter pattern matches
  `issue-priming-workflow` (see issue #149 for the rationale: not
  `claude.disable-model-invocation: true`, which would block programmatic
  invocation by sibling skills).
- Owns guideline discovery (Phase 1), doc-impact summary computation
  (Phase 2), agent dispatch with core + dynamic agents and briefing
  template (Phase 3), all sub-checks (Phase 4), and critic verification
  (Phase 5).
- Defines a structured input contract (working_directory, base_ref,
  active_diff_range, full_pr_diff_range, head_sha, mode, language_hints,
  and optional follow-up fields) and a stable markdown output contract
  with explicit anchor classification (`natural` | `missing-file` |
  `out-of-diff`).
- Activates conditional behaviors based on the input contract:
  - **Sub-check B always runs** for both wrapper invocations, closing
    the first ADR-0008-deferred asymmetry.
  - **Missing-file anchoring rule activates when `mode == "github-post"`**,
    making the rule available to any future skill that posts inline
    GitHub comments — closing the second ADR-0008-deferred asymmetry.
  - **Architecture- and Documentation-agent overrides** for follow-up
    narrow mode activate when `is_followup_narrow == true`, preserving
    `pr-review`'s existing escalation semantics.

`branch-review` and `pr-review` keep their existing public surfaces
(arguments, auto-trigger descriptions, user-gate flow, GitHub posting
flow). Their bodies thin to input gathering and output disposition,
delegating the procedure to `play-review`.

Documentation impact: ADR-0008 references this ADR as a follow-up;
`MAP.md` adds a navigation entry for `play-review`;
`docs/guidelines/writing-skills.md` §3.2 gains a callout disambiguating
`claude.user-invocable: false` from `claude.disable-model-invocation: true`
so the issue-#149 trap is documented next to the frontmatter authoring
rules.

## Consequences

- Single source of truth for the multi-agent review procedure. Future
  changes to agent briefings, sub-check rubrics, or the critic land in
  one place.
- Sub-check B coverage is now applied symmetrically across both
  wrappers. PRs reviewed via `pr-review` (including those that bypassed
  `branch-review --fix`) gain cross-document identifier-drift checking.
- The missing-file anchoring rule is reusable by any future wrapper or
  consumer that needs `path` + `line` for findings whose recommendation
  is to create a new file.
- Combined SKILL.md line count grows slightly (the input/output contract
  and conditional-activation table are net-new prose), but the
  duplication is eliminated.
- Consumer skills (`issue-priming-workflow`, `play-branch-finish`,
  `pr-merge`, `play-subagent-execution`) keep their existing call
  surfaces (`branch-review`, `pr-review`). Only
  `play-subagent-execution/references/spec-reviewer-prompt.md` updates
  string references to name `play-review` as the sub-check owner.
- `pr-review`'s output remains free-form prose; consumer cleanup (a
  structured-finding schema for `branch-review --fix` to drop the
  prose-to-JSON translation step in `issue-priming-workflow` Phase 7)
  is filed as issue #158 and explicitly out of scope here.

## Alternatives considered

- **Approach 2 (shared library, not shared procedure).** Extract only
  agent briefings, sub-check rubrics, and the critic prompt into
  `play-review/references/`; keep the phase-by-phase workflow in each
  wrapper. Rejected: eliminates ~30-40% of duplication but leaves the
  orchestration prose (parallel dispatch, doc-impact-anchor passing,
  follow-up override) duplicated in both wrappers; Sub-check B / anchoring
  asymmetry would still need manual fixes in two places.
- **Approach 3 (shared procedure + consumer cleanup).** Approach 1 plus
  redefine `branch-review --fix`'s output to be structured. Rejected as
  scope creep — touches 4-5 skills instead of 3 and risks coupling this
  refactor to an unrelated output-schema decision. Filed as issue #158
  for follow-up after this refactor lands.
- **Use `claude.disable-model-invocation: true` to gate `play-review`
  from auto-trigger.** Rejected: per issue #149, that flag blocks all
  Skill-tool invocation including programmatic hand-offs from sibling
  skills, defeating the wrapper pattern. The correct gate is
  `claude.user-invocable: false` (hides from the slash-command menu but
  still allows wrappers to invoke via the Skill tool).

## Related

- ADR-0003: `play-` methodology-skill prefix convention
- ADR-0007: review pipeline delineation (per-task vs branch review)
- ADR-0008: AFDS v2 pipeline enforcement; deferred wrapper-refactor
  follow-up addressed here
- Issue #149: `user-invocable` vs `disable-model-invocation` precedent
- Issue #158: consumer cleanup follow-up (out of scope here)
