# Wrapper Helper Contracts - `play-review`

The [review-artifacts usage](review-artifacts-usage.md),
[shared-review-context usage](shared-review-context-usage.md), and
[source-immutability usage](source-immutability-usage.md) own reusable helper
mechanics. Resolve helpers from the installed bundle; wrappers must not
reimplement rendered-surface or GitHub-payload mechanics.

Wrappers bind review evidence to the immutable review head before edits,
fixups, or posting. Rendered preview and GitHub payload operations consume the
same validated findings evidence. A wrapper never posts or freezes output based
on mutable working-tree source, invalid evidence, or a helper failure.
