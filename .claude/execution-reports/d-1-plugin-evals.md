# Execution Report: Plugin evals in CI

Ticket: D-1

## What was built

- `evals/`: 6 cases (review ×2, rca, ticket ×2, spec) with inline fixtures (no Jira/git needed), deterministic graders plus LLM judges, no-plugin baseline arm.
- `.github/workflows/plugin-evals.yml`: on demand and on PRs touching skills/evals; needs an `ANTHROPIC_API_KEY` secret (not created).
- The first full run exposed a real review over-flag (fixed in the review skill) and an eval-sandbox limit (writes under `.claude/` are denied), handled in the graders.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 221 passed
- Live, local DC stack (`npm run test:live`): ✓ 47 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local-only suites)
- Plugin manifest (`claude plugin validate plugins/sdlc`): ✓
- Evals, with plugin vs without: empty-report-crash 1.00 vs 0.20; flags-sql-injection 1.00 vs 0.00; approves-clean-change 1.00 (2/2, after the review fix) vs 0.00; slices-prd 1.00 vs 0.40; escalates-epic-sized 1.00 vs 0.67; plans-small-story 0.88 vs 0.50: ✓

## Divergences from the plan

None.
