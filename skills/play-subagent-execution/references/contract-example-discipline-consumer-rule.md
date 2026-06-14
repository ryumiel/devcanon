# Contract Example Discipline Consumer Rule

This reference is the shared consumer-side rule for present Contract Example
Discipline obligations in `play-subagent-execution`. Consumers enforce only
obligations that are present in the extracted plan/task execution context; they
do not infer whether Contract Example Discipline should have been required.
`play-planning` owns that trigger taxonomy.

When extracted plan/task execution context includes Contract Example Discipline
or an equivalent clearly labeled section/obligation, verify the source-backed
example consistency obligations:

- positive examples match the target post-change contract, not the pre-change
  contract.
- invalid examples mutate exactly one named contract dimension unless
  multi-fault behavior is intentional and named.
- derived fields stay consistent with source facts or are explicitly justified.
- when extracted context requires proof that valid examples pass, verify that
  source-owned tests, fixtures, docs, generated output, or review evidence
  exercise the valid example family against the target post-change contract.
- when extracted context requires proof that invalid examples fail, verify that
  each named invalid family is rejected for the intended contract dimension.
- Expected mismatches between current pre-change source and target post-change
  examples are implementation work when the task intentionally changes that
  source contract.
- unsupported, internally inconsistent, or unverifiable examples or source
  facts remain contract gaps and require `NEEDS_CONTEXT` or `BLOCKED` instead
  of guessing.
