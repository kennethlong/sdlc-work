# Execution Report: /sdlc:commit, wider prime, review quality category

Ticket: F-7

## What was built

- `skills/commit/SKILL.md`: `type(KEY): summary` with a validated key, named staging after a secret check, "AI Layer Changes" in the body, never skips hooks.
- `sdlc-atl review-scope` now returns a validated key (configured projects, else Jira).
- prime: several keys, spec tickets, Confluence page ids/URLs (pulled to `.sdlc/context/`).
- review: `quality` category, `stats`, category counts in the PR and Jira comments; guidance that out-of-scope hypotheticals are at most low (found by the eval below).

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 221 passed
- Live, local DC stack (`npm run test:live`): ✓ 47 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local-only suites)
- Plugin manifest (`claude plugin validate plugins/sdlc`): ✓
- Evals, with plugin vs without: empty-report-crash 1.00 vs 0.20; flags-sql-injection 1.00 vs 0.00; approves-clean-change 1.00 (2/2, after the review fix) vs 0.00; slices-prd 1.00 vs 0.40; escalates-epic-sized 1.00 vs 0.67; plans-small-story 0.88 vs 0.50: ✓

## Divergences from the plan

None.
