# Execution Report: Claim check for overlapping jobs

Ticket: W-6

## What was built

- `claimStory` in `packages/atlassian/src/headless.ts`: re-reads the story (poll results may be minutes old), backs off when a live claim or an unclaimed `ai-running` label exists, writes a claim to the issue property `sdlc.work.claim` (run id, time, build link), waits `work.claimSettleSeconds` (default 5), re-reads, and proceeds only if its own claim survived. Losers return `busy` without comments or label changes.
- `workTicket` claims before anything visible happens and releases the claim in a `finally`; `busy` results don't count towards `maxPerRun`.
- Stale claims (time limit + 15 minutes) are taken over; the default poll query also selects `ai-running` stories untouched for that long.
- Jira client: `getIssueProperty`, `setIssueProperty`, `deleteIssueProperty` (same API on Data Center and Cloud).
- `docs/headless.md`: "Several jobs, one Jira".

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 240 passed (two runners racing for one story in separate clones: exactly one works it, three runs in a row; live vs stale claims; staleness; poll query)
- Live, local Jira + Bitbucket DC: ✓ 51 passed, 4 skipped (real two-runner race: one winner; claim released after a run; default query valid)
- Jira Cloud (throwaway issue): ✓ one race winner, claim released, default query valid

## Divergences from the plan

None.
