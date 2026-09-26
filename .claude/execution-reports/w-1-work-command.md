# Execution Report: sdlc-atl work KEY: one headless run

Ticket: W-1

## What was built

- `packages/atlassian/src/headless.ts` + `sdlc-atl work KEY [--agent copilot|claude|codex] [--force]`: claim (assign, In Progress, `ai-ready` → `ai-running`, comment with the build link), branch `feature/KEY-slug`, brief, agent run, gate, push, draft PR, review, verification page, review status (never Done), `ai-done`; failures comment the reason and label `ai-failed`.
- piv: the runner drives plan → execute → report as three narrow agent calls and checks the evidence after each (plan file, new commits, report verdict); gsd: one call.
- Jira client: `editLabels` (atomic add/remove), `assign` (DC name / Cloud accountId); `sync` gained `only` (one ticket).

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 236 passed
- Live, local DC stack (`npm run test:live`): ✓ 49 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 11 skipped (Bitbucket-only suites)
- End to end on the local stack with the real Copilot CLI in Jenkins: SDLC-12 (vague) asked questions, Alice answered, then a draft PR #4 with a passing verification; SDLC-11 (clear) ended in draft PR #5 via plan → execute → report (all six skills used): ✓

## Divergences from the plan

A single "follow the whole process" prompt was not enough: Copilot CLI, headless, skipped planning and the report twice even with explicit instructions. The runner now drives the phases itself.
