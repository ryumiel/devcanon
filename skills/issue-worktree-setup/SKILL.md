---
name: issue-worktree-setup
description: Provisions an isolated worktree for issue work as the single source of truth for worktree-setup policy across consumer skills. Use when a workflow needs an issue worktree from either the primary checkout or a managed worktree.
---

# Issue Worktree Setup

The [setup-worktree usage](references/setup-worktree-usage.md) owns the public
Node fallback's invocation, environment, cwd, output, and refusal mechanics.

## Prefer Native Worktree Tooling

Use host-native worktree control before the fallback. Only an explicit
router/host adoption candidate is a candidate for adoption; ambient invocation
cwd is not one and must not trigger refusal. A candidate is not permission to
repurpose it. If native tooling validates and adopts or provisions the checkout,
continue from that worktree and do not run the fallback as well.
When fallback discovery is needed, resolve the installed bundle's
`issue-worktree-setup` skill directory as `ISSUE_WORKTREE_SETUP_DIR`, then run
its help action before setup:

```sh
node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs" --help
```

On Windows, use native host tooling or the Node fallback from native shell
tooling; never use the POSIX adapter through Bash/WSL for Windows Git metadata.

## Setup Policy

### Checkout adoption

Before any issue-body or comment-evidence write, validate an explicitly supplied
router/host adoption candidate as a nonempty absolute accessible directory, a
Git worktree root, and the repository identity expected for the issue. Expected
repository identity comes from the entrypoint's controller binding, never from
the candidate checkout. Retain branch and worktree evidence that distinguishes
assigned issue work from a clean unassigned checkout. A suitable existing issue
checkout is reused intact, including user changes. A clean unassigned managed
checkout may use the existing safe in-place-branching policy.

An unrelated, mismatched, or ambiguous explicit candidate stops before writes,
branch repurposing, or fallback creation. Never reset or discard dirty work to
make it fit. With no explicit candidate, including ordinary direct invocation
from a primary checkout, use the existing native-first provisioning and fallback
refusal rules. Native adoption success forbids a fallback helper or second
nested worktree.

### Batch repository binding

For paired batch context, the controller-proven expected repository binds every
selected checkout. An explicit adoption candidate continues to validate its own
root and repository against that binding before adoption; an unrelated ambient
invocation does not reject that valid candidate. With no explicit adoption
candidate, independently validate the invocation repository against the binding
before native create or reuse effects and before fallback helper provisioning. A
missing candidate does not make the ambient checkout the expected repository.
Use supported Git/provider evidence and canonical repository identities, so
equivalent repository aliases compare equal without relying on raw URL or path
spelling. Missing, ambiguous, or mismatched identity stops before provisioning
effects, branch changes, fallback, or artifact writes; do not switch, reset,
delete, or select an alternative checkout automatically.

After native or fallback selection, validate the selected `WORKTREE_PATH`
against the same binding before any issue-body or comment-evidence write. This
result check applies to native adoption, native provisioning, and fallback
`reuse` or `new`; a mismatched result stops before writes. Direct non-batch
invocation keeps the existing primary-checkout provisioning path.

The fallback is the provider-independent policy owner for detecting primary
versus managed checkouts, safe in-place branching, refusing unsafe nested
worktrees, creating a fresh `.worktrees/...` checkout, and returning a concrete
path. Resolve its bundle separately from the repository being primed.

Consume its documented result as `reuse`, `new`, or `stop`. `reuse` may branch
in a clean managed worktree with no work to preserve; `new` provisions from the
primary checkout; `stop` requires surfacing the helper message and ending the
current setup path. Never create another worktree from a stopped managed
session. The caller continues from the returned worktree only after the helper's
documented success contract.
