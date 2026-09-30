# Mechanical task example

This complete authored example demonstrates the optional `**Mode:** mechanical`
field described in `../SKILL.md`. It uses the planning projection's required
Task ID spelling and can be inspected by the existing projection validator.
The approved rename issue and target file below are hypothetical. The issue's
“Exact token replacement” section authorizes replacing `OldExampleToken` with
`NewExampleToken` only in `examples/demo-note.md`.

## Execution Projection

- **Entry ID:** `EP-RENAME-EXAMPLE-TOKEN`
  - **Affected surface or equivalent set:** ["examples/demo-note.md"]
  - **Owner/source:** Hypothetical approved rename issue § “Exact token replacement” — authorizes the exact replacement in `examples/demo-note.md`
  - **Mode:** `reference`
  - **Implementation disposition:** Tasks [`RENAME-EXAMPLE-TOKEN`]
  - **Proof:** Task `RENAME-EXAMPLE-TOKEN` — focused token replacement check

## Tasks

### Task 1: Rename Example Token

**Task ID:** RENAME-EXAMPLE-TOKEN

**Boundary rows:** []

**Supporting-owner supplements:** []

**Contract tier:** NO-TRIGGER

**Mode:** mechanical

**Risk hint:** low
**Review hint:** none-final-only
**Review rationale:** Exact single-file identifier replacement with no hard-risk trigger; final whole-diff review remains required.

**Files:**

- Modify: `examples/demo-note.md`

**Purpose:** Rename an example token without changing example behavior.

**Goal:** Every occurrence of the old token in the named file uses the new token.

**Non-goals:** Do not change surrounding prose, example behavior, or additional files.

**Scope mapping:** CURRENT Scope Delta row for the approved exact rename.

**Source-of-truth references:** Hypothetical approved rename issue § “Exact token replacement”.

**Authority surfaces:** Hypothetical approved rename issue § “Exact token replacement” owns rename authorization; `examples/demo-note.md` is the authorized mutation surface.

**NO-TRIGGER reason:** This exact token replacement is a single-file
mechanical example that changes no behavior, authority, generated output,
failure route, review rule, documentation navigation, or compatibility surface.

**Acceptance criteria:** `OldExampleToken` is absent from the file and `NewExampleToken` appears in the same locations.

**Risks:** Accidental replacement outside the approved file or context.

**Dependencies:** None.

**Verification expectations:** Confirm the approved before/after token replacement in the named file.

**Proof sufficiency:** Focused inspection of the named file proves the exact
replacement; no generalized harness or broader matrix is required.

**Replace:** `OldExampleToken`
**With:** `NewExampleToken`
