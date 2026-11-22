# Phase 2 Complexity Gate Procedure

Dispatch one response-only `assessor`, balanced/low and source-immutable,
using the [gate prompt template](gate-agent-prompt.md). The assessor
reads the issue-body file from `ISSUE_BODY_PATH`, scans `docs/adr/` titles, and
checks `AGENTS.md` for relevant rules. The route has external authority `none`,
no network access, and zero handoffs. Do not substitute an ambient role, model,
or effort and do not escalate this bounded gate into a different route.

Before issue gate assessment capture, load the dispatch ritual in
[`dispatch-ritual-usage.md`](../../play-agent-dispatch/references/dispatch-ritual-usage.md)
from the installed `play-agent-dispatch` bundle and run it with the [Phase 2 route binding](../SKILL.md#phase-2-complexity-gate). A missing, blank, unreadable, or unavailable ritual reference is
a terminal pre-dispatch blocker: create no ledger row or baseline, do not
spawn, and do not invent inline fallback detail. That reference owns the
generic dispatch ritual; this skill owns its issue gate assessment route values, prompt inputs,
and gate disposition.

The route has `external_authority: none` and zero handoffs. The prompt must name
the issue title, source, identifier, guarded issue-body path,
guarded-or-`(none)` comment-evidence path, and Phase 1 repository root named by
the template. A missing, blank, unresolved, or mismatched marker blocks before
capture or spawn. Do not search a source checkout, use an alias, or fall back to
a nearby or ambient model. Only after the ritual's validation and capture,
create exactly one fresh Codex child:

```text
# ISSUE_GATE_ASSESSMENT_MODEL is the Codex-bound balanced model
Codex.spawn_agent({
  task_name: issue_gate_assessment_<instance_ordinal>,
  agent_type: "assessor",
  model: ISSUE_GATE_ASSESSMENT_MODEL,
  reasoning_effort: "low",
  fork_turns: "none",
  message: ISSUE_GATE_ASSESSMENT_PROMPT,
})
```

If native Codex rejects the issue gate assessment pair, use the existing unavailable-gate fallback
after the required cleanup. A known created assessor's explicit terminal
model-capacity failure first uses `subagent-lifecycle`'s bounded recovery rule.

Use the enclosing flow's already-resolved
`$ISSUE_PRIMING_WORKFLOW_DIR/scripts/source-immutability.mjs` binding and apply
the GUARD-001 lifecycle to this leaf:

1. **capture before spawn** with no `--handoff`; capture failure prevents the
   spawn and treats the assessor as unavailable under the existing gate
   fallback without inventing a baseline path;
2. spawn the assessor and capture only its raw terminal response/status;
3. **verify before semantic validation or consumption** against the retained
   baseline;
4. **validate and retain the response in controller memory** only after
   successful verification — that is, validate the response or handoff payload
   into controller memory, although this route declares no handoff;
5. **cleanup the exact retained baseline** — clean up the exact owned paths;
6. **apply the retained result** only after cleanup — consume or apply the
   retained result by selecting the gate route.

The no-handoff command shape is:

```bash
GATE_BASELINE="$(node "$SOURCE_IMMUTABILITY_HELPER" capture)"
# Spawn the assessor, then capture its raw terminal response/status.
node "$SOURCE_IMMUTABILITY_HELPER" verify --baseline "$GATE_BASELINE"
# Validate and retain the response in controller memory.
node "$SOURCE_IMMUTABILITY_HELPER" cleanup --baseline "$GATE_BASELINE"
# Only now apply the retained gate result.
```

Run exact cleanup after every spawned terminal branch, including child failure,
malformed output, and verification rejection. An ordinary unavailable, failed,
malformed, or verification-rejected gate result follows the existing fallback
to `RESEARCH_NEEDED` after safe cleanup. Apply `subagent-lifecycle`'s terminal
model-capacity eligibility before that ordinary fallback. Only detected source
mutation or cleanup failure is guard-integrity terminal. Even then, attempt exact cleanup, leave the source
mutation visible, and never reset, check out, stage, or repair source.

**Pass to the assessor:**

- Issue title
- Issue-body path
- Comment-evidence path, only when present
- Repository root path

When comment evidence is absent, replace the gate prompt's comment-evidence
placeholder with `(none)`.

**Assessor returns:** `RESEARCH_NEEDED` or `SKIP_RESEARCH` with a one-line reason.

**Override:** If the user passed `--research` in the skill args
(`payload.research = forced`), skip the gate and go directly to research with
the synthetic gate reason `forced by --research`.

## Gate Signals

**Trigger research if ANY of:**

| Signal                   | Detection                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Cross-module impact      | Issue references files/types in 2+ crates or requires coordinated edits across module boundaries |
| New module or public API | Issue describes adding a component, crate, or public interface that doesn't exist yet            |
| No covering ADR          | Scan of `docs/adr/` finds no existing decision covering this domain                              |
| Conflicting guidelines   | Existing policies or ADRs pull in different directions for this issue                            |
| Comment evidence risk    | Present comment evidence introduces ambiguity, risk, or a design choice                          |
| Explicit request         | Issue body or comment evidence contains "brainstorm", "design decision", or "choose between"     |

**Skip research if ALL of:**

- Single-module, single-file change
- Clear precedent exists in the codebase
- Covering ADR or guideline prescribes the approach
- No present comment evidence introduces ambiguity, risk, or a design choice
