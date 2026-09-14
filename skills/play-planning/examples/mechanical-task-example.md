# Mechanical task example

Worked example for the optional `**Mode:** mechanical` field described in `../SKILL.md` (the enclosing projection assigns `EP-RENAME-EXAMPLE-TOKEN` to this task):

```markdown
### Task N: Rename Example Token

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

**Source-of-truth references:** The approved issue requirement for this exact rename.

**Authority surfaces:** `examples/demo-note.md`

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
```
