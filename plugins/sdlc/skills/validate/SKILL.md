---
name: validate
description: Run the project's full quality gate - the same lint, type-check, tests and build that CI runs, plus the plan's manual and browser E2E levels for user-facing changes - and report pass/fail per check. PIV loop step 4. Use before reporting work as done or opening a PR.
argument-hint: "[plan path]"
---

# Validate: green locally means green in CI, and it works for the user

1. **Find the real commands**: the plan's **Validation** section (`$ARGUMENTS`, or the newest file in
   `.claude/plans/` for this ticket), then the CI workflow files (`.github/workflows/`, `azure-pipelines.yml`,
   `Jenkinsfile`…), then `package.json` scripts, `pyproject.toml`, `Makefile`, the README. Mirror CI; don't guess.
2. **Run the levels in order**, stopping to fix a failure before moving on:
   1. syntax and style (lint, format check)
   2. types
   3. unit tests
   4. integration tests
   5. **manual**: run the plan's manual steps you can do yourself (e.g. call the changed endpoint with `curl`
      and compare the response); list the ones that need a human
   6. **E2E in a browser**: when the plan lists E2E flows or the change is user-facing, run `/sdlc:e2e` with the
      ticket key; otherwise record it as not applicable, with the reason

   Plus the build, when the project has one.
3. **Report** each check you ran as ✓ or ✗ with the key detail (counts, first error), then the overall result:

```
- Lint: ✓
- Type check: ✓
- Unit tests: ✗ 41 passed, 2 failed (export.test.ts: empty report)
- Integration tests: ✓ 6 passed
- Manual: ✓ GET /reports/42/export.csv returns 200 and 3 rows
- E2E (browser): ✓ 2 flows; console errors: none
- Build: ✓
Not run: manual check of the email template in Outlook (needs a human); E2E not applicable (API-only change)
Overall: FAIL
```

Write ✓/✗ **only** for checks that actually ran: `sdlc-atl sync` counts every ✓/✗ line in the report's
Validation Results, so a symbol on a skipped check would misreport the ticket. Put skipped or not-applicable
checks on a "Not run:" line without a symbol.

On failure: fix the cause and re-run. Don't weaken tests or add ignores to get green. If a failure is
pre-existing and unrelated, show that it also fails on the base branch, and say so explicitly.

These ✓/✗ lines feed `/sdlc:report`, whose verdict moves the Jira issue.

**gsd engine:** GSD's own verification (and its `gsd-dom-verifier`, when the live-DOM UAT capability is on)
covers these levels for GSD phases; use this skill for quick tasks and to re-check before a PR.
