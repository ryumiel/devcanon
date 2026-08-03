# DevCanon Terminology

This dictionary owns the human-language meaning of the terms listed here. It
maps terms to their executable owners; it does not replace them. Typed
executable contracts remain authoritative for protocol enums, schemas, command
inputs, outcomes, and reason codes.

## Entry fields

Each entry records a canonical term, precise definition, owning contract or
module, corresponding protocol identifier when applicable, allowed display
aliases, and deprecated or forbidden synonyms.

## PR-review lifecycle and artifacts

### Review handoff manifest

- **Canonical term:** review handoff manifest.
- **Definition:** The validated artifact that binds a PR-review invocation to
  its selected review inputs before `play-review` runs.
- **Owner:** `src/runtime/pr-review-manifests.ts` and
  `skills/pr-review/scripts/review-manifests.sh`.
- **Protocol identifier:** `pr-review/handoff/v1`.
- **Allowed display aliases:** handoff manifest; review handoff.
- **Deprecated or forbidden synonyms:** handoff JSON; review context file.

### Review result manifest

- **Canonical term:** review result manifest.
- **Definition:** The validated artifact that records the review result and
  its bound artifact references for rendering or resume.
- **Owner:** `src/runtime/pr-review-manifests.ts` and
  `skills/pr-review/scripts/review-manifests.sh`.
- **Protocol identifier:** `pr-review/result/v1`.
- **Allowed display aliases:** result manifest; review result.
- **Deprecated or forbidden synonyms:** result JSON; approval manifest.

### Review lease

- **Canonical term:** review lease.
- **Definition:** The lifecycle record for a PR-review session and its
  worktree identity.
- **Owner:** `src/runtime/pr-review-leases.ts` and
  `skills/pr-review/scripts/review-leases.sh`.
- **Protocol identifier:** `pr-review/lease/v1`.
- **Allowed display aliases:** lease; review session lease.
- **Deprecated or forbidden synonyms:** lock file; session lock.

### Approved-review artifact

- **Canonical term:** approved-review artifact.
- **Definition:** The helper-validated envelope that freezes and binds the
  approved review's source artifacts, digests, scope decision, and exact
  payload after approval.
- **Owner:** `skills/pr-review/scripts/approved-review-artifacts.sh`.
- **Protocol identifier:** `pr-review/approved-review/v1`.
- **Allowed display aliases:** approved review; frozen approved review.
- **Deprecated or forbidden synonyms:** approval manifest; review approval
  record.

### Phase 5 user gate

- **Canonical term:** Phase 5 user gate.
- **Definition:** The required approval boundary between a rendered review
  preview and posting.
- **Owner:** `skills/pr-review/SKILL.md` Phase 5.
- **Protocol identifier:** none.
- **Allowed display aliases:** user gate; user approval gate; preview approval
  gate; Phase 5 gate.
- **Deprecated or forbidden synonyms:** auto-post gate; implicit approval.
