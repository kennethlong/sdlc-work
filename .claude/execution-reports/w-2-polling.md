# Execution Report: Polling, eligibility and a kill switch

Ticket: W-2

## What was built

- `sdlc-atl work --poll`: default JQL (configured projects, `ai-ready` or answered `ai-needs-info`, not running, not Done), `work.jql` to override, `maxPerRun`.
- Eligibility: `issueTypes`, `maxPoints` (Story Points / Story point estimate), `components`; ineligible stories get a comment and `ai-skipped`.
- Kill switch: `work.enabled: false` or `SDLC_WORK=off`.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 236 passed
- Live, local DC stack (`npm run test:live`): ✓ 49 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 11 skipped (Bitbucket-only suites)

## Divergences from the plan

None.
