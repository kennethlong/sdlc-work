# TODO

From the crew review ([docs/research/04-crew-review.md](docs/research/04-crew-review.md), 2026-09-25). IDs match the
review, which has the evidence (file:line) and effort for each item. Work top to bottom; tick items off as they land.

**Tracked in Jira:** epic [SCRUM-146](https://kennyalanlong.atlassian.net/browse/SCRUM-146) (filed by `sdlc-atl file-breakdown` from [docs/specs/sdlc-work-roadmap.md](docs/specs/sdlc-work-roadmap.md)); Confluence: "Spec: sdlc-work roadmap - Ticket Breakdown" under the crew-review page in space SD. Jira is the source of truth for status.

## 1. Safety and correctness (do first)

- [x] **S1** [SCRUM-147](https://kennyalanlong.atlassian.net/browse/SCRUM-147) `npm test` runs unit tests only; live suites need `SDLC_LIVE=1` and refuse non-local URLs unless `SDLC_LIVE_ALLOW_REMOTE=1` (B1)
- [x] **S2** [SCRUM-148](https://kennyalanlong.atlassian.net/browse/SCRUM-148) Ticket briefs name real skills (`/sdlc:prime`, `/sdlc:plan`, `/sdlc:fix`, `/sdlc:report`, `/sdlc:rca`), with a test (B2)
- [x] **S3** [SCRUM-149](https://kennyalanlong.atlassian.net/browse/SCRUM-149) State file: take the lock in every command that writes it; atomic lock (`wx` flag + PID alive check); write to a temp file then rename, re-reading and merging first (B3, B4)
- [x] **S4** [SCRUM-150](https://kennyalanlong.atlassian.net/browse/SCRUM-150) HTTP: request timeout; retry POST only on 429; clear messages for expired tokens (401/403) (B4, B5)
- [x] **S5** [SCRUM-151](https://kennyalanlong.atlassian.net/browse/SCRUM-151) Markup: escape Jira special characters; fix the strikethrough regex; negative tests (B6)
- [x] **S6** [SCRUM-152](https://kennyalanlong.atlassian.net/browse/SCRUM-152) Review `head`/`base` read as strings (B7); validate Jira keys against the project keys, add `--branch`/`--pr`, record existing PRs (B8); hook path with `resolve()` (B9)
- [x] **S7** [SCRUM-153](https://kennyalanlong.atlassian.net/browse/SCRUM-153) Sync: catch errors per item and continue; configurable statuses never moved backwards (B11); reach Done by status category; multi-hop transitions; set Resolution on Done
- [ ] **F1** [SCRUM-155](https://kennyalanlong.atlassian.net/browse/SCRUM-155) Complete the deviations table (≈13 missing rows); fix stale names (`plan-feature`, the "sweep" attribution)
- [ ] **B12** [SCRUM-154](https://kennyalanlong.atlassian.net/browse/SCRUM-154) Doc drift: README path `C:Codesdlc-work`, the stale CLI list, `import-story`/`implement-fix` names, "12 skills"

## 2. Team readiness

- [ ] **T1** [SCRUM-167](https://kennyalanlong.atlassian.net/browse/SCRUM-167) State model: commit only stable item→issue mappings, one file per epic (`.sdlc/state/<EPIC>.json`); keep `prs`/`tickets`/page ids/logs per developer (gitignored); rebuild what's missing from labels and page ids
- [ ] **T2** [SCRUM-173](https://kennyalanlong.atlassian.net/browse/SCRUM-173) Several epics or milestones per repo (`--epic`/`--milestone`/`--spec` selectors)
- [ ] **T3** [SCRUM-174](https://kennyalanlong.atlassian.net/browse/SCRUM-174) Re-plan safety: store each item's title/slug, warn on drift, handle orphaned stories (close or label), optional `--update` of summaries/acceptance criteria
- [ ] **T4** [SCRUM-175](https://kennyalanlong.atlassian.net/browse/SCRUM-175) Done on merge without a developer's machine: CI/post-merge `sync`; `doneWhen` matches every key found in the PR (multi-story PRs)
- [ ] **T5** [SCRUM-168](https://kennyalanlong.atlassian.net/browse/SCRUM-168) Fix and live-test the CI templates (head-ref checkout, `--branch/--pr`, Write permission); GitHub Actions on the test repo *(needs an `ANTHROPIC_API_KEY` repo secret from you)* (B10)
- [ ] **T6** [SCRUM-169](https://kennyalanlong.atlassian.net/browse/SCRUM-169) `sdlc-atl doctor`: credentials (expiry hints), git host, gsd-tools, hook path, Bug/Epic types, workflow reachability, last sync error
- [ ] **T7** [SCRUM-170](https://kennyalanlong.atlassian.net/browse/SCRUM-170) `sdlc-atl start KEY`: import → assign to me → In Progress → `feature/KEY-slug` branch → next steps; branch creation at the start of `ticket`/`fix`/the `spec` hand-off
- [ ] **T8** [SCRUM-156](https://kennyalanlong.atlassian.net/browse/SCRUM-156) Config discoverability: `init` flags for every key, a JSON schema, setup documents `transitions`/`doneWhen`/`issueType`/`git.base`/`spec`
- [ ] **T9** [SCRUM-157](https://kennyalanlong.atlassian.net/browse/SCRUM-157) Cross-agent install: Node-based `install.mjs` for all operating systems; rewrite `$1`/`$ARGUMENTS` for non-Claude agents; document `uv`; the hook always uses a stable CLI path
- [ ] **T10** [SCRUM-191](https://kennyalanlong.atlassian.net/browse/SCRUM-191) Getting-started wizard: `node setup.mjs` picks the AI tools (Copilot CLI / VS Code, Codex, Claude Code), checks and installs prerequisites, installs skills + MCP per tool, collects and live-tests tokens, detects proxy/TLS issues
- [ ] **T11** [SCRUM-190](https://kennyalanlong.atlassian.net/browse/SCRUM-190) AGENTS.md as the single rules file: skills write rules there; `init` creates `AGENTS.md` and a `CLAUDE.md` that imports it

## 3. Restore reference strengths

- [ ] **F2** [SCRUM-158](https://kennyalanlong.atlassian.net/browse/SCRUM-158) `/sdlc:system-review` + a `system-reviewer` agent (divergence classification, root cause, /10 alignment score, proposed rule/skill text; reads piv reports + GSD SUMMARY deviations)
- [ ] **F3** [SCRUM-159](https://kennyalanlong.atlassian.net/browse/SCRUM-159) `/sdlc:create-rules` (descending-generality AGENTS.md/CLAUDE.md, rules cited to `file:line`, `.claude/context/` table, Gotchas); rca/fix/review-fix point to it
- [ ] **F4** [SCRUM-160](https://kennyalanlong.atlassian.net/browse/SCRUM-160) Restore plan depth for piv (strategic-thinking checklist, New Files, Patterns with code, 6 validation levels incl. manual + E2E, the "No Prior Knowledge" test)
- [ ] **F5** [SCRUM-171](https://kennyalanlong.atlassian.net/browse/SCRUM-171) E2E level (Playwright MCP / agent-browser, Windows note; `gsd-dom-verifier` for gsd)
- [ ] **F6** [SCRUM-161](https://kennyalanlong.atlassian.net/browse/SCRUM-161) Spec fidelity (500–700-line / 20–60-minute sizing, dependency graph + waves, file-overlap check, local PRD paths, optional epic, Task for chores)
- [ ] **F7** [SCRUM-162](https://kennyalanlong.atlassian.net/browse/SCRUM-162) `/sdlc:commit` (key-tagged, "AI Layer Changes" summary); widen `prime` (several keys, Confluence pages); `quality` category + stats in review
- [ ] **F8** [SCRUM-163](https://kennyalanlong.atlassian.net/browse/SCRUM-163) Baseline safety hooks for piv (secret/destructive guard, JSONL audit log)
- [ ] **D1** [SCRUM-164](https://kennyalanlong.atlassian.net/browse/SCRUM-164) Plugin evals (`claude plugin eval`, with vs without the skills) in CI

## 4. Pilot

- [ ] **P1** [SCRUM-176](https://kennyalanlong.atlassian.net/browse/SCRUM-176) Pilot on a real repo (SWG-Toolkit on the Cloud site, or a work repo): one story through import → plan → execute → review → PR, one bug through RCA → fix. Let the results reorder section 5.

## 5. Differentiators (after the pilot)

- [ ] **D2** [SCRUM-179](https://kennyalanlong.atlassian.net/browse/SCRUM-179) One review rules file (REVIEW.md) shared by our review, Claude Code Review, Rovo Dev, CodeRabbit
- [ ] **D3** [SCRUM-180](https://kennyalanlong.atlassian.net/browse/SCRUM-180) Verified findings with confidence + suggested fix
- [ ] **D4** [SCRUM-181](https://kennyalanlong.atlassian.net/browse/SCRUM-181) AI attribution: commit trailers (key, agent, model) + Agent Trace, rolled up into the PR and Jira
- [ ] **D5** [SCRUM-189](https://kennyalanlong.atlassian.net/browse/SCRUM-189) `sdlc-atl metrics` (cycle time, review rounds, rework, escaped defects, token cost) → Confluence / DX
- [ ] **D6** [SCRUM-182](https://kennyalanlong.atlassian.net/browse/SCRUM-182) Headless "work this ticket" for Data Center: Jira Automation webhook → CI `claude -p` → progress to Jira → draft PR on Bitbucket DC
- [ ] **D7** [SCRUM-183](https://kennyalanlong.atlassian.net/browse/SCRUM-183) Tests from acceptance criteria (EARS / Given-When-Then → property and acceptance tests; acceptance criterion → test → verification table)
- [ ] **D8** [SCRUM-184](https://kennyalanlong.atlassian.net/browse/SCRUM-184) Enforce the learning loop in CI (the RCA's regression test fails before the fix and passes after; solutions index)
- [ ] **D9** [SCRUM-177](https://kennyalanlong.atlassian.net/browse/SCRUM-177) CI self-heal on Jenkins / Bitbucket DC with a bounded number of retries
- [ ] **D10** [SCRUM-185](https://kennyalanlong.atlassian.net/browse/SCRUM-185) Incident intake (`import --from sentry|jsm`) → Bug with an RCA draft
- [ ] **D11** [SCRUM-186](https://kennyalanlong.atlassian.net/browse/SCRUM-186) `sdlc-atl release VERSION`: evidence-gated readiness + release notes page
- [ ] **D12** [SCRUM-187](https://kennyalanlong.atlassian.net/browse/SCRUM-187) Drift check between PRD/story/code and the plan; offer to re-plan
- [ ] **Strategic** [SCRUM-188](https://kennyalanlong.atlassian.net/browse/SCRUM-188) Cloud "delegate mode" ahead of the 2029 DC cutoff; consider shipping as a Spec Kit extension and publishing the skills to Tessl

## Housekeeping

- [ ] [SCRUM-165](https://kennyalanlong.atlassian.net/browse/SCRUM-165) Add the `origin` remote and tag `v0.1.0`
- [ ] [SCRUM-166](https://kennyalanlong.atlassian.net/browse/SCRUM-166) Rename or split `@sdlc/atlassian` (it now holds engines, git hosts, review/PR, the CLI)
- [ ] [SCRUM-172](https://kennyalanlong.atlassian.net/browse/SCRUM-172) CI for this repo: typecheck + unit tests + bundle freshness check
- [ ] [SCRUM-178](https://kennyalanlong.atlassian.net/browse/SCRUM-178) Delete `kennethlong/sdlc-work-pr-test` when it's no longer needed (needs the `delete_repo` scope, or delete it on GitHub)
