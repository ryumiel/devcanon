# YAGNI Check Example

Worked example for the `## YAGNI Check for "Professional" Features` section of
[`../SKILL.md`](../SKILL.md).

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Let the classification and selected execution mode determine any work
```
