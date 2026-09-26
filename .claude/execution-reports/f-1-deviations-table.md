# Execution Report: Complete the deviations-from-reference table

Ticket: F-1

## What was built

- Added rows for every reference component we changed or dropped: agent tools (MCP), PRD, prime variants, end-to-end-feature, worktrees, init-project, ast-grep and reference docs, research/code-reviewer agents, settings.json, plus the new items (system review, rules builder, plan template, E2E, validation reporting, spec waves/overlap, chores/epic, commit, prime inputs, review stats, safety hooks, audit log).
- Fixed the stale `plan-feature` wording and the "sweep" attribution (the sweep is ours; the reference's loop is rule + regression test).
- `/sdlc:ticket` now pauses after planning, which the end-to-end-feature row relies on.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 221 passed
- Live, local DC stack (`npm run test:live`): ✓ 47 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local-only suites)
- Plugin manifest (`claude plugin validate plugins/sdlc`): ✓


## Divergences from the plan

None.
