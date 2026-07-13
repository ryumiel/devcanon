# Error Handling and Logging

---

## User Errors

Examples:

- invalid config
- unsupported source config version
- removed version 2 `modelTiers` field
- missing, extra, or malformed `capabilityProfiles`
- unsupported or malformed active skill model capability
- model placeholder in an agent target model field
- missing `SKILL.md`
- duplicate agent names
- missing referenced skill
- invalid install mode

Behavior:

- print human-readable error
- return non-zero exit code
- preserve the most specific source path available; invalid active skill model
  tokens identify `skills/<name>/SKILL.md`
- version 1 config and version 2 `modelTiers` use dedicated migration guidance
  before ordinary strict or non-strict schema handling
- model-capability errors name the accepted `efficient`, `balanced`, and
  `frontier` vocabulary and direct authors to `capabilityProfiles`, top-level
  agent capability, or a literal target model as appropriate

---

## Environment Errors

Examples:

- missing permission
- invalid home path
- symlink creation failure
- broken target directory

Behavior:

- print actionable guidance
- include fallback hint where possible

---

## Strict Mode

In strict mode:

- warnings for unknown fields become errors

Strict mode does not create a compatibility path. Removed config versions and
fields, invalid capability profiles, active former skill tokens, and agent
model placeholders fail in both normal and strict validation.

---

## Logging and Output

### Default mode

Human-readable CLI output.

### Optional machine-readable mode

Support `--json` for structured output.

### Log levels

- `quiet`
- `normal`
- `verbose`
- `debug`
