# Execution Report: Review/PR robustness: string SHAs, validated keys, --branch/--pr, hook path

Ticket: S-6

## What was built

- Review front matter keeps numeric-looking SHAs (`1234567`, `12e4567`) as text.
- Jira keys: `keysIn` lists candidates; `resolveKey` takes an explicit key, else the first candidate in a configured project (`jira.projects`), else the first that exists in Jira. `fix utf-8` / `gsd/phase-03` no longer become keys.
- `pr` and `publish-review` accept `--branch` (detached CI checkouts); `publish-review --pr ID`.
- The PR is recorded in state right after it is created (before the Jira steps, whose failures become warnings); existing PRs are recorded too.
- The hook path is `resolve`d, so an absolute `core.hooksPath` works (test fails without the fix).

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 99 passed
- Live, local DC stack (`npm run test:live`): ✓ all passed
- Live, Jira/Confluence Cloud (`SDLC_LIVE_ALLOW_REMOTE=1`): ✓ 42 passed, 9 skipped (local-only)
- Bundle freshness: ✓

## Divergences from the plan

None.
