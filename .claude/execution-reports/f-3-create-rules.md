# Execution Report: /sdlc:create-rules

Ticket: F-3

## What was built

- `skills/create-rules/SKILL.md` + `template.md`: derives AGENTS.md (descending generality, rules cited to file:line, context table for `.claude/context/`, Gotchas); replaces the `init` stub; never drops rules without showing them; CLAUDE.md keeps only `@AGENTS.md`.
- rca, fix and review-fix say where new rules go; `init` points to the skill.
- The wizard now installs whole skill folders (templates included) for Copilot/Codex.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 221 passed
- Live, local DC stack (`npm run test:live`): ✓ 47 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local-only suites)
- Plugin manifest (`claude plugin validate plugins/sdlc`): ✓


## Divergences from the plan

None.
