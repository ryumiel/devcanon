# Error Handling and Logging

---

## User Errors

Examples:

- invalid config
- missing `SKILL.md`
- duplicate agent names
- missing referenced skill
- invalid install mode

Behavior:

- print human-readable error
- return non-zero exit code

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
