# TODO

From the crew review ([docs/research/04-crew-review.md](docs/research/04-crew-review.md), 2026-09-25). IDs match the
review, which has the evidence (file:line) and effort for each item. Work top to bottom; tick items off as they land.

## 1. Safety and correctness (do first)

- [ ] **S1** `npm test` runs unit tests only; live suites need `SDLC_LIVE=1` and refuse non-local URLs unless `SDLC_LIVE_ALLOW_REMOTE=1` (B1)
- [ ] **S2** Ticket briefs name real skills (`/sdlc:prime`, `/sdlc:plan`, `/sdlc:fix`, `/sdlc:report`, `/sdlc:rca`), with a test (B2)
- [ ] **S3** State file: take the lock in every command that writes it; atomic lock (`wx` flag + PID alive check); write to a temp file then rename, re-reading and merging first (B3, B4)
- [ ] **S4** HTTP: request timeout; retry POST only on 429; clear messages for expired tokens (401/403) (B4, B5)
- [ ] **S5** Markup: escape Jira special characters; fix the strikethrough regex; negative tests (B6)
- [ ] **S6** Review `head`/`base` read as strings (B7); validate Jira keys against the project keys, add `--branch`/`--pr`, record existing PRs (B8); hook path with `resolve()` (B9)
- [ ] **S7** Sync: catch errors per item and continue; configurable statuses never moved backwards (B11); reach Done by status category; multi-hop transitions; set Resolution on Done
- [ ] **F1** Complete the deviations table (≈13 missing rows); fix stale names (`plan-feature`, the "sweep" attribution)
- [ ] **B12** Doc drift: README path `C:Codesdlc-work`, the stale CLI list, `import-story`/`implement-fix` names, "12 skills"

## 2. Team readiness

- [ ] **T1** State model: commit only stable item→issue mappings, one file per epic (`.sdlc/state/<EPIC>.json`); keep `prs`/`tickets`/page ids/logs per developer (gitignored); rebuild what's missing from labels and page ids
- [ ] **T2** Several epics or milestones per repo (`--epic`/`--milestone`/`--spec` selectors)
- [ ] **T3** Re-plan safety: store each item's title/slug, warn on drift, handle orphaned stories (close or label), optional `--update` of summaries/acceptance criteria
- [ ] **T4** Done on merge without a developer's machine: CI/post-merge `sync`; `doneWhen` matches every key found in the PR (multi-story PRs)
- [ ] **T5** Fix and live-test the CI templates (head-ref checkout, `--branch/--pr`, Write permission); GitHub Actions on the test repo *(needs an `ANTHROPIC_API_KEY` repo secret from you)* (B10)
- [ ] **T6** `sdlc-atl doctor`: credentials (expiry hints), git host, gsd-tools, hook path, Bug/Epic types, workflow reachability, last sync error
- [ ] **T7** `sdlc-atl start KEY`: import → assign to me → In Progress → `feature/KEY-slug` branch → next steps; branch creation at the start of `ticket`/`fix`/the `spec` hand-off
- [ ] **T8** Config discoverability: `init` flags for every key, a JSON schema, setup documents `transitions`/`doneWhen`/`issueType`/`git.base`/`spec`
- [ ] **T9** Cross-agent install: Node-based `install.mjs` for all operating systems; rewrite `$1`/`$ARGUMENTS` for non-Claude agents; document `uv`; the hook always uses a stable CLI path

## 3. Restore reference strengths

- [ ] **F2** `/sdlc:system-review` + a `system-reviewer` agent (divergence classification, root cause, /10 alignment score, proposed rule/skill text; reads piv reports + GSD SUMMARY deviations)
- [ ] **F3** `/sdlc:create-rules` (descending-generality AGENTS.md/CLAUDE.md, rules cited to `file:line`, `.claude/context/` table, Gotchas); rca/fix/review-fix point to it
- [ ] **F4** Restore plan depth for piv (strategic-thinking checklist, New Files, Patterns with code, 6 validation levels incl. manual + E2E, the "No Prior Knowledge" test)
- [ ] **F5** E2E level (Playwright MCP / agent-browser, Windows note; `gsd-dom-verifier` for gsd)
- [ ] **F6** Spec fidelity (500–700-line / 20–60-minute sizing, dependency graph + waves, file-overlap check, local PRD paths, optional epic, Task for chores)
- [ ] **F7** `/sdlc:commit` (key-tagged, "AI Layer Changes" summary); widen `prime` (several keys, Confluence pages); `quality` category + stats in review
- [ ] **F8** Baseline safety hooks for piv (secret/destructive guard, JSONL audit log)
- [ ] **D1** Plugin evals (`claude plugin eval`, with vs without the skills) in CI

## 4. Pilot

- [ ] Pilot on a real repo (SWG-Toolkit on the Cloud site, or a work repo): one story through import → plan → execute → review → PR, one bug through RCA → fix. Let the results reorder section 5.

## 5. Differentiators (after the pilot)

- [ ] **D2** One review rules file (REVIEW.md) shared by our review, Claude Code Review, Rovo Dev, CodeRabbit
- [ ] **D3** Verified findings with confidence + suggested fix
- [ ] **D4** AI attribution: commit trailers (key, agent, model) + Agent Trace, rolled up into the PR and Jira
- [ ] **D5** `sdlc-atl metrics` (cycle time, review rounds, rework, escaped defects, token cost) → Confluence / DX
- [ ] **D6** Headless "work this ticket" for Data Center: Jira Automation webhook → CI `claude -p` → progress to Jira → draft PR on Bitbucket DC
- [ ] **D7** Tests from acceptance criteria (EARS / Given-When-Then → property and acceptance tests; acceptance criterion → test → verification table)
- [ ] **D8** Enforce the learning loop in CI (the RCA's regression test fails before the fix and passes after; solutions index)
- [ ] **D9** CI self-heal on Jenkins / Bitbucket DC with a bounded number of retries
- [ ] **D10** Incident intake (`import --from sentry|jsm`) → Bug with an RCA draft
- [ ] **D11** `sdlc-atl release VERSION`: evidence-gated readiness + release notes page
- [ ] **D12** Drift check between PRD/story/code and the plan; offer to re-plan
- [ ] **Strategic** Cloud "delegate mode" ahead of the 2029 DC cutoff; consider shipping as a Spec Kit extension and publishing the skills to Tessl

## Housekeeping

- [ ] Add the `origin` remote and tag `v0.1.0`
- [ ] Rename or split `@sdlc/atlassian` (it now holds engines, git hosts, review/PR, the CLI)
- [ ] CI for this repo: typecheck + unit tests + bundle freshness check
- [ ] Delete `kennethlong/sdlc-work-pr-test` when it's no longer needed (needs the `delete_repo` scope, or delete it on GitHub)
