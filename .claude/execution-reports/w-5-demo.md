# Execution Report: End-to-end demo

Ticket: W-5

## What was built

- `scripts/demo-headless.ts`: commits the sandbox config, creates a clear and a vague `ai-ready` story, triggers Jenkins and prints the outcome.
- Result: both stories ended as draft PRs with Jira progress comments and Confluence verification pages; the vague one first asked questions.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 236 passed
- Live, local DC stack (`npm run test:live`): ✓ 49 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 11 skipped (Bitbucket-only suites)
- End to end on the local stack with the real Copilot CLI in Jenkins: SDLC-12 (vague) asked questions, Alice answered, then a draft PR #4 with a passing verification; SDLC-11 (clear) ended in draft PR #5 via plan → execute → report (all six skills used): ✓

## Divergences from the plan

Three rounds were needed: the first two exposed the prompt-only approach and a stale CLI in the job, both fixed.
