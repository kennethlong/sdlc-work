---
name: validate
description: Run the project's full quality gate - the same lint, type-check, tests and build that CI runs - and report pass/fail per check. PIV loop step 4. Use before reporting work as done or opening a PR.
---

# Validate: green locally means green in CI

1. **Find the real commands**: the CI workflow files (`.github/workflows/`, `azure-pipelines.yml`,
   `Jenkinsfile`…) first, then `package.json` scripts, `pyproject.toml`, `Makefile`, the README. Mirror CI;
   don't guess.
2. **Run each check**, typically lint → type-check → unit tests → integration tests → build, plus a live smoke
   test (start the app, hit a health endpoint or the changed flow) when the change is user-facing.
3. **Report** each check as ✓ or ✗ with the key detail (counts, first error):

```
- Lint: ✓
- Type check: ✓
- Unit tests: ✗ 41 passed, 2 failed (export.test.ts: empty report)
- Build: ✓
Overall: FAIL
```

On failure: fix the cause and re-run. Don't weaken tests or add ignores to get green. If a failure is
pre-existing and unrelated, show that it also fails on the base branch, and say so explicitly.

These ✓/✗ lines feed `/sdlc:report`, whose verdict moves the Jira issue.
