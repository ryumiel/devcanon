# Internal rationale — Phase 2.5 design choices

This file collects the rationale prose for `play-review`'s Phase 2.5 (the
helper-backed shared review-context file). The decisions themselves are encoded
in `SKILL.md`'s Phase 2.5 procedure; this file explains _why_.

## Why a helper-backed manifest

Phase 2.5 has deterministic mechanics that are easy to drift when copied as
prompt prose: direct-child `.ephemeral` paths, symlink rejection, input/output
path binding, schema checks, UTF-8 byte accounting, section budgets, item caps,
overflow markers, and atomic replacement. ADR-0019 assigns those mechanics to a
skill-owned script while keeping workflow policy in the skill body.

The input manifest keeps controller-owned judgment explicit: reviewers receive
summaries, exact-source references, minimized excerpts, and untrusted prior
carry-forward anchors instead of unbounded guideline files or raw prior review
threads. The helper then enforces the stable rendering contract and fails closed
before Phase 3 when required summaries, trust labels, bindings, or budgets do
not hold.

## Why no consumer path-validation guard

The findings file (§ Output) requires consumers to validate the parsed path
because external skills open it. The shared review-context file is internal to
`play-review`: only Phase 3 agents dispatched by this skill read it, and the
path is computed by the Phase 2.5 helper from the validated findings path and
embedded in reviewer prompts by this skill — never parsed off conversation prose
by an external caller. No consumer-side validation is needed _as long as_ this
file remains internal to `play-review`'s Phase 3 dispatch; manifest preparation
and helper validation are sufficient under that invariant. If a future change
exposes the shared review-context file to external readers, restore the
validation guard described in § Output.

## Why no notice line

The findings file emits `Findings written to <path>.` because external
wrappers parse it. The shared review-context file has no external
readers; documenting its existence in this section is enough.
