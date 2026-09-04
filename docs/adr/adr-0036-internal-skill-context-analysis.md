# ADR-0036: Keep Skill Context Analysis Internal

## Status

Accepted

## Context

Skill-context measurement needs the exact source, target-rendered, discovery,
and declared support-file text that a skill would contribute at use time. It
also needs a bounded way to compare canonical measurements and retain a result
for local follow-up. Making that capability part of a public command or the
normal validation, rendering, installation, or synchronization paths would
expand user-facing behavior and couple production consumers to a diagnostic
workflow.

The analysis needs trusted `LoadedSkill` and `LoadedAgent` values rather than
another loading or validation path. It must preserve the existing render
boundary: ADR-0021 owns the semantics of `renderLoaded()` and its
write-disabled operation. The result and declared support files are filesystem
boundaries, so their containment, file-kind, and point-in-time checks must be
kept with the executable owner rather than reproduced by callers.

## Decision

Keep `src/analysis/` internal-only. It is a one-way consumer of validated
producer values and existing implementation owners: it consumes trusted
`LoadedSkill` and `LoadedAgent` values, uses `renderLoaded()` with generated
writes disabled, measures the renderer's exact output content, and reuses the
token primitive in `src/utils/token-count.ts`. Production render, validation,
CLI, configuration, install, and sync modules do not depend on analysis.

Analysis reads only declared support files within validated skill-bundle
boundaries and treats result directories and comparison outputs as guarded,
point-in-time filesystem inputs. Result publication is limited to an existing,
ignored directory beneath `.ephemeral/`. It verifies containment and file
state, writes a complete private temporary file, verifies the owned temporary,
and renames it into place only after those checks. Failure cleanup removes only
the temporary file whose ownership and identity the publisher established.

This decision adds no public CLI command, configuration key, validation
behavior, rendered format, install behavior, or sync behavior. ADR-0021
continues to own the loaded-input rendering and write-disabled rendering
boundary; this ADR only records analysis as its internal consumer.

## Consequences

- Analysis can measure exact current render content without introducing a
  second renderer, tokenizer, loading path, or validation authority.
- Validated loaded values are the trusted producer inputs for analysis
  requests; the runner keeps its request-shape checks separate from loading
  and validation authority.
- Support-file reads and result publication remain fail-closed at their
  declared boundaries, including checks immediately around reading or
  publishing.
- Local results are recoverable ignored artifacts, not generated previews,
  installed managed outputs, or durable repository records.
- Focused analysis contract, runner, and filesystem checks provide closeout
  proof for this isolated boundary without requiring public-pipeline coverage.

## Alternatives considered

- Add a public CLI command or configuration surface. Rejected because the
  capability is internal diagnostic work and public behavior needs separate
  product and behavior ownership.
- Reimplement rendering or token estimation inside analysis. Rejected because
  measurements must use the exact existing render content and token primitive.
- Let analysis load or validate source definitions itself. Rejected because it
  would duplicate producer authority and weaken the trusted loaded-value
  boundary.
- Write directly to a caller-selected result path. Rejected because a complete
  temporary write, ownership checks, and atomic rename are required to keep
  local output bounded and recoverable.
