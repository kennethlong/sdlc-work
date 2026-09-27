# Execution Report: In-repo Jenkinsfile, running without Jenkins, acceptance-criteria guard

Ticket: W-7

## What was built

- `templates/ci/jenkins/Jenkinsfile.sdlc-work-inrepo`: uses Jenkins' own checkout (reset and cleaned each run, runner logs kept), the timer and stage only on the main branch (`SDLC_WORK_BRANCH`), feature branches no-ops, agent from the repo config unless chosen, same credential ids as the standalone job.
- Local stack: multibranch job `sdlc-work-inrepo` (configuration as code) and a clone credential; `dc.ps1` reloads Jenkins once after start (a multibranch job generated at startup is otherwise not listed); `demo-headless.ts --in-repo`.
- `sdlc-atl work --poll --every N` (`watchAndWork`): rereads config each round, retries after a failing round, Ctrl-C stops after the current story. Fixed a bug found by its test: `onResults?.(await pollAndWork(...))` skipped the poll when no callback was given.
- Runner: a story without acceptance criteria is asked for them before any agent run, until a human answers the bot's question (`work.requireAcceptanceCriteria`, default on). Found in the multibranch run: the agent invented criteria for a vague story and rebuilt another story's change.
- Docs: `docs/headless.md` (both Jenkins variants, running without Jenkins, the criteria rule), infra README.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 243 passed (watch loop; no-criteria ask without an agent call; unrelated comment vs answer)
- Live, local DC stack: ✓ 51 passed, 4 skipped
- Multibranch Jenkins, real Copilot: ✓ main build worked two stories into draft PRs #5 and #6; both feature branches built with the work stage skipped

## Divergences from the plan

The acceptance-criteria guard was added after the multibranch run showed the model's judgement on vague stories varies.
