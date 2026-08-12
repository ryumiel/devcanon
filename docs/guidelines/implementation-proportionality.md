# Implementation Proportionality

Implementation hardening is proportional to the guarantees and ordinary
failure classes explicitly named by the owning issue, specification, or
operating model. Keep the change at the smallest owner boundary that proves
the requirement.

Do not introduce a generalized hostile-writer, custody, proof, signal,
subprocess, TOCTOU/ABA, or exhaustive-race framework unless a separately
approved requirement names that framework and its guarantees. A hypothetical
failure outside an owning contract is not authority to expand an implementation
or its test surface.

For a fixed bundle-local documentation or helper path, do not add canonical-path
containment, symlink rejection, or file-kind policy merely because the file is
read. Add those guards only when caller-controlled input, a documented threat
model, or an explicit owning requirement establishes the relevant trust
boundary. Consumers such as public helper usage contracts reference this rule
instead of restating it.

## Test ownership boundary

Each executable contract is proved at its owning boundary:

- Protocol schemas, closed fields, and serialization belong to executable
  contract tests.
- State transitions and recovery behavior belong to runtime or script tests.
- Shared-source generated parity belongs to render and generated-artifact
  coverage.
- Narrow prose checks may protect machine-significant identifiers, required
  structural anchors, helper references, and explicitly prohibited aliases.

Explanatory prose and complete command sequences are not test oracles. Do not
copy workflow narration into source-contract tests when a runtime, helper, or
schema already owns the behavior. Prefer the smallest observable test at the
owning boundary.

See the [Testing Requirements](../specs/testing.md) and the [Documentation
Abstraction Ceiling](writing-skills.md#documentation-abstraction-ceiling) for
the operational allocation rules.
