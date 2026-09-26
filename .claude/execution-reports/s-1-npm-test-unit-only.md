# Execution Report: npm test runs unit tests only; live suites opt-in and local-only

Ticket: S-1

## What was built

- `npm test` runs the unit project only; `npm run test:live` goes through `scripts/test-live.mjs`, which sets `SDLC_LIVE=1` portably (Windows included).
- `packages/atlassian/test/live-guard.ts` (vitest globalSetup for the live project) refuses to run without `SDLC_LIVE=1`, and refuses non-local Jira/Confluence/Bitbucket URLs unless `SDLC_LIVE_ALLOW_REMOTE=1`. Verified: plain `vitest --project live` fails; the Cloud env without the flag fails with the URLs named.
- Tests: `live-guard.test.ts` (local, remote, lookalike host).

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 99 passed
- Live, local DC stack (`npm run test:live`): ✓ all passed
- Live, Jira/Confluence Cloud (`SDLC_LIVE_ALLOW_REMOTE=1`): ✓ 42 passed, 9 skipped (local-only)
- Bundle freshness: ✓

## Divergences from the plan

None.
