---
name: issue-worktree-setup
description: Provisions an isolated worktree for issue work as the single source of truth for worktree-setup policy across consumer skills. Use when a workflow needs an issue worktree from either the primary checkout or a managed worktree.
---

# Issue Worktree Setup

The [setup-worktree usage](references/setup-worktree-usage.md) owns the public
Node fallback's invocation, environment, cwd, output, and refusal mechanics.

## Prefer Native Worktree Tooling

Use host-native worktree control before the fallback. If it provisions or adopts
the checkout, continue from that worktree and do not run the fallback as well.
When fallback discovery is needed, run its exact local `setup-worktree.mjs
--help` command from the installed bundle before action. On Windows, use native
host tooling or the Node fallback from native shell tooling; never use the POSIX
adapter through Bash/WSL for Windows Git metadata.

## Setup Policy

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
