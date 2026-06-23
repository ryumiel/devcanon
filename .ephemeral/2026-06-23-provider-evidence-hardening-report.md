# Provider Evidence Hardening Report

## Scope

- Task: Task 4, Update Durable Contracts, Generated Outputs, And Parity
  Verification.
- Base SHA recorded before editing:
  `cbec3972796d5ed81b6d528b8edd704f82f6d7ff`.
- No GitHub push, PR comment, review post, approval, or thread resolution was
  performed.
- No install or sync to user home was performed.

## Command-Family Disposition

Provider-bound authority remains owned by the support validator runtime and is
delegated to by `pr-review` manifest/result/approved-review helper flows.

| Command family | Disposition |
| --- | --- |
| current/head resolution | Hardened provider-bound Git executor; replacement refs disabled and local interpretation preflight enforced before provider evidence is accepted. |
| commit/ref existence | Hardened provider-bound Git executor through provider evidence validation. |
| merge-base proof | `provider_pr_diff_base_sha` must equal the single merge base of provider `baseRefOid` and `headRefOid`; shaped-only stale diff bases reject. |
| range existence checks | Provider-bound range checks for `pr-review` scope and provider evidence ranges. |
| changed-file listing | Provider-bound changed-file metadata for `pr-review` scope consumers. |
| `--name-status` metadata | Runtime parser preserves path identity from NUL-oriented Git output. |
| `--numstat` metadata | Runtime parser preserves tabs/newlines in paths and rejects malformed records. |
| per-file patch hashing | Canonical provider-bound Git diff with literal pathspec handling. |
| full-diff digesting | Canonical provider-bound Git diff digesting with provider-unavailable patch exception preserved. |
| `validate-diff-anchors` | Provider-bound selected-range validation remains the input authority before hunk lookup. |
| `compare-approved-payload` | Approved-review freeze/validate delegates scope authority through the support validator before accepting payloads. |
| `validate-risk-signals` | Branch-review only; remains non-authoritative escalation context and rejects irrelevant scope-only flags such as `--base-ref` and `--emit-gate-result`. |

## Field Semantics

- `review_scope_base_ref`, `REVIEW_SCOPE_BASE_REF`, and pr-review helper
  `BASE_REF` remain immutable provider diff-base SHA surfaces.
- Those fields must equal the proven `provider_pr_diff_base_sha`.
- `baseRefOid` remains provider base metadata inside provider evidence and
  participates only in merge-base proof.

## Verification Evidence

- `pnpm exec biome check --write --linter-enabled=false ...`: passed for touched
  TypeScript files.
- `pnpm run format:markdown`: passed; touched source skill Markdown unchanged
  after formatting.
- `pnpm exec vitest run --project unit src/runtime/pr-review-manifests.test.ts`:
  passed, 17 tests.
- `pnpm exec vitest run --project integration-posix src/skill-scripts/pr-review-approved-review-artifacts-helper.integration.test.ts`:
  passed, 24 tests.
- `pnpm exec vitest run --project integration-windows-helper src/skill-scripts/pr-review-manifests-helper.integration.test.ts -t "rejects review scope base refs|rejects shaped provider diff-base"`:
  passed, 2 selected tests.
- Full `pr-review-manifests-helper.integration.test.ts` was run after runtime
  hardening. All behavioral assertions passed; several existing long-running
  tests needed scoped timeout allowances because provider-bound validation now
  performs heavier Git proof work.
- `pnpm run build:runtime`: passed and refreshed
  `skills/devcanon-runtime/scripts/runtime/`.
- `pnpm run check:runtime`: executed after runtime refresh and reported tracked
  runtime diffs, which is expected before committing this task's packaged
  runtime updates.
- `pnpm run dev -- render`: passed; rendered 8 agents and tracked 62 skills.
- `pnpm exec vitest run --project integration-render-install src/render/devcanon-runtime.integration.test.ts src/render/existing-skills.integration.test.ts`:
  passed, 11 tests.
- `pnpm exec vitest run --project unit src/skill-contracts/existing-skills-prose.test.ts`:
  passed, 52 tests.
- `pnpm run check`: passed; 83 test files passed, 1401 tests passed, 2 skipped.

## Notes

- Generated Claude/Codex output directories are ignored by repository default;
  only the task-scoped generated skill and runtime artifacts are intended for
  force-staging.
- No provider review history, PR comments, or GitHub closeout content was copied
  into durable docs.

## Fixup Verification Evidence

- Fixup base SHA recorded before editing:
  `2ee2c9457790d82059ab23bd7b62b08519efcd7a`.
- `pr-review` support validation now requires `--base-ref` for `pr-review` and
  rejects values other than the proven `provider_pr_diff_base_sha`, including a
  branch name such as `main` and provider `baseRefOid` when it differs from the
  provider diff-base.
- Durable `validate-risk-signals` prose remains branch-review-only and outside
  provider evidence / provider merge-base semantics.
- `pnpm exec vitest run --project unit src/runtime/review-artifacts.test.ts`:
  passed, 101 tests.
- `pnpm exec vitest run --project integration-posix src/skill-scripts/play-validate-review-artifacts.integration.test.ts -t "requires pr-review base-ref|accepts a valid initial full scope decision"`:
  passed, 2 selected tests.
- `pnpm exec vitest run --project integration-posix src/skill-scripts/pr-review-approved-review-artifacts-helper.integration.test.ts -t "BASE_REF values|explicit scope-policy inputs|provider diff-base"`:
  passed, 3 selected tests.
- `pnpm run build:runtime`: passed and refreshed packaged runtime JavaScript.
- `pnpm run dev -- render`: passed and refreshed generated Claude/Codex skill
  and runtime mirrors.
- `pnpm run check:runtime`: passed after staging the scoped runtime output.
- `pnpm exec vitest run --project integration-windows-helper src/skill-scripts/pr-review-manifests-helper.integration.test.ts`:
  passed, 27 tests.
- First `pnpm run check` attempt passed checks and all behavioral assertions but
  timed out one long-running manifest helper integration test at the default
  10s timeout. The test was given a scoped 20s timeout because provider
  authority validation now performs repeated Git proof work in that file.
- Final `pnpm run check`: passed; 83 test files passed, 1404 tests passed, 2
  skipped.
- No GitHub push, PR comment, review post, approval, thread resolution, install,
  or sync side effect was performed during the fixup.
