# Execution Report: Ticket briefs name the real /sdlc:* skills

Ticket: S-2

## What was built

- piv and gsd `nextSteps` now name `/sdlc:prime`, `/sdlc:plan`, `/sdlc:execute`, `/sdlc:validate`, `/sdlc:report`, `/sdlc:rca`, `/sdlc:fix`, `/sdlc:sync`.
- Briefs carry one legend line: skills are `/sdlc:<name>` in Claude Code and `sdlc-<name>` in Copilot, Codex and other agents.
- Test: every `/sdlc:<name>` a brief mentions exists in `plugins/sdlc/skills`, and none of the reference's un-namespaced commands appear.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 99 passed
- Live, local DC stack (`npm run test:live`): ✓ all passed
- Live, Jira/Confluence Cloud (`SDLC_LIVE_ALLOW_REMOTE=1`): ✓ 42 passed, 9 skipped (local-only)
- Bundle freshness: ✓

## Divergences from the plan

Bug fixes now route through `/sdlc:fix` for both engines (it drives a GSD quick task on gsd) instead of a bare `/gsd-quick` step.
