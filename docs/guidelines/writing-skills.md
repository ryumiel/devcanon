# Writing Skills

This guide covers how to author or edit skills under `skills/` in this
repository: the project-specific layer that the
[skill spec](../specs/skills.md) and the
[`play-skill-authoring`](../../skills/play-skill-authoring/SKILL.md) skill
do not cover.

For general skill-writing discipline (TDD with subagent pressure scenarios,
rationalization tables, anti-patterns), use `play-skill-authoring`. For the
authoritative frontmatter schema, see `docs/specs/skills.md`. This guide
focuses on the dual-target rendering pipeline and the local authoring loop.

## 1. Skill, Agent, or Project Doc?

Default to a skill for reusable operational knowledge — workflows,
checklists, reference material, and methods that apply across projects.

Choose differently when:

- You need a role wrapper with tool, sandbox, model-capability, or explicit
  effort constraints. Create
  an agent. See [`agent-authoring-guide.md`](agent-authoring-guide.md).
- The content is a project rule or convention specific to this repo. Put it
  in [`AGENTS.md`](../../AGENTS.md) or a `docs/guidelines/` doc.
- The constraint is mechanically enforceable (regex, schema, validator).
  Automate it; reserve documentation for judgment calls.

## 2. Authoring Loop

Skills in this repo render to two targets (Claude Code and Codex). The
local loop is:

1. Scaffold: `pnpm run dev -- new skill <name>`.
2. Edit `skills/<name>/SKILL.md`, plus optional `assets/`, `examples/`,
   `references/`, or `scripts/` subdirectories. These mirror per target
   into `generated/<target>/skills/<name>/` as-is. Anything else at the
   skill root (other than hidden entries) is flagged by `validate`; move
   supporting material under `references/`.
3. Validate: `pnpm run dev -- validate`. Use `validate --strict` to
   promote strictable warnings, including drift and unknown root entries, into errors before
   committing. Oversized `SKILL.md` prompt diagnostics remain advisory
   warnings even in strict mode.
4. Render: `pnpm run dev -- render`. Inspect both
   `generated/claude/skills/<name>/` and `generated/codex/skills/<name>/`
   to confirm each target receives the expected frontmatter and body.
5. Diff: `pnpm run dev -- diff` against installed home directories.
6. Sync: `pnpm run dev -- sync` writes to `~/.claude/skills/<name>/` and
   `~/.agents/skills/<name>/`. Install mode (symlink vs. copy) determines
   whether subsequent renders are picked up automatically; see
   [`shared-skill-reporting-workflow.md`](shared-skill-reporting-workflow.md)
   § 5 for the install-mode note.

## 3. Dual-Target Frontmatter

Frontmatter is strict: unknown top-level keys are rejected. Three optional
override blocks (`claude:`, `codex:`, `codex_sidecar:`) host
target-specific fields; everything else is shared and emitted to both
targets. Reach for an override block only when the shared default is
inadequate.

### Shared-only (default)

Most skills need only `name`, `description`, and optionally
`allowed-tools`. Examples: `branch-review`, `pr-merge`,
`play-verification`.

### `claude:` for model and effort

Use when a Claude run benefits from a specific model capability or explicit
target-native effort.
The `claude:` block accepts `model`, `effort`, `when_to_use`,
`argument-hint`, `arguments`, `disable-model-invocation`,
`user-invocable`, `context`, `agent`, `paths`, and `shell`.

```yaml
claude:
  model: "{{model:frontier}}"
```

Shipped example: `skills/issue-priming-workflow/SKILL.md` uses
`{{model:frontier}}` because its workflow orchestrates gate, research,
planning, and execution. The `skills/github-issue-priming/SKILL.md` and
`skills/linear-issue-priming/SKILL.md` entrypoints that hand off to it
also pin `{{model:frontier}}` so the source-specific fetch runs on the same
model capability.

Skill model placeholders choose only the target model. Set `claude.effort`
explicitly when the skill requires an effort constraint; otherwise omit it and
allow ambient Claude behavior. Do not infer effort, tools, context, authority,
or workflow policy from model capability.

#### `user-invocable: false` vs `disable-model-invocation: true`

Both fields affect discoverability, but they control different surfaces.
Pick the right one when deciding whether a skill should be user-facing,
model-selected from ambient context, or invoked only by explicit user
request.

- **`claude.user-invocable: false`** — hides the skill from the
  slash-command menu, but sibling skills can still invoke it through
  the Skill tool. Description-based auto-routing still applies, so the
  description should be written to discourage incidental matches. Use
  this for shared internal procedures that other skills delegate to —
  for example, `skills/play-review/SKILL.md`, called by both
  `branch-review` and `pr-review`.
- **`claude.disable-model-invocation: true`** — prevents Claude from
  invoking the skill through the Skill tool. Use this only for skills
  that must be manual slash commands and are not delegated to by other
  skills.

The wrapper pattern (a public skill thin-delegating to a shared
internal skill) requires `user-invocable: false`. Setting
`disable-model-invocation: true` is not a substitute for
`user-invocable: false` on an internal shared skill: the skill would
remain user-facing instead of being hidden behind its wrappers. See
[issue #149](https://github.com/ryumiel/agent-manager/issues/149)
for the wrapper-visibility precedent.

Public workflows that must be user-explicit while still allowing owning
workflow hand-offs should rely on restrictive description wording and
Codex `policy.allow_implicit_invocation: false`; do not set
`disable-model-invocation: true` on those delegated workflows.

### `codex:` for license and metadata

Use to set Codex-specific frontmatter that ships in the rendered Codex
`SKILL.md`. Accepts `license` and `metadata`.

```yaml
codex:
  license: MIT
  metadata:
    short-description: Prime a GitHub issue into a research-backed implementation workflow
```

### `codex_sidecar:` for Codex UI

The sidecar emits a separate
`generated/codex/skills/<name>/agents/openai.yaml` for the Codex target
only — it is not inlined into the Codex `SKILL.md`. Use it when the skill
benefits from a Codex UI label, description, or brand color. Accepts
`interface`, `policy`, and `dependencies`.

If `targets.codex.skillDisplayNameSuffix` is configured, the renderer appends that
suffix to `interface.display_name`. When no display name is declared, the
renderer derives one from the skill name before appending the suffix. Keep
source `display_name` values focused on the human-readable label; use config
for library or distribution suffixes such as `(devcanon)`.

`skills/pr-review/SKILL.md` uses `codex_sidecar:` without a `codex:`
block: it needs a UI label but no extra Codex frontmatter.

```yaml
codex_sidecar:
  interface:
    display_name: PR Review
    short_description: Run a multi-agent review of a GitHub pull request
    brand_color: "#0969da"
```

## 4. Description Style

The `description` field is what both Claude and Codex pre-load into context to
decide whether a skill applies. The shared `description` is rendered identically
into both targets, so it must satisfy both upstream conventions — which agree on
the same shape.

**Rule:** name the capability, then name the trigger. Third person.

```yaml
description: <Capability — what the skill does>. Use when <triggering conditions, symptoms, artifacts, or user phrases>.
```

- Lead with the capability — a third-person declarative clause naming what the
  skill does (verb-first: "Executes…", "Reviews…", "Generates…").
- Follow with `Use when…` — concrete triggers: situations, artifacts, user
  phrases, error symptoms.
- For sibling-prone skills, add `Do not use when…` or a contrastive cue.
- Do **not** encode procedural detail — step counts, ordered sequences, or
  decision branches. The description is pre-loaded unconditionally; a procedural
  one-liner can substitute for the body and cause the model to skip nuance the
  body owns.

For the full rule, examples, red flags, and mechanical constraints, see
[`../specs/skills.md`](../specs/skills.md) § Description style.

## 5. Placeholders

Three placeholder namespaces resolve at render time against
glossaries in
[`devcanon.config.yaml`](../../devcanon.config.yaml):

- `{{model:efficient}}`, `{{model:balanced}}`, `{{model:frontier}}` for
  model-capability references.
- `{{tool:<key>}}` for tool names that differ across targets, e.g.
  `{{tool:task-tracker}}` → `TodoWrite` (Claude) / `update_plan`
  (Codex).
- `{{file:<key>}}` for artifact files, e.g.
  `{{file:project-instructions}}` → `CLAUDE.md` (Claude) /
  `AGENTS.md` (Codex).

Rules:

- Only `model:`, `tool:`, and `file:` namespaces are permitted;
  other namespaces are rejected at render time.
- Escape with a leading backslash: `\{{tool:task-tracker}}`.
- Placeholders inside fenced code blocks (backtick or tilde) are
  not substituted.
- Override-block top-level string values are substituted; nested
  values (for example `codex.metadata.*`) pass through unchanged.

`capabilityProfiles` has exactly three required model-only keys. `toolNames`
and `fileArtifacts` remain configurable glossaries. Capability names are not
customizable and do not carry effort.

## 6. Shared-Prose Conventions

Shared body prose must read sensibly under both targets.

1. Use placeholders (`{{model:*}}`, `{{tool:*}}`, `{{file:*}}`)
   for target-specific names whenever a glossary entry exists or
   can be added.
2. Use intent-based language (e.g. "task tracker", "project
   instructions file") when no concrete spelling adds value or
   when the prose is conceptual rather than operational.
3. Avoid hard-coded product-specific home paths.
4. Avoid project-internal references in shared body prose: ADR
   numbers (`ADR-NNNN`), GitHub issue/PR shorthand (`#NNN`), and
   `github.com/<owner>/<repo>` links. Skills render user-wide and
   must read coherently outside this repo. Replace such references
   with self-contained prose or within-skills cross-links. (ADR
   files themselves are project documentation and may reference each
   other freely. Absolute repo URLs may be retained when the skill's
   purpose is to point external consumers at this repo — e.g., a
   skill that helps users open issues against this repo.)

Drift diagnostics flag literal target-specific tokens (configured model IDs,
tool names, artifact files, and target paths). Token sets for
models, tools, and files are auto-derived from
`devcanon.config.yaml`; the path check covers `.claude/`,
`.codex/`, and `.agents/`.

`pnpm run dev -- validate` reports drift as a warning.
`validate --strict` treats it as a failure; run that before
opening a PR.

### Prompt-size advisory

`SKILL.md` is the always-loaded prompt for the skill. Keep it focused on the
trigger, authority rules, required workflow steps, safety constraints, and
short decision criteria that the model needs immediately. Do not compress
important material into vague prose just to reduce size; use progressive
disclosure instead.

Use these size guidelines for the main `SKILL.md`:

- Keep the main `SKILL.md` under `500` lines.
- Target `1,500`-`3,500` estimated GPT tokens.
- Treat about `5,000` estimated GPT tokens as the soft upper bound.
- Keep critical instructions, safety rules, and output contracts before token
  `5,000`.

`pnpm run dev -- validate` warns when raw `SKILL.md` source is estimated above
the `5,000` GPT-token soft upper bound using the `o200k_base` encoding, or when
the file reaches `500` lines. The count is an authoring estimate, not a
billing-accurate or cross-provider exact count, and may differ from the final
rendered or host-wrapped prompt. This diagnostic is warning-only for now,
including under `validate --strict`; configurable thresholds, strict
enforcement, and baseline mechanics are deferred.

Move non-eager material into the bundled subdirectories when the model can load
it only after the skill is selected:

- `examples/` for worked examples, sample inputs and outputs, and edge-case
  walkthroughs.
- `references/` for rationale, long policy background, branch-specific or
  project-local policy, comparison tables, and lookup material.
- `assets/` for images, fixtures, templates, or other non-prose inputs the
  skill may need.
- `scripts/` for deterministic mechanics, helper programs, validation probes,
  and repeatable transformations.

Prefer moving coherent supporting sections over deleting nuance. A smaller
`SKILL.md` is useful only when the remaining prompt still tells the agent when
to use the skill, what contract it must preserve, and which supporting file or
script to open when more detail is needed.

### Future controller capability transitions

When authoring a controller that could change a direct child's capability or
effort after a failure, reference `subagent-lifecycle` and the Agent Routing and
Mutation Policy adoption inventory. Declare either the shared owner's complete
exact target-supported current and next capability plus effort, mechanism,
budget, invariants, and terminal behavior, or an explicit opt-out with
`transition: none`. Do not infer a transition from ambient, nearby, alias, or
role substitution. No static agent schema change is required: controller
orchestration remains skill prose and the shared owner remains the sole common
policy source.

## 7. Testing

The general discipline lives in
[`play-skill-authoring`](../../skills/play-skill-authoring/SKILL.md):
RED (baseline pressure scenarios with subagents) → GREEN (write the
minimal skill) → REFACTOR (close loopholes). Apply it to new skills and
to non-trivial edits.

In addition, this repo expects:

- `pnpm run dev -- validate --strict` passes.
- Any oversized `SKILL.md` advisory warning has been reviewed and either fixed
  by moving non-eager material into supporting files or intentionally accepted
  as warning-only.
- Both rendered outputs (`generated/claude/skills/<name>/` and
  `generated/codex/skills/<name>/`) read correctly under their target.
- Tests under `src/render/` that snapshot shipped skill metadata are
  updated in the same PR if the change affects them.

## 8. Generated/Reference Coverage Trigger

Classify each skill-adjacent change by the source-owned contract it affects:

- **Source skill prose:** Changes to `SKILL.md` workflow policy, handoff
  schemas, notice lines, authority rules, trust boundaries, or other
  load-bearing prose need focused source-contract coverage under
  `src/skill-contracts/`. Do not use generated-output snapshots to own broad
  source prose. When the change introduces or materially changes generated
  artifacts, derived artifacts, helper I/O files, `.ephemeral` handoffs,
  cross-skill handoffs, or side-channel data, apply the Side-Channel Artifact
  Contract Checklist in `docs/guidelines/documentation-checklists.md` before
  deciding the source-contract, script-runtime, render, or no-generated-output
  coverage route.
- **Bundled references:** Changes under `references/`, `assets/`, or
  `examples/` need render coverage only when the mirrored packaging behavior is
  the contract being protected. Otherwise, pin load-bearing reference prose in
  source-contract tests.
- **Scripts:** Changes under `scripts/` need source script runtime coverage
  when executable behavior changes. Render tests may assert that representative
  scripts are mirrored to both targets, but they should not replace runtime
  tests.
- **Target metadata and sidecars:** Changes to `claude:`, `codex:`,
  `codex_sidecar:`, or generated target packaging contracts need focused
  `src/render/` coverage and metadata snapshot updates when those snapshots
  represent the behavior under test.
- **Touched-skill allowlists:** If a render or smoke test uses a touched-skill
  allowlist, record why each skill belongs there. Every changed skill directory
  represented by explicit metadata expectations must be included in that
  coverage set, or the test must derive the set from source structure.

Generated output is disposable verification evidence. Source files, source
tests, and render tests own the contract; do not make `generated/` files
authoritative, and do not snapshot every generated byte for incidental prose
changes that have no generated-output contract.

## 9. PR Checklist for `skills/` Changes

- [ ] Frontmatter validates and uses an override block only when the
      shared default is inadequate.
- [ ] `description` follows § 4 — names what the skill does and when to use it,
      third person, no procedural detail (no step counts, ordered sequences, or
      decision branches).
- [ ] Both rendered targets diffed locally and read correctly.
- [ ] `pnpm run dev -- validate --strict` passes.
- [ ] Any prompt-size warning has been reviewed against § 6; oversized
      always-loaded material is moved to supporting files unless the warning is
      intentionally accepted.
- [ ] Any supporting files validate per
      [`../specs/skills.md`](../specs/skills.md).
- [ ] Snapshot tests for shipped skill metadata updated if affected.
- [ ] Source-contract, render, script-runtime, or no generated-output coverage
      chosen according to § 8.
- [ ] [`MAP.md`](../../MAP.md) and [`AGENTS.md`](../../AGENTS.md) updated
      if a new skill or doc is introduced (per
      [`documentation-standard.md`](documentation-standard.md) § 5.2).
- [ ] PR follows [`pr-guideline.md`](pr-guideline.md) and the relevant
      items from
      [`documentation-checklists.md`](documentation-checklists.md).

## 10. See Also

- [`../specs/skills.md`](../specs/skills.md) — frontmatter schema and
  validation rules
- [`../specs/target-mapping.md`](../specs/target-mapping.md) — install
  paths per target
- [`../adr/adr-0005-per-target-skill-rendering.md`](../adr/adr-0005-per-target-skill-rendering.md)
  — decision record for per-target skill rendering
- [`../../skills/play-skill-authoring/SKILL.md`](../../skills/play-skill-authoring/SKILL.md)
  — TDD-for-skills discipline
- [`agent-authoring-guide.md`](agent-authoring-guide.md) — when to create
  an agent instead
