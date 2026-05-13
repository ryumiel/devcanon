# AFDS Mechanical Documentation Checks

- Scope: DevCanon AFDS documentation checks
- Status: Accepted

---

## Purpose

This specification identifies scoped mechanical AFDS documentation checks that
can be implemented after the document-profile taxonomy and workflow
expectations are stable. It intentionally does not implement validation
behavior.

The goal is to draw a durable boundary between:

- `devcanon validate`;
- deterministic repository-documentation checks;
- pre-commit orchestration;
- judgment-heavy AFDS audits and review workflows.

## Scope

This specification covers mechanically detectable documentation checks for
DevCanon repositories that have adopted the AFDS documentation standard.

This specification is documentation-only. It does not change runtime
validation, package scripts, pre-commit hooks, CI, or source validation code.

## Boundary Model

### `devcanon validate`

`devcanon validate` should remain focused on portable DevCanon source
artifacts:

- config files;
- skill source files;
- agent source files;
- placeholder contracts;
- generated-source contracts.

Repository-documentation governance should not be folded into
`src/validate/**` unless a later approved implementation issue explicitly
changes that boundary.

### Repository-Documentation Check Scripts

Deterministic repository-doc checks belong in scripts and package commands
where they can run against tracked Markdown, explicit file lists, or staged
files. This matches the existing pattern used by Markdown formatting and
linting scripts.

These scripts should enforce rules already owned by durable docs such as
`docs/guidelines/documentation-standard.md`; they should not create new policy.

### Pre-commit

Pre-commit should stay an orchestrator for cheap staged-file checks. It may
delegate to repository-doc check commands once those commands exist, but it
should not embed AFDS policy logic directly.

### Doc-Gardening and Review Workflows

Judgment-heavy AFDS audits belong in `doc-gardening` and review workflows.
Those workflows can use deterministic checks as evidence, but they remain the
right surface for boundary, duplication, profile-fit, and derivable-gap
findings that require human or agent judgment.

## Candidate Checks

### Broken Internal Links

Check inline relative Markdown links in tracked docs and report links whose
targets no longer exist. Anchor checking can be a follow-up once the basic
path resolver is stable.

Resolution must normalize each target against its source file, reject or ignore
targets that escape the repository root, and report escaped paths without
probing the filesystem outside the repository.

Ready now: yes.

Recommended surface: repository-doc check script, reusable by full checks,
staged checks, and doc-gardening.

### Stale `MAP.md` References

Check that every internal link in `MAP.md` resolves. This is a narrower version
of broken-link checking with higher priority because `MAP.md` is the canonical
navigation index.

Ready now: yes.

Recommended surface: repository-doc check script.

### Invalid or Ambiguous Documentation Filenames

Check documentation filenames against the explicit naming rules in
`docs/guidelines/documentation-standard.md`, including lowercase kebab-case for
docs under `docs/`, uppercase canonical root docs, ADR numbering, and the
standard's listed avoid patterns.

Ready now: yes, for rules already explicit in the standard.

Recommended surface: repository-doc check script.

### Live-State Markers in Durable Docs

Detect obvious live-state markers in durable docs, such as unchecked task
lists, active assignment/status phrases, issue-status ledgers, PR inventories,
or agent-run logs in files whose profiles must not own live work state.

Ready now: partial.

Only narrow marker checks should be implemented first. Broader classification
of live state requires review or doc-gardening because durable docs may
legitimately reference issues, PRs, or examples without becoming live-state
stores.

Recommended surface: start with doc-gardening or a warning-only script mode;
promote only unambiguous markers to blocking checks.

### Approved Profile-Shape Checks

Check whether durable docs that declare or imply an AFDS profile live in the
profile's owning location and avoid forbidden profile-owned content.

Ready now: no.

This needs follow-up implementation issues after the profile taxonomy,
document-shape expectations, and false-positive tolerance are accepted in
durable docs. Profile-shape checks should start as review or doc-gardening
evidence before they become blocking scripts.

### Skill Structure Checks

Keep skill-structure validation with the existing portable DevCanon source
artifact checks. Candidate checks include required `SKILL.md` presence,
frontmatter shape, supported sidecar structure, placeholder contracts, and
source-to-generated expectations.

Ready now: already partially covered by `devcanon validate`.

Recommended surface: `devcanon validate` for skill source artifacts only. Do
not use this category to pull general repository-doc checks into
`src/validate/**`.

## Readiness Classification

### Ready Now

These checks have clear deterministic inputs and an existing policy owner:

- broken inline relative links;
- `MAP.md` link resolution;
- explicit filename naming and avoid-pattern checks;
- existing skill structure checks under the current `validate` boundary.

### Ready With Narrow Implementation Design

These checks are promising but need careful false-positive control before
implementation:

- narrow live-state marker detection;
- anchor validation for Markdown headings;
- warning-only reporting for docs that appear to mix profile-owned content.

Each should have its own implementation issue with examples, severity rules,
and verification fixtures.

### Deferred Pending Follow-Up Issues

These checks should not be implemented from this specification alone:

- broad profile-shape enforcement;
- automated ownership classification across documentation profiles;
- blocking same-PR documentation-impact enforcement beyond explicitly mapped
  file-change triggers;
- automated detection of duplicated or conflicting durable truth.

These remain better suited to doc-gardening and review workflows until their
policy boundaries and false-positive handling are stable.

## Proposed Follow-Up Issues

1. Add a repository-doc link checker for tracked Markdown and `MAP.md`.
2. Add a filename-rule checker based only on the documented naming rules.
3. Prototype warning-only live-state marker detection for durable docs.
4. Extract deterministic doc-gardening phase-2 checks into reusable scripts.
5. Define acceptance criteria for profile-shape checks before implementation.

Each follow-up should stay scoped to one check family and include fixtures or
sample docs that prove both positive and negative cases.

## Non-Goals

- No runtime validation code changes in this issue.
- No changes under `src/validate/**` in this issue.
- No git hook, CI, or package-script behavior changes in this issue.
- No broad AFDS validation implementation in this issue.
- No judgment-heavy profile, ownership, or policy decisions embedded in
  mechanical scripts.
- No migration of `doc-gardening` audit behavior into `devcanon validate`.

## Verification Expectations

Any future implementation issue should define:

- the authoritative durable rule being enforced;
- the command surface that runs the check;
- whether the check is blocking, warning-only, or audit-only;
- fixture coverage for valid and invalid cases;
- staged-file behavior, if pre-commit delegates to the check;
- how doc-gardening or review workflows consume the check result.

For this documentation-only change, verification is limited to Markdown
formatting, Markdown linting, and `devcanon validate` as a source-artifact
sanity check.
