# Crew review: sdlc-work vs the reference, and what to do next

2026-09-25. Four independent read-only reviews, merged and ranked:
1. **Reference fidelity**: a skill-by-skill mapping of `ai-native-starter-pack` against ours.
2. **Architecture and code**: `packages/atlassian`, plugin, infra, tests.
3. **Team workflow**: onboarding, Track A/B, PR, multi-developer reality, failure recovery.
4. **Landscape**: late-2026 state of the art (Atlassian Rovo, GitHub, Anthropic, GSD, Spec Kit, Kiro, Compound Engineering, …).

## Verdict

- **Integrations are well beyond the reference.** Idempotent filing, status sync back to Jira, verification pages,
  Data Center plus Cloud, Bitbucket DC plus GitHub, review gates, and done-when-merged are deterministic and tested live.
- **The learning-and-context layer fell behind the reference.** The plan-vs-actual retrospective (`system-review`),
  the rules and context builder (`create-rules`), the plan template's depth and the E2E level were dropped, and most
  of these drops aren't recorded as deviations.
- **Team adoption has four blockers:**
  - the shared state file will conflict;
  - only one epic per repo;
  - re-planning in GSD can remap stories to the wrong phase;
  - the CI templates will probably fail as written.
- **Safety:** `npm test` also runs the live suites, which can write to a real Jira/Confluence.
- **Strategy:** Data Center support is our strongest advantage (Atlassian's AI features are Cloud-only). It has an
  end date: Jira and Confluence DC become read-only on 2029-03-28 (Bitbucket DC continues). Our lasting value is
  the deterministic Jira/Confluence layer, the evidence and gates, the learning loop, and the DC automation that
  vendors skip.

## Comparison with the reference

| Reference | Ours | Status |
|---|---|---|
| `spec`, `code-review`, `code-review-fix`, `rca`, `implement-fix`, `validate`, `claude-review.yml` | `spec`, `review`, `review-fix`, `rca`, `fix`, `validate`, CI templates | **Improved**: idempotent Jira filing, `base...HEAD` scope, acceptance-criteria pass, gates, RCA published with a prevention check |
| `prime` (+ `-backend`/`-frontend`) | `prime` + persisted ticket brief | Improved, but **narrowed**: one key only, no multi-key or Confluence inputs |
| `create-prd` | `prd` (+ `page push`) | Changed: 15 → 8 sections, publishes to Confluence |
| `plan-feature` | `plan` (piv); `gsd-plan-phase` (gsd) | **piv weaker**: 6 validation levels → 1, no strategic-thinking phase, no E2E level |
| `execute`, `execution-report` | `execute`, `report` (now the Jira verdict) | Kept or improved |
| `system-review` + `system-reviewer` agent | none (GSD `extract-learnings` is partial) | **MISSING** |
| `create-rules` (+ `.claude/context/`) | none | **MISSING** (yet our skills say "add a rule" with no defined home or shape) |
| `commit` ("AI Layer Changes" summary), `end-to-end-feature`, worktrees | none for piv (GSD covers these) | **MISSING** (piv) |
| `agent-browser` E2E, `ast-grep`, `init-project`, 3 agents, safety/audit hooks, 4 reference docs | none (GSD brings its own hooks) | **MISSING**; hooks are promised in AGENTS.md |

The deviations table in the design doc is missing about 13 of these; see recommendation F1.

## Bugs found (fix first)

| # | Bug | Evidence |
|---|---|---|
| B1 | **`npm test` runs the live suites** against whatever config resolves, possibly `~/.sdlc/atlassian.env` (a work instance) | `package.json` `test`, `vitest.config.ts` |
| B2 | The ticket brief names skills that don't exist: `/prime`, `/plan-feature`, `/implement-fix`, `/execution-report`, `/rca` instead of `/sdlc:*` | `engines/piv.ts` `nextSteps`, `engines/gsd.ts` |
| B3 | **State file race conditions:** only `sync` takes the lock, and there's no atomic write, so a background hook sync can overwrite `pr` or `file-breakdown` writes (e.g. a lost `prs` entry breaks done-when-merged) | `state.ts`, `cli.ts` |
| B4 | The lock isn't atomic (check-then-write), takes over a still-running sync after 10 min, and there's no HTTP timeout | `automation.ts` `withLock`, `http.ts` |
| B5 | POST retried on 503 can create duplicate issues, comments or links | `http.ts` |
| B6 | Jira wiki → markdown turns `a - b - c` list items into ~~strikethrough~~; markdown → wiki doesn't escape `{ } [ ] \| *` | `markup.ts` |
| B7 | A numeric short SHA in a review file (`head: 1234567`) is parsed as a number, then `startsWith` throws | `review.ts`, `pr.ts` |
| B8 | Jira keys guessed from text: `gsd/phase-03-x` becomes `PHASE-03`, and "fix utf-8" in a commit becomes `UTF-8`. A PR gets created, then the Jira step fails, so the PR is never recorded | `git.ts` `keyFrom`, `pr.ts` |
| B9 | The hook path is wrong when `core.hooksPath` is absolute (`join` should be `resolve`) | `automation.ts` |
| B10 | CI templates: GitHub `pull_request` checks out a detached merge commit, so the branch name is `HEAD` and "No open PR" follows; `issue_comment` checks out the default branch; Jenkins' `--allowedTools` has no `Write` | `templates/ci/*`, `git.ts`, `pr.ts` |
| B11 | Sync can move issues backwards out of non-Done statuses (e.g. In Review → In Progress) | `sync.ts` `moveForward` |
| B12 | Doc drift: README path `C:Codesdlc-work`, a stale CLI list, `import-story`/`implement-fix` names in the design doc, "12 skills" | README, design doc |

## Recommendations, ranked

### P0: safety and correctness (days)

| # | What | Effort |
|---|---|---|
| S1 | Make `npm test` run unit tests only. Live suites require `SDLC_LIVE=1` and refuse non-local URLs unless `SDLC_LIVE_ALLOW_REMOTE=1` | S |
| S2 | Fix B2 (skill names in briefs) with a test | S |
| S3 | State: take the lock in every command that writes it; atomic lock (`wx` flag + PID alive check); write to a temp file then rename, re-reading and merging first | M |
| S4 | HTTP: request timeout, retry POST only on 429, clear messages for expired tokens (401/403) | S |
| S5 | Markup: escape Jira special characters, fix the strikethrough regex, add negative tests | S |
| S6 | Fix B7, B8 (validate keys against the configured project keys; add `--branch`/`--pr`; record existing PRs) and B9 | S |
| S7 | Sync: catch errors per item and keep going, a configurable set of statuses never moved backwards, reach Done by status category, multi-hop transitions, set Resolution on Done | M |

### P1: team readiness (the adoption blockers)

| # | What | Effort |
|---|---|---|
| T1 | **State model:** commit only stable item→issue mappings, one file per epic or milestone (`.sdlc/state/<EPIC>.json`); keep `prs`, `tickets`, page ids and logs per developer (gitignored); rebuild anything missing from labels and page ids | M |
| T2 | **Several epics or milestones per repo** (`--epic`/`--milestone`/`--spec` selectors, state keyed by epic) | M |
| T3 | **Re-plan safety:** store each item's title/slug; warn or refuse when a mapped story's title has drifted; detect orphaned stories (offer close or an `sdlc-obsolete` label); optional `--update` to push changed summaries/acceptance criteria | M |
| T4 | **Done on merge without a developer's machine:** a CI/post-merge step running `sync`; `doneWhen` matching every key found in the PR (title, body, commits) for multi-story PRs | M |
| T5 | **Fix and live-test the CI templates** (head-ref checkout, `--branch/--pr`, Write permission); GitHub Actions on the test repo once an `ANTHROPIC_API_KEY` secret exists | M |
| T6 | **`sdlc-atl doctor`**: credentials (with expiry hints), git host, gsd-tools, hook path, Bug/Epic types, workflow reachability, last sync error. Shown by `setup` and at the start of skills | S–M |
| T7 | **`sdlc-atl start KEY`**: import → assign to me → In Progress → create `feature/KEY-slug` → next steps. Branch creation moves to the start of `ticket` / `fix` / the `spec` hand-off | S |
| T8 | Config discoverability: `init` flags for every key, a JSON schema, setup documents `transitions`, `doneWhen`, `issueType`, `git.base`, `spec` | S |
| T9 | Cross-agent install: a Node-based `install.mjs` for all operating systems, rewrite `$1`/`$ARGUMENTS` for non-Claude agents, document `uv` for MCP; the hook always uses a stable CLI path | S–M |

### P2: restore reference strengths (the learning and context layer)

| # | What | Effort |
|---|---|---|
| F1 | **Complete the deviations table** (≈13 missing rows) and fix stale names (`plan-feature`, the "sweep" attribution) | S |
| F2 | **`/sdlc:system-review` + a `system-reviewer` agent**: good/bad divergence classification, root cause, a /10 alignment score, proposed rule and skill text; reads piv reports and GSD SUMMARY deviations | M |
| F3 | **`/sdlc:create-rules`**: descending-generality AGENTS.md/CLAUDE.md, rules cited to `file:line`, an on-demand `.claude/context/` table, Gotchas. rca, fix and review-fix point to it | M |
| F4 | **Restore plan depth (piv):** strategic-thinking checklist, New Files, Patterns with code, 6 validation levels (incl. manual + E2E), the "No Prior Knowledge" test; a template beside the skill to keep it lean | M |
| F5 | **E2E level** (Playwright MCP / agent-browser, Windows note; `gsd-dom-verifier` for gsd) | M |
| F6 | **Spec fidelity:** the 500–700-line / 20–60-minute sizing, dependency graph and waves in piv specs, a file-overlap check for parallel work, local PRD paths, optional epic, Task for chores | S |
| F7 | `/sdlc:commit` with a key-tagged message and an "AI Layer Changes" summary; widen `prime` (several keys, Confluence pages); add a `quality` category and stats to review | S |
| F8 | Baseline safety hooks for piv (secret and destructive-command guard, JSONL audit log), as promised in AGENTS.md | S–M |

### P3: differentiators (the landscape's value-for-effort ranking)

| # | What | Why | Effort |
|---|---|---|---|
| D1 | **Plugin evals** (`claude plugin eval`: with vs without our skills) in CI | No proof yet that our skills beat the baseline | S |
| D2 | **One review rules file** (REVIEW.md) shared by our review, Claude Code Review, Rovo Dev and CodeRabbit | Consistency across reviewers | S |
| D3 | **Verified findings with confidence:** re-trace each finding's code path before posting; post confidence and a suggested fix | Precision is the value of AI review ("verification tax", DORA 2026) | S–M |
| D4 | **AI attribution:** commit trailers (key, agent, model) + Agent Trace, rolled up into the PR and Jira | Audit, and the input for metrics | S |
| D5 | **`sdlc-atl metrics`**: cycle time, review rounds, rework/reopen, defects that escape, token cost (Claude Code OpenTelemetry), published to Confluence or DX | The enterprise buying question (Atlassian bought DX) | M |
| D6 | **Headless "work this ticket" for Data Center:** a Jira DC Automation webhook starts a CI job running `claude -p` with our skills, streaming progress to Jira and opening a draft PR on Bitbucket DC | Vendors ship this Cloud-only; it's the DC advantage in practice | M |
| D7 | **Tests from acceptance criteria:** EARS or Given-When-Then criteria generate property and acceptance tests; an acceptance criterion → test → verification table goes to Confluence | Makes "does it meet the ticket" mechanical (Kiro) | M |
| D8 | **Enforce the learning loop in CI:** the RCA's regression test exists, fails before the fix and passes after; a solutions index the planners read | Turns a warning into a gate (Compound Engineering) | S–M |
| D9 | **CI self-heal on Jenkins / Bitbucket DC** with a bounded number of retries | Vendors only do GitHub or Bitbucket Cloud | M |
| D10 | **Incident intake:** `import --from sentry|jsm` into a Bug with an RCA draft; an alert webhook feeding D6 | Closes the production → spec gap | M |
| D11 | **`sdlc-atl release VERSION`**: gate on verified, merged, no open bugs, RCAs complete; release notes page in Confluence | No vendor gates releases on evidence | S–M |
| D12 | **Drift check:** the PRD or a story changed after filing, or code for a verified item changed, prompts an offer to re-plan | The top complaint about spec-driven development; closes our two-way sync gap | M–L |

**Strategic:** plan a Cloud "delegate mode" ahead of the 2029 DC cutoff. On Cloud, hand ticket-to-PR work to Agents in
Jira, Rovo or Copilot, and keep filing, verification and gates as our layer. Also consider shipping the bridge as a
Spec Kit extension and publishing the skills to Tessl.

### Buy, don't build

- **General PR review bots:** Claude Code Review / Copilot review on GitHub, CodeRabbit on Bitbucket DC. Keep only
  our acceptance-criteria pass, the Jira verdict and the gate.
- **Cloud ticket-to-PR agents:** Agents in Jira, Claude Agent for Jira, Copilot for Jira.
- **Ad-hoc Atlassian tool access:** mcp-atlassian on DC, Rovo MCP on Cloud.
- **Metrics dashboards:** DX / LinearB (we emit the data).
- **Incident root cause:** Sentry Seer, Rovo Ops/JSM (we take their output in).
- **Security scanning:** the Claude Security plugin, Semgrep, CodeQL.
- **Planning engine:** GSD / Spec Kit.
- **Scheduled agents on GitHub:** Claude Code routines.

## Suggested sequence

1. **Now (1–2 days):** S1–S6, F1, B12. These are the safety fixes and cheap correctness and fidelity fixes.
2. **Next:** S7 + T1–T4 + T6–T7. The model is ready for a team once these land.
3. **Then:** F2 + F3 (the reference's compounding loop), D1 (evals), T5 (verified CI).
4. **Pilot** on a real repo (SWG-Toolkit on the Cloud site, or a work repo) *before* P3, and let it reorder P3.
