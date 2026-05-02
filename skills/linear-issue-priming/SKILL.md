---
name: linear-issue-priming
description: Primes a Linear issue into a research-backed implementation workflow with isolated worktree and brainstorming. Use when starting work on a Linear issue — triggers on Linear identifiers (ENG-123), Linear URLs, or phrases like "start issue", "work on issue", "prime issue".
claude:
  model: "{{model:deep}}"
codex:
  license: MIT
  metadata:
    short-description: Prime a Linear issue into a research-backed implementation workflow
codex_sidecar:
  interface:
    display_name: Linear Issue Priming
    short_description: Research and stage a Linear issue for implementation
    brand_color: "#5e6ad2"
---

# Linear Issue Priming

Fetch a Linear issue, set up an isolated worktree, assess whether it needs multi-agent research, and invoke brainstorming with pre-loaded context. The research phase runs in a dedicated agent to keep the main session clean.

## Arguments

| Arg                       | Effect                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<identifier>` or `<url>` | Issue to work on (required)                                                                                                                             |
| `--research`              | Skip gate, go directly to research                                                                                                                      |
| `--auto`                  | Autonomous mode: skip user review gates, pick the architecturally cleanest option, write plan, and execute via `subagent-driven-development` end-to-end |

Examples: `/linear-issue-priming ENG-123`, `/linear-issue-priming ENG-123 --auto`, `/linear-issue-priming --auto --research ENG-123`

## Workflow

```dot
digraph priming {
  rankdir=TB;
  fetch [label="1. Fetch\nlinear-list"];
  worktree [label="2. Worktree\nIsolate before\nany file writes"];
  gate [label="3. Gate\nDedicated agent\nassesses complexity"];
  decide [label="Research?", shape=diamond];
  research [label="4. Research\nDedicated agent\npolicy + codebase + external"];
  brainstorm [label="5. Brainstorm\nInvoke skill with\nissue + brief"];
  auto_check [label="--auto?", shape=diamond];
  plan [label="6. Plan\nWrite implementation plan"];
  implement [label="7. Implement\nsubagent-driven-development"];
  stop_interactive [label="STOP\nReturn to user"];

  fetch -> worktree -> gate -> decide;
  decide -> research [label="yes"];
  decide -> brainstorm [label="no"];
  research -> brainstorm;
  brainstorm -> auto_check;
  auto_check -> plan [label="yes"];
  auto_check -> stop_interactive [label="no"];
  plan -> implement -> review -> create_pr -> done;
  review [label="8. Branch Review\nbranch-review --fix"];
  create_pr [label="9. Create PR\npush + gh pr create"];
  done [label="Complete\nPR ready for user", shape=doublecircle];
}
```

## Phase 1: Fetch the Issue

Parse the argument — accept a `TEAM-NUMBER` identifier (e.g. `ENG-123`) or a full Linear URL.

Invoke `linear-list` and `linear-comments` for `<IDENTIFIER>`.

Present a one-line summary to the user:

> Issue ENG-123: refactor auth middleware to use new token format [In Progress]

If the issue cannot be fetched (not found, Linear skill not available), stop and report the error.

## Phase 2: Create Worktree

Set up an isolated workspace **immediately after fetching the issue**, before any file writes (specs, designs, plans). This ensures all artifacts live in the worktree from the start — no copying, no path confusion.

Derive the branch name from the Linear identifier: `<type>/<IDENTIFIER>-<slug>` (e.g., `refactor/ENG-123-auth-middleware-token-format`).
Derive the worktree leaf from the Linear identifier: `<IDENTIFIER>-<slug>`.

Invoke the `issue-worktree-setup` skill. It owns environment detection and
setup policy. Do NOT re-implement the worktree decision logic here.

```bash
ISSUE_WORKTREE_SETUP_DIR="<issue-worktree-setup-skill-dir>"
HELPER_SCRIPT="$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.sh"

WORKTREE_SETUP_OUTPUT=$(
  BRANCH_NAME="<branch-name>" \
  WORKTREE_LEAF="<IDENTIFIER>-<slug>" \
  BASE_REF="origin/main" \
  bash "$HELPER_SCRIPT"
)
```

Resolve `ISSUE_WORKTREE_SETUP_DIR` to the installed
`issue-worktree-setup` skill bundle. The repository working directory may be
any subdirectory inside the target checkout. Parse `WORKTREE_SETUP_OUTPUT`
exactly as specified in the helper skill's output contract; do not
whitespace-split it or assume the script lives under the target repo's own
`scripts/` directory.

Handle the result:

- If `MODE=stop`, surface `MESSAGE` and stop the workflow. The forbidden
  outcome is **producing a worktree (or any equivalent checkout) for this
  issue from inside the current session** — by any mechanism. That includes,
  but is not limited to: `cd`-ing to the primary checkout; passing
  `--git-dir`/`--work-tree`/`-C` to git or to the helper; setting `GIT_DIR`
  or `GIT_WORK_TREE` env vars; calling `git worktree add` directly without
  the helper; cloning the repo elsewhere on disk to escape the gate; or any
  other path that reaches the same end state. If you find yourself
  reasoning about _which_ mechanism is "really" forbidden, you are
  rationalizing — the outcome is the rule. The operator returns to primary
  explicitly and re-runs the skill from there.
- If `MODE=reuse` or `MODE=new`, continue from `WORKTREE_PATH`.

**After worktree is ready:** All subsequent phases (gate, research,
brainstorming, planning, implementation) operate from `WORKTREE_PATH`. Pass
that path to all dispatched subagents.

**If brainstorming concludes "don't implement":** Clean up the worktree with `play-branch-finish` (option: discard).

## Phase 3: Complexity Gate

The gate is **always evaluated** — it is not optional. Only the research phase (Phase 4) is conditional based on the gate's output.

Dispatch a **dedicated exploration agent** using the prompt template in `references/gate-agent-prompt.md`. The agent reads the issue description, scans `docs/adr/` titles, and checks `AGENTS.md` for relevant rules. Use `{{model:standard}}` as the floor — escalate to `{{model:deep}}` for issues with ambiguous scope or multiple conflicting signals.

**Pass to the gate agent:**

- Issue title + description (verbatim)
- Repository root path

**Gate returns:** `RESEARCH_NEEDED` or `SKIP_RESEARCH` with a one-line reason.

**Override:** If the user passed `--research` in the skill args, skip the gate and go directly to research.

### Gate Signals

**Trigger research if ANY of:**

| Signal                   | Detection                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Cross-module impact      | Issue references files/types in 2+ crates or requires coordinated edits across module boundaries |
| New module or public API | Issue describes adding a component, crate, or public interface that doesn't exist yet            |
| No covering ADR          | Scan of `docs/adr/` finds no existing decision covering this domain                              |
| Conflicting guidelines   | Existing policies or ADRs pull in different directions for this issue                            |
| Explicit request         | Issue description contains "brainstorm", "design decision", or "choose between"                  |

**Skip research if ALL of:**

- Single-module, single-file change
- Clear precedent exists in the codebase
- Covering ADR or guideline prescribes the approach

## Phase 4: Research (Conditional)

Dispatch a **dedicated research agent** using the prompt template in `references/research-agent-prompt.md`. Use `{{model:standard}}` as the floor — escalate to `{{model:deep}}` for cross-module or architecturally complex issues.

**Pass to the research agent:**

- Issue title + description
- Repository root path
- Gate agent's reasoning (so it knows why research was triggered)

**Research agent internally dispatches sub-agents in parallel:**

1. Policy/guideline scanner
2. Codebase pattern explorer
3. External OSS precedent searcher (web search + code search)

**Research agent returns:** A synthesized brief (500-1000 words) in the format:

```markdown
## Issue Brief: <IDENTIFIER> — <title>

### Policy Constraints

- [rules that apply]

### Existing Patterns

- [how the codebase handles similar things]

### External Precedent

- [how other projects solve this]

### Recommended Approaches

- [2-3 options, leading with the architecturally cleanest]
```

**Architecture preference:** The research agent surfaces the architecturally cleaner option, not just the easiest one.

## Phase 5: Invoke Brainstorming

Invoke the `play-brainstorm` skill with the combined context below.

**Args format when research was done:**

```
Resolve Linear issue <IDENTIFIER>: <title>

## Issue Description
<verbatim issue description>

## Research Brief
<brief from research agent>
```

**Args format when research was skipped:**

```
Resolve Linear issue <IDENTIFIER>: <title>

## Issue Description
<verbatim issue description>

## Research Brief
Skipped — <reason from gate agent>. Proceed with codebase exploration in brainstorming.
```

**`--auto` mode behavior in brainstorming:**

When `--auto` is set, the brainstorming skill still runs fully (exploration, option generation, spec writing), but:

- Do NOT ask the user to choose between options — pick the architecturally cleanest approach
- Do NOT wait for user approval of the spec/design — proceed immediately
- Do NOT ask clarifying questions — make reasonable assumptions and document them in the spec

These bullets cover routine clarifications and tie-breakable choices. The exception below — genuine architectural ambiguity with no clean winner — is the one case where stopping `--auto` is required.

If brainstorming surfaces a decision that is genuinely ambiguous (two equally valid approaches with different trade-offs), **stop `--auto` mode and ask the user**. Resume autonomous execution after their answer.

**Don't launder a coin-flip into a fait accompli.** "Document the assumption in the spec and let the user override at PR review" sounds reasonable but is the same violation. Once a plan and implementation exist, the user reviewing the PR is anchoring against working code, not deciding fresh between options — that's a worse decision context, not a better one. A 30-second question now beats a re-implementation later.

**Third-party "either is fine" is not authorization.** PM comments on the Linear issue, teammate Slack messages, threaded discussion on the ticket — none of these count as in-session authorization for `--auto` to silently pick. They are schedule pressure dressed as consent. Surface the choice to the operator who ran `--auto`; that's the only authorization channel that counts.

**Without `--auto`:** Stop after brainstorming completes. Return control to the user.

## Phases 6-9: Autonomous Execution (`--auto` only)

These phases run only when `--auto` is set. They chain automatically after brainstorming.

**`--auto` removes user checkpoints. It does not remove phases.** The full pipeline runs end-to-end; only the gates between phases are bypassed. Phases are never skipped, streamlined, or short-circuited because an issue "looks simple," because a teammate is impatient, or because CI is green.

### Phase 6: Write Plan

Invoke `play-planning` using the spec produced in Phase 5. Do not wait for user review of the plan — proceed directly to implementation.

### Phase 7: Implement

Invoke `play-subagent-execution` to execute the plan. All subagent-driven-development rules apply (fresh subagent per task, plus per-task two-stage review — spec compliance then code quality — for multi-task plans; single-task plans skip per-task review and rely on Phase 8 branch-review, see ADR-0007).

### Phase 8: Branch Review

Invoke `branch-review --fix` to review the implementation before creating a PR.

This runs the full multi-agent review (correctness, data-safety, language-specific agents, critic verification) on `git diff main...HEAD`. With `--fix`, blocking findings are auto-fixed and committed. Nits are collected for the PR description.

If a blocking finding requires design changes, **stop `--auto` and report to the user**.

### Phase 9: Create PR

Invoke `play-branch-finish`. In `--auto` mode, choose **option 2: push and create PR**. Do NOT merge — the PR is the user's review gate.

**Always assign the PR to yourself:** Pass `--assignee @me` to `gh pr create`.

**Before composing the PR title and description**, glob for project PR guidelines (`**/pr-guideline*.md`, `**/pr-*.md`, `CONTRIBUTING.md`) and read them. Follow the project's title format and description template exactly. If no guideline is found, use the defaults below.

**Default PR title:** Follow Conventional Commits — `<type>(<scope>): <short summary>`. Do not append issue identifiers to the title; link issues in the description body instead.

**Default PR description should include:**

- Linear issue reference (`Closes <IDENTIFIER>` with link to the Linear issue)
- The design decisions made (especially any assumptions from Phase 5)
- Summary of what was implemented
- Remaining nits from Phase 8 (if any), so the user knows what to look at

## Quick Reference

| Phase            | What                                | Key constraint                                               |
| ---------------- | ----------------------------------- | ------------------------------------------------------------ |
| 1. Fetch         | `linear-list`                       | Stop if not found                                            |
| 2. Worktree      | Isolate before file writes          | Detect managed worktree vs local                             |
| 3. Gate          | Dedicated agent assesses complexity | Always evaluated; default to `RESEARCH_NEEDED` on failure    |
| 4. Research      | Dedicated agent synthesizes brief   | Optional — only if gate says so                              |
| 5. Brainstorm    | Invoke `play-brainstorm`            | Never skip, even for "simple" issues                         |
| 6. Plan          | `play-planning`                     | `--auto` only                                                |
| 7. Implement     | `play-subagent-execution`           | `--auto` only                                                |
| 8. Branch Review | `branch-review --fix`               | `--auto` only; review before PR, not after                   |
| 9. Create PR     | Push + `gh pr create`               | `--auto` only; never auto-merge; follow project PR guideline |

## Common Mistakes

### Writing specs to main workspace instead of worktree

- **Problem:** Spec/plan files end up outside the worktree, subagents read wrong paths
- **Fix:** Worktree is created in Phase 2, before brainstorming writes any files

### Creating nested worktree in an already-managed session

- **Problem:** Creating a fresh worktree from inside an existing managed worktree causes double nesting and path confusion
- **Fix:** Invoke `issue-worktree-setup` and obey `MODE=stop`. If already inside a non-primary worktree, either branch in place when safe or stop and return to the primary checkout before creating another worktree

### Running research in the main session

- **Problem:** CI logs, file reads, and web searches pollute the main context window
- **Fix:** Always dispatch dedicated agents for gate and research phases

### Ignoring project PR guideline

- **Problem:** PR title/description uses a generic format instead of the project's required template, requiring manual rework
- **Fix:** Always glob for PR guidelines before composing the PR title and description in Phase 9

### Skipping the gate for "obvious" issues

- **Problem:** Single-module issues sometimes have hidden cross-module dependencies
- **Fix:** Always run the gate — it's cheap (exploration agent, `{{model:standard}}`) and catches surprises

### Skipping brainstorming for "trivial" issues

- **Problem:** A typo fix or one-line change feels too small to brainstorm, so the phase gets dropped — but the worktree-and-PR scaffold is the value, not the deliberation depth
- **Fix:** Always run brainstorming. For genuinely trivial issues it returns in seconds with a one-line spec; that's fine and still goes through the pipeline

### Treating out-of-band authorization as merge consent

- **Problem:** Teammate claims, prior-session statements ("I'm in war room, do whatever"), incident urgency, or inferred intent get treated as merge authorization — bypassing the PR review gate
- **Fix:** Only an in-session, in-context user instruction counts, and even then prefer surfacing to the user over acting. The PR is the user's review gate; `--auto` does not widen that authority. If urgency is real, push the PR and surface it — let the human take the merge action. The same applies to Linear status: do not move the issue to "Done" (or any state that implies resolution) — that piggybacks on the same pre-authorization vector. Leave it in "In Review" (or the team's equivalent) for the human

## Red Flags — You Are Violating This Skill

- You skipped the gate and went straight to brainstorming without assessing complexity
- You ran the research agent in the main session instead of a dedicated agent
- You started implementing before invoking brainstorming
- You dumped raw research output instead of passing the synthesized brief
- You skipped brainstorming because "the issue is simple enough"
- You wrote spec/design/plan files outside the worktree
- You created a nested worktree inside an already-managed worktree
- You auto-merged a PR in `--auto` mode for any reason — including incident urgency, claimed pre-authorization, or green CI (the PR is the user's review gate)
- You silently picked an option when two approaches had genuinely different trade-offs in `--auto` mode
- You composed a PR title/description without reading the project's PR guideline first

**All of these mean: STOP. Go back to the workflow.**

## Error Handling

| Scenario                       | Action                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| Linear skill not available     | Stop, suggest checking Linear plugin/MCP configuration                    |
| Issue not found                | Stop, verify identifier/URL                                               |
| Issue already completed/closed | Warn user, ask whether to proceed                                         |
| Gate agent fails               | Default to `RESEARCH_NEEDED` (safer to over-research than under-research) |
| Research agent fails/times out | Report partial results, invoke brainstorming with what's available        |
| No `docs/adr/` directory       | Gate treats as "no covering ADR" (research signal)                        |

## Project-Specific Overrides

These rules apply to any project using this skill. They override defaults from downstream skills.

### Model selection

Use `{{model:standard}}` as the floor for agents that make judgment calls during exploration and planning. Reviewer roles run at `{{model:deep}}` to match the downstream `branch-review` / `pr-review` floor — the authoritative defaults are pinned in `agents/spec-compliance-reviewer.yaml` and `agents/code-quality-reviewer.yaml`; the rows below mirror those for reader convenience and are not enforced by this skill. Only `{{model:fast}}` is acceptable for mechanical implementer tasks with fully-specified plans.

| Agent                    | Minimum model        | Notes                                                                                               |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------- |
| Gate (Phase 3)           | `{{model:standard}}` | Escalate to `{{model:deep}}` for ambiguous scope or multiple conflicting signals                    |
| Research (Phase 4)       | `{{model:standard}}` | Escalate to `{{model:deep}}` for cross-module or architecturally complex issues                     |
| Spec compliance reviewer | `{{model:deep}}`     | Raised from `{{model:standard}}`; applies on multi-task plans (single-task plans skip per ADR-0007) |
| Code quality reviewer    | `{{model:deep}}`     | Raised from `{{model:standard}}`; applies on multi-task plans (single-task plans skip per ADR-0007) |
| PR review agents         | `{{model:deep}}`     | Always — final gate, highest cost of failure                                                        |

## What This Skill Does NOT Do

**Without `--auto`:**

- Does not write code or create PRs
- Does not manage implementation — returns control to user after brainstorming

**With `--auto`:**

- Does not merge PRs — the PR is the user's review gate
- Does not skip brainstorming or planning — runs the full pipeline, just without user checkpoints
- Does not make genuinely ambiguous design decisions — stops and asks if options are equally valid
