# Dependency Audit Guideline

## 1. Scope

This guideline applies to dependency, security, and package-manager audit
findings in DevCanon. It covers direct and transitive package findings,
`pnpm-lock.yaml` changes, dependency metadata updates, and review expectations
for audit remediation pull requests.

It does not add automated audit enforcement or change CI behavior.

## 2. Default Rule

Prefer dedicated audit-fix PRs. Do not mix audit remediation with unrelated
feature work, refactors, or documentation changes unless the dependency update
is required by that same change and the PR body explains the coupling.

Dedicated audit-fix PRs make lockfile-scope review possible and keep security
remediation from hiding unrelated behavior changes.

## 3. Triage

Before choosing a fix, identify:

- the advisory, package name, affected version range, and patched version;
- whether the affected package is direct or transitive;
- runtime vs dev-only exposure;
- the reverse dependency path that installs the affected package;
- the package-manager files expected to change (`package.json`,
  `pnpm-lock.yaml`, workspace settings, or overrides);
- whether the finding has a normal upgrade path, needs an override, or should
  be deferred with a tracked reason.

Runtime exposure generally carries higher risk than dev-only exposure. Dev-only
findings still need review when they affect scripts, generated artifacts,
release tooling, or any tool that handles untrusted input.

## 4. pnpm Investigation

Use `pnpm audit` to inspect findings and `pnpm why <package>` to explain why a
package is installed.

Useful command shapes:

```sh
pnpm audit
pnpm audit --prod
pnpm audit --dev
pnpm why <package>
```

Use `--prod` or `--dev` when runtime vs dev-only exposure matters. Include the
relevant `pnpm why` result in the PR description or reviewer notes when the
finding is transitive or when the dependency path is not obvious from the diff.

## 5. Remediation

Prefer normal upgrades first:

- upgrade the direct dependency that owns the vulnerable package path;
- refresh the lockfile only as far as the remediation requires;
- keep package metadata changes scoped to the audit finding.

Use transitive overrides only when a normal upgrade is unavailable or would
expand the PR beyond the audit fix. Every override needs explicit
justification:

- why the override is necessary;
- which transitive path it affects;
- what owner or upstream release would let the override be removed;
- what follow-up condition will trigger removal.

Do not leave broad overrides without a removal condition. They hide dependency
state from future maintainers and can mask upstream compatibility issues.

## 6. PR Review Checklist

- [ ] The PR is dedicated to audit remediation, or the PR explains why the
      dependency update is coupled to another change.
- [ ] Runtime vs dev-only exposure is identified.
- [ ] `pnpm why <package>` evidence is provided for transitive findings or
      non-obvious dependency paths.
- [ ] Normal upgrade paths were considered before any override.
- [ ] Every transitive override has explicit justification and a removal
      condition.
- [ ] The lockfile diff is limited to the remediation scope.
- [ ] Validation commands that cover the affected files were run.

## 7. See Also

- [AI-Assisted Product Workflow Guideline](ai-assisted-product-workflow-guideline.md)
  - classifies dependency, security, and audit findings as execution-path work.
- [Project Management Model](project-management-model.md) - defines repository
  docs, issues, PRs, and agent sessions as separate systems of record.
- [PR Guideline](pr-guideline.md) - PR description, issue linkage, and review
  expectations.
- [Documentation Checklists](documentation-checklists.md) - fast review and
  gardening checks.
