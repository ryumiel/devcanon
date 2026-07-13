# Capability Profiles v2 Migration

This guideline owns the manual operator procedure for migrating a DevCanon
library from source configuration version 1 to the strict version 2 capability
contract. It does not translate source automatically or authorize writes to
installed target homes.

The executable contract remains in [`src/config/schema.ts`](../../src/config/schema.ts),
[`src/config/load.ts`](../../src/config/load.ts), and the validators and
renderers that consume them. See
[ADR-0026](../adr/adr-0026-capability-profiles.md) for the decision and
[Configuration](../specs/configuration.md) for current behavior.

## Before changing source

1. Record the exact known v1 DevCanon CLI version or immutable revision that
   successfully validates and renders the current library. Do not rely on a
   moving global installation.
2. Back up the v1 source directories, `devcanon.config.yaml`, and the current
   install manifest. Preserve any installed managed output needed for rollback.
3. Using only that pinned v1 CLI, run strict validation and render a baseline
   in an isolated temporary checkout or directory.
4. Record the complete relative artifact inventory for both targets and retain
   the baseline outside ignored `generated/` paths that will be regenerated.
   Baseline evidence is temporary operator material, not repository authority.

## Make semantic choices explicitly

For every former tier use, choose model capability and target-native effort as
two independent decisions.

- Choose exactly `efficient`, `balanced`, or `frontier` when DevCanon should
  select a model. Omit capability when the target should choose its ambient
  model.
- Set `claude.effort` and `codex.model_reasoning_effort` explicitly only when
  the role requires that target-native constraint. Omit effort to inherit
  ambient target behavior.
- Preserve tools, sandbox mode, approval policy, context, authority, skills,
  orchestration, retries, and escalation policy independently. Do not infer
  any of them from a capability.
- Replace active skill tokens with `{{model:efficient}}`,
  `{{model:balanced}}`, or `{{model:frontier}}`. Replace agent model tokens
  with a top-level `capability` or a literal target model.

There is no automatic mapping from `fast`, `standard`, or `deep` to the new
fields. The operator must review the purpose of each use.

## Validate version 2 in isolation

1. Change the config to `version: 2` and define the required strict
   `capabilityProfiles` catalog. Remove `modelTiers` completely.
2. Migrate source agents and active skill placeholders. Do not add compatibility
   aliases, legacy profiles, or translation helpers.
3. Run the version 2 CLI's strict validation and render commands in an isolated
   checkout or directory whose target homes cannot be mutated.
4. Confirm the v2 render has the identical relative artifact inventory as the
   pinned v1 baseline for both targets.
5. Compare content deterministically. Prepare an explicit allowlist of each
   intentional semantic delta, such as a selected model, an independently
   chosen effort, or a migrated placeholder. Treat every unlisted difference
   in instructions, tools, skills, metadata, paths, or artifact shape as a
   blocker.
6. Parse target artifacts where possible and run the repository's tests. Local
   validation proves source and render consistency, not provider runtime
   availability.

The `generated/` tree is an ignored local preview/debug area. Regenerate it for
inspection, but never commit generated previews or treat them as the baseline
authority.

## Controlled sync

Only after the isolated inventory and allowlisted content comparison pass may
an operator authorize `devcanon sync`. Review the install plan or use a dry run
first. The migration procedure itself never performs a live sync and never
uses mutation shortcuts.

Verify each provider client and account separately. A model or effort rejected
at runtime blocks deployment; do not substitute an alias, family member, model,
or effort silently.

## Rollback

1. Stop using the version 2 CLI for the restored library.
2. Restore the backed-up v1 source directories, v1 config, and manifest or
   managed-output backup.
3. Use only the exact pinned v1 CLI to validate, render, inspect, and, if the
   operator authorizes it, restore installed managed outputs.
4. Compare restored artifacts with the preserved v1 baseline.

Do not use `--force` during rollback. Never run the v2 CLI against restored v1
input: version 2 intentionally rejects version 1 and provides no compatibility
or translation layer.
