# Testing Requirements

---

## Unit tests

- config parsing
- schema validation
- strict version 2 capability-profile shape and default catalog
- path resolution
- renderer mapping
- literal-model, capability-model, and ambient-omission precedence
- explicit target-native effort without capability inheritance
- manifest update logic

---

## Integration tests

- init
- validate
- render
- sync in copy mode
- sync in symlink mode where supported
- diff
- doctor

---

## Test Ownership and Proportionality

Every durable contract has one normative owner and one primary test layer. The
owner defines the accepted behavior; the primary layer proves it at the
closest stable boundary. Other layers may prove their own integration with
that contract, but must consume the same owner-derived data instead of
recreating its inventory, topology, or prose.

For skill documentation and executable mechanics, the primary allocation rule
is in
[Writing Skills](../guidelines/writing-skills.md#documentation-abstraction-ceiling).
This specification retains operational test authority and applies that
allocation when selecting the layer: allow direct observable behavior, stable
intentional public interfaces, executable syntax or wire tokens, and focused
helper/runtime behavior. Reject proof-for-proof narrative, ordering,
source-string, reviewer-ceremony, or fixture-only coverage without an
authoritative consumer failure, and prefer executing the owner. Installed
coverage is limited to concise composition—presence, parseability, packaging,
and canonical references—not a duplicate unit/runtime failure matrix.

When a Markdown table owns a contract, one test-only adapter parses and
validates that table once. Source-contract and render consumers reuse the
adapter's parsed rows. They must not maintain separate skill, agent, route, or
target registries. For agent routing, `docs/specs/agents.md` owns the six
semantic roles and observable target configuration, while
`docs/guidelines/agent-routing-and-mutation-policy.md` owns the D1-D17
direct-child route inventory. The tests consume those owners without copying
either table.

Render tests prove generated artifact behavior:

- artifact parseability, including Claude frontmatter, Codex TOML, and Codex
  skill sidecars
- target-specific field behavior and placeholder resolution
- generated packaging, mirrored skill files, metadata, hashes, and stale-output
  cleanup
- shipped skill and agent smoke coverage for both supported targets
- all three capability profiles rendered for both targets
- shipped implementer/reviewer capability plus explicit effort and research
  agent ambient-model/ambient-effort omission
- canonical skill model placeholders, former-token diagnostics, escapes, and
  fenced-code boundaries
- agent model-placeholder rejection in validation and direct render entrypoints

Render consumers preserve structural behavior for both supported targets:
parseability, packaging and sidecars, target-native frontmatter, semantic agent
identity, capability, effort, authority, and route evidence. Source-contract
consumers prove stable source-owned interfaces, such as required handoff
inputs, outputs, authority decisions, and helper references. Script-runtime
consumers execute source scripts against focused fixtures. Each layer stays at
its own boundary and does not turn broad skill prose, prompt wording, ADR
wording, or helper algorithms into a render or source-text contract.

Behavioral guarantees for public script commands belong in runtime and
public-wrapper integration tests. Source-contract and render tests may assert
only stable structure and short semantic markers needed for discoverability,
composition, required inputs, refusal semantics, or generated parity. They must
not pin complete prose sentences or editorial wording. When behavior could
regress while those markers remain present, add executable coverage at the
owning runtime or public wrapper instead of expanding prose assertions.

Each new regression test names the concrete failure, normative owner, primary
test layer, and the gap in existing coverage. Use the smallest owner-derived
assertion that would fail for that regression; improve the owner or choose a
narrower observable boundary rather than creating a prose-testing framework.

### Failure-Proof Ownership

Each invariant has one primary proof owner. Failure behavior must be tested at
the executable layer that owns it. Transparent callers and adapters must test
only their added behavior: input translation, delegation, output propagation,
cleanup they own, and consumer-specific state transitions. They must not repeat
the owner's fault-injection matrix.

Additional consumer-level failure tests are required only when the consumer can
violate the invariant independently or transforms the failure into different
observable behavior. Hypothetically replacing a correct owner call with an
incorrect implementation is not, by itself, evidence of a missing regression
test.

Do not introduce production injection seams, command shims, or filesystem
harnesses solely to simulate an underlying primitive failure already covered by
its owner.

Examples:

- Valid: a wrapper swallows a dependency's nonzero exit, so test exit
  propagation at the wrapper.
- Valid: an adapter computes a new destination path, so test that path binding.
- Invalid: repeat rename-failure tests in every command using a tested atomic
  writer.
- Invalid: require a `PATH`-injected fake `mv` merely because the implementation
  invokes `mv`.
- Invalid: argue "replacing this dependency call with a direct write would
  pass" when the consumer does not own atomicity.

For a breaking source-contract migration, compare deterministic v1 and v2
renders in isolation: require identical relative artifact inventory, parse
representative outputs, and enumerate an explicit allowlist of intentional
semantic deltas. Ignored `generated/` previews remain local evidence and are
not committed snapshot authority.

---

## Snapshot tests

- focused fixture-based renderer output when byte-for-byte formatting is the
  behavior under test
- generated metadata fragments when structured parsing is not enough
