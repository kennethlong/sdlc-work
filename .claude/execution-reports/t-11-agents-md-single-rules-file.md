# Execution Report: AGENTS.md as the single rules file

Ticket: T-11

## What was built

- `src/rules.ts` `ensureRulesFiles`: creates `AGENTS.md` (a short stub) when missing and a `CLAUDE.md` that imports it (`@AGENTS.md`); appends the import to an existing `CLAUDE.md`; when the rules already live in `CLAUDE.md` it only advises. Never overwrites. Called by `sdlc-atl init`.
- Skills (rca, fix, prime, review; report and review-fix already did) read and write rules in `AGENTS.md`; the setup skill explains the arrangement and the migration.
- Design doc: new row in "Deviations from the reference" (the reference uses `CLAUDE.md`).

## Validation Results

- Type check: ✓
- Unit tests (`npm test`): ✓ 103 passed (incl. `rules.test.ts`: fresh repo, existing CLAUDE.md, rules in CLAUDE.md, dry run)
- Bundle freshness: ✓

## Divergences from the plan

None.
