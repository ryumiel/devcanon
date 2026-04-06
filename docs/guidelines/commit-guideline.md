# Commit Guideline

## 1. Header Format

- Format: `type(scope): subject` or `type: subject`
- Subject: imperative mood, no trailing period, max 80 characters
- Scope: optional but recommended when it narrows the affected area

## 2. Allowed Types

| Type       | When to use                                          | Example header                                       |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `feat`     | New user-facing functionality                        | `feat(cli): add doctor command`                      |
| `fix`      | Bug fix                                              | `fix(render): escape newlines in TOML strings`       |
| `refactor` | Code restructuring without behavior change           | `refactor(install): extract plan computation`        |
| `perf`     | Performance improvement                              | `perf(render): cache skill hash across targets`      |
| `style`    | Formatting, whitespace, semicolons (no logic change) | `style: fix biome warnings`                          |
| `test`     | Adding or updating tests only                        | `test(sync): add integration tests for symlink mode` |
| `docs`     | Documentation only                                   | `docs: add code review guideline`                    |
| `build`    | Build system, dependencies, tooling                  | `build: upgrade vitest to v3`                        |
| `ops`      | CI, deployment, infrastructure                       | `ops(ci): add Windows test matrix`                   |
| `chore`    | Maintenance that doesn't fit above                   | `chore: update .gitignore`                           |

## 3. Recommended Scopes

- `cli` -- CLI entrypoint and command wiring
- `config` -- Config loading, schema, defaults
- `render` -- Claude and Codex renderers
- `install` -- Sync, plan, manifest, copy/symlink
- `validate` -- Skill, agent, config validation
- `diff` -- Diff logic
- `doctor` -- Environment health check
- `skills` -- Skill source files
- `agents` -- Agent role definitions
- `ci` -- CI workflows and automation

## 4. When to Include a Body

- **Required**: behavior changes, non-obvious intent, migration notes, breaking changes, multi-step rationale
- **Optional**: simple additions where the diff is self-explanatory
- **Format**: blank line after subject, wrap at 80 characters per line
- **Content**: explain _why_, not _what_ (the diff shows what)

Good body example:

```text
fix(install): preserve existing manifest on partial sync failure

Previously, a failed sync would truncate the manifest file before
writing, losing track of previously installed files. Now the manifest
is written atomically using a temp file and rename.

Closes #42
```

Bad body example:

```text
fix(install): preserve existing manifest on partial sync failure

Updated sync.ts to use a temp file. Changed writeManifest function
to write to a .tmp file first then rename it.
```

## 5. Footers

- Separate from body with one blank line
- Use for: `Closes #N`, `Related to #N`, `BREAKING CHANGE: description`
- `BREAKING CHANGE:` footer is required when the commit introduces incompatibility

## 6. Common Mistakes

| Mistake                          | Example                       | Fix                                              |
| -------------------------------- | ----------------------------- | ------------------------------------------------ |
| Past tense                       | `added new command`           | `add new command`                                |
| Trailing period                  | `fix bug in renderer.`        | `fix bug in renderer`                            |
| Too vague                        | `fix: update code`            | `fix(render): escape backslashes in TOML output` |
| File-by-file body                | `changed sync.ts and plan.ts` | Explain intent and behavior change               |
| Missing scope on targeted change | `fix: escape TOML strings`    | `fix(render): escape TOML strings`               |
