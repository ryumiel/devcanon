# Internal rationale — Phase 2.5 design choices

This file collects the rationale prose for `play-review`'s Phase 2.5 (shared
review-context file). The decisions themselves are encoded in `SKILL.md`'s
Phase 2.5 procedure; this file explains *why*.

## Why no consumer path-validation guard

The findings file (§ Output) requires consumers to validate the parsed
path because external skills open it. The shared review-context file is
internal to `play-review`: only Phase 3 agents dispatched by this skill
read it, and the path is computed and embedded in their prompts by this
skill — never parsed off conversation prose by an external caller. No
consumer-side validation is needed *as long as* this file remains
internal to `play-review`'s Phase 3 dispatch; the symlink guard at write
time is sufficient under that invariant. If a future change exposes the
shared review-context file to external readers, restore the validation
guard described in § Output.

## Why no notice line

The findings file emits `Findings written to <path>.` because external
wrappers parse it. The shared review-context file has no external
readers; documenting its existence in this section is enough.
