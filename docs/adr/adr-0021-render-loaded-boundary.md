# ADR-0021: Render Loaded Boundary

## Status

Accepted

## Context

The render pipeline historically exposed `renderAll()` as a single facade that
loads source skills and agents, validates them, renders target-native outputs,
and optionally writes the disposable `generated/` preview tree. That shape is
convenient for CLI commands and sync, but it couples rendering to source loading
and validation. Validation-owning orchestration, such as cached or watch-style
flows, needs a way to render from already-loaded data without repeating source
validation.

At the same time, generated-output cleanup is destructive. Removing stale
generated files is correct only when the renderer has a complete source-library
view for the selected targets. Partial loaded-input renders must not treat
omitted skills or agents as stale.

## Decision

Keep `renderAll()` as the source-driven full-library facade. It owns loading and
validation from configured source directories, delegates to the loaded-input
render core, and when writing generated output, performs stale generated-output
cleanup for the selected complete source set.

Expose `renderLoaded()` as the loaded-input render boundary. It accepts an
options object containing `ResolvedConfig`, already-loaded `LoadedSkill[]` and
`LoadedAgent[]`, optional target filtering, and an explicit generated-write
toggle. It does not reload skill or agent source definitions, does not write
generated output by default, and does not perform stale cleanup. Partial
loaded-input renders can write supplied outputs when requested, but omitted
inputs are not deleted.

`renderLoaded()` defensively validates that supplied loaded objects still match
the validated shape and loader-equivalent filesystem locations. Skill mirrored
subdirectories remain source-backed: when a loaded skill includes mirrored
subdirectories, render hashing and generated writes read those directories from
`LoadedSkill.dirPath`.

## Consequences

- Existing `renderAll()` callers keep the same source-driven behavior and full
  generated cleanup semantics.
- Validation-owning callers can render already-loaded full or partial input
  sets without coupling rendering to validation loaders.
- Partial loaded-input renders avoid accidental deletion of unrelated generated
  outputs.
- Loaded-input renders are not fully source-file independent for skills with
  mirrored subdirectories, because those mirrored files are not embedded in
  `LoadedSkill`.
- The loaded-input boundary must keep defensive checks around generated paths
  and loader-equivalent source paths because generated writes and cleanup touch
  the filesystem.

## Alternatives considered

- Add optional preloaded skills and agents to `renderAll()`. Rejected because a
  single function would mix source-loading and loaded-input modes while still
  exposing destructive cleanup ambiguity.
- Make loaded-input renders fully source-file independent by embedding mirrored
  subdirectory contents in `LoadedSkill`. Rejected for now because it broadens
  the domain model and hash/copy contracts beyond the current refactor.
- Leave `renderAll()` unchanged until a watch mode exists. Rejected because it
  preserves the render/validation coupling and makes future cached orchestration
  harder to add cleanly.
