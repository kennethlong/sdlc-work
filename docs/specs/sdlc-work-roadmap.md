# Spec: sdlc-work roadmap

## Epic summary

Harden sdlc-work (safety, correctness), make it team-ready, restore the reference's learning and context layer, pilot it on a
real repo, then build the differentiators. Source: the crew review (docs/research/04-crew-review.md); IDs match it.

## Tickets

### S-1 — npm test runs unit tests only; live suites opt-in and local-only
- **Scope:** Stop `npm test` from writing to real Jira/Confluence
- **Acceptance criteria:**
  - `npm test` runs only the unit project
  - Live suites run only with `SDLC_LIVE=1`
  - Live suites refuse non-local base URLs unless `SDLC_LIVE_ALLOW_REMOTE=1`
- **Files touched (estimate):** `package.json`, `vitest.config.ts`, `packages/atlassian/test/*.live.test.ts`
- **Depends on:** none

### S-2 — Ticket briefs name the real /sdlc:* skills
- **Scope:** Engine next-steps point to skills that exist
- **Acceptance criteria:**
  - piv and gsd next steps use `/sdlc:prime`, `/sdlc:plan`, `/sdlc:fix`, `/sdlc:report`, `/sdlc:rca`
  - A unit test fails if a next step names a skill that isn't in `plugins/sdlc/skills`
- **Files touched (estimate):** `engines/piv.ts`, `engines/gsd.ts`
- **Depends on:** none

### S-3 — Race-safe state file and atomic lock
- **Scope:** Background hook syncs can't lose other commands' state writes
- **Acceptance criteria:**
  - Every command that writes state takes the lock
  - The lock is created atomically (`wx`) and stale only if its PID is dead
  - State saves write a temp file and rename it, re-reading and merging first
- **Files touched (estimate):** `state.ts`, `automation.ts`, `cli.ts`
- **Depends on:** none

### S-4 — HTTP timeouts, safe retries, clear auth errors
- **Scope:** No hangs, no duplicate writes on retry, actionable 401/403
- **Acceptance criteria:**
  - Every request has a timeout
  - POST is retried only on 429
  - 401/403 messages say how to regenerate the token
- **Files touched (estimate):** `http.ts`
- **Depends on:** none

### S-5 — Markup escaping and strikethrough fix
- **Scope:** Jira wiki round-trips don't corrupt text
- **Acceptance criteria:**
  - `{ } [ ] | *` in text, link text and table cells are escaped for Jira
  - "a - b - c" list items stay plain text
  - Negative tests cover both
- **Files touched (estimate):** `markup.ts`, `markup.test.ts`
- **Depends on:** none

### S-6 — Review/PR robustness: string SHAs, validated keys, --branch/--pr, hook path
- **Scope:** Review and PR flows can't crash on edge-case input or grab fake Jira keys
- **Acceptance criteria:**
  - Review `head`/`base` are always read as strings
  - Jira keys are validated against the configured project keys (no `PHASE-03`, `UTF-8`)
  - `pr`, `publish-review` and `review-scope` accept `--branch`/`--pr`
  - A PR opened elsewhere is recorded in state
  - The hook path uses `resolve()`
- **Files touched (estimate):** `review.ts`, `pr.ts`, `git.ts`, `automation.ts`, `cli.ts`
- **Depends on:** none

### S-7 — Resilient sync: per-item errors, no backwards moves, real workflows
- **Scope:** Sync works on real Jira workflows and one failure doesn't stop the run
- **Acceptance criteria:**
  - Errors are reported per item and the run continues
  - A configurable set of statuses is never moved backwards
  - Done is reached by status category, with multi-hop transitions
  - Resolution is set on Done when the workflow needs it
- **Files touched (estimate):** `sync.ts`, `jira.ts`
- **Depends on:** none

### S-8 — Fix doc drift
- **Scope:** Docs match reality
- **Acceptance criteria:**
  - README path and CLI command list are fixed
  - Design doc uses the real names (`import`, `/sdlc:fix`) and skill count
- **Files touched (estimate):** `README.md`, `docs/design/01-atlassian-bridge.md`
- **Depends on:** none

### F-1 — Complete the deviations-from-reference table
- **Scope:** Every intentional difference from the reference is recorded with its reason
- **Acceptance criteria:**
  - The ≈13 missing deviations are added (system-review, create-rules, plan depth, E2E, commit, worktrees, hooks, …)
  - Stale "plan-feature" name and "sweep" attribution are fixed
- **Files touched (estimate):** `docs/design/01-atlassian-bridge.md`, `docs/research/01-starter-pack-assessment.md`
- **Depends on:** none

### T-1 — Team-safe state model
- **Scope:** Several developers can share a repo without state conflicts
- **Acceptance criteria:**
  - Only stable item→issue mappings are committed, one file per epic (`.sdlc/state/<EPIC>.json`)
  - PRs, tickets, page ids and logs are per developer (gitignored)
  - Missing mappings are rebuilt from labels and page ids
- **Files touched (estimate):** `state.ts`, `filing.ts`, `sync.ts`, `pr.ts`, `.gitignore`
- **Depends on:** S-3

### T-2 — Several epics or milestones per repo
- **Scope:** A second feature doesn't require a second repo
- **Acceptance criteria:**
  - `--epic`/`--milestone`/`--spec` select the breakdown
  - State is keyed by epic
  - `sync` covers all filed epics
- **Files touched (estimate):** `filing.ts`, `sync.ts`, `cli.ts`, `engines/*`
- **Depends on:** T-1

### T-3 — Re-plan safety
- **Scope:** Renumbered or removed phases can't silently remap stories
- **Acceptance criteria:**
  - Each item's title/slug is stored with its mapping; drift is warned or refused
  - Orphaned stories are detected; offer to close or label `sdlc-obsolete`
  - `--update` pushes changed summaries and acceptance criteria
- **Files touched (estimate):** `filing.ts`, `state.ts`
- **Depends on:** T-1

### T-4 — Done on merge without a developer's machine
- **Scope:** Merging the PR is enough to close the story
- **Acceptance criteria:**
  - A CI/post-merge `sync` recipe for GitHub and Jenkins
  - `doneWhen` matches every key found in the PR (title, body, commits), so multi-story PRs work
- **Files touched (estimate):** `sync.ts`, `pr.ts`, `templates/ci/*`
- **Depends on:** T-1, S-6

### T-5 — Working, live-tested CI review templates
- **Scope:** The CI templates run
- **Acceptance criteria:**
  - Head-ref checkout; `--branch/--pr` passed from CI variables; Write allowed
  - The GitHub Actions template passes on the test repo (needs an `ANTHROPIC_API_KEY` repo secret)
- **Files touched (estimate):** `templates/ci/github/sdlc-review.yml`, `templates/ci/jenkins/Jenkinsfile.sdlc-review`
- **Depends on:** S-6

### T-6 — sdlc-atl doctor
- **Scope:** One command says what's wrong with a setup
- **Acceptance criteria:**
  - Checks credentials (with expiry hints), git host, gsd-tools, hook path, Bug/Epic types, workflow reachability, last sync error
  - `setup` runs it; skills suggest it on failure
- **Files touched (estimate):** `cli.ts`, new `doctor.ts`, `skills/setup/SKILL.md`
- **Depends on:** S-4

### T-7 — sdlc-atl start KEY
- **Scope:** One command to pick up a ticket
- **Acceptance criteria:**
  - Imports the ticket, assigns it to me, moves it to In Progress, creates `feature/KEY-slug`, prints next steps
  - `ticket`, `fix` and the `spec` hand-off start with it
- **Files touched (estimate):** `cli.ts`, `tickets.ts`, `jira.ts`, skills
- **Depends on:** S-6

### T-8 — Config discoverability
- **Scope:** Every config key is settable and documented
- **Acceptance criteria:**
  - `init` flags for every key
  - JSON schema for `.sdlc/config.json`
  - setup documents `transitions`, `doneWhen`, `issueType`, `git.base`, `spec`
- **Files touched (estimate):** `cli.ts`, `engines/index.ts`, `skills/setup/SKILL.md`
- **Depends on:** none

### T-9 — Cross-agent install for all operating systems
- **Scope:** Codex/Gemini users on any OS get working skills
- **Acceptance criteria:**
  - Node-based `install.mjs` replaces the PowerShell-only installer
  - `$1`/`$ARGUMENTS` are rewritten for non-Claude agents
  - `uv` is documented for MCP
  - The hook always uses a stable CLI path
- **Files touched (estimate):** `scripts/install.*`, `automation.ts`
- **Depends on:** none

### T-10 — Getting-started wizard
- **Scope:** One command sets up a developer machine for the AI tools they use (Copilot first, then Codex and Claude Code)
- **Acceptance criteria:**
  - `node setup.mjs` asks which tools are in use: GitHub Copilot CLI, Copilot in VS Code, Codex, Claude Code (and others via a skills directory)
  - Checks Node 24, git, `uv` and `gh`; installs them with winget/brew when allowed, otherwise prints the exact command
  - Installs the skills and registers the Jira/Confluence MCP server for each selected tool
  - Asks for Jira, Confluence and Bitbucket URLs and tokens, tests each live, and writes `~/.sdlc/atlassian.env` readable only by the user
  - Detects proxy / TLS-inspection problems and explains `NODE_EXTRA_CA_CERTS`
  - Re-running is safe; `--check` only reports; finishes with a doctor-style summary
- **Files touched (estimate):** `setup.mjs`, `scripts/install.*`, `packages/atlassian/src/cli.ts`
- **Depends on:** S-4

### T-11 — AGENTS.md as the single rules file
- **Scope:** Copilot, Codex and Claude Code read the same project rules
- **Acceptance criteria:**
  - Skills that add or read rules use `AGENTS.md` (rca, fix, report, review, review-fix, prime)
  - `sdlc-atl init` / setup creates `AGENTS.md` if missing and a `CLAUDE.md` that imports it (`@AGENTS.md`), without overwriting existing content
- **Files touched (estimate):** `plugins/sdlc/skills/*`, `packages/atlassian/src/cli.ts`
- **Depends on:** none

### F-2 — /sdlc:system-review + system-reviewer agent
- **Scope:** Restore the reference's plan-vs-actual learning loop
- **Acceptance criteria:**
  - Classifies divergences good/bad with root cause and a /10 alignment score
  - Proposes concrete rule and skill text
  - Reads piv execution reports and GSD SUMMARY deviations
- **Files touched (estimate):** `plugins/sdlc/skills/system-review/SKILL.md`, `plugins/sdlc/agents/system-reviewer.md`
- **Depends on:** none

### F-3 — /sdlc:create-rules
- **Scope:** A defined home and shape for the rules the other skills add
- **Acceptance criteria:**
  - Derives descending-generality AGENTS.md/CLAUDE.md with rules cited to file:line
  - `.claude/context/` table and Gotchas section
  - rca/fix/review-fix point to it
- **Files touched (estimate):** new skill, `rca`/`fix`/`review-fix` skills
- **Depends on:** none

### F-4 — Restore piv plan depth
- **Scope:** piv plans are as executable as the reference's
- **Acceptance criteria:**
  - Strategic-thinking checklist, New Files, Patterns with code
  - 6 validation levels including manual and E2E
  - The "No Prior Knowledge" test
- **Files touched (estimate):** `plugins/sdlc/skills/plan/SKILL.md` (+ template)
- **Depends on:** none

### F-5 — E2E validation level
- **Scope:** User-facing flows are checked in a real browser
- **Acceptance criteria:**
  - Playwright MCP / agent-browser guidance with a Windows note
  - `gsd-dom-verifier` pointer for the gsd engine
- **Files touched (estimate):** `validate`/`plan` skills, new `e2e` skill
- **Depends on:** F-4

### F-6 — Spec fidelity
- **Scope:** Restore the reference's slicing rules
- **Acceptance criteria:**
  - Ticket size of a 500–700-line plan and 20–60 minutes of execution
  - Dependency graph and waves in piv specs; file-overlap check for parallel work
  - Local PRD paths, optional epic, Task for chores
- **Files touched (estimate):** `plugins/sdlc/skills/spec/SKILL.md`
- **Depends on:** none

### F-7 — /sdlc:commit, wider prime, review quality category
- **Scope:** Small reference features we dropped
- **Acceptance criteria:**
  - A commit skill with key-tagged messages and an "AI Layer Changes" summary
  - `prime` accepts several keys and Confluence pages
  - Review has a `quality` category and stats
- **Files touched (estimate):** skills, `review.ts`
- **Depends on:** none

### F-8 — Baseline safety hooks for piv
- **Scope:** The guardrails AGENTS.md promises
- **Acceptance criteria:**
  - A secret/destructive-command guard (including the PowerShell tool)
  - JSONL audit log
- **Files touched (estimate):** `plugins/sdlc/hooks/*`
- **Depends on:** none

### D-1 — Plugin evals in CI
- **Scope:** Prove the skills beat working without them
- **Acceptance criteria:**
  - `claude plugin eval` suites for spec, ticket, rca and review, compared against no plugin
  - Run in CI
- **Files touched (estimate):** `evals/`, CI
- **Depends on:** none

### P-1 — Pilot on a real repo
- **Scope:** Use the toolset for real before building more
- **Acceptance criteria:**
  - One story through import → plan → execute → review → PR
  - One bug through RCA → fix
  - Findings reorder the differentiator tickets
- **Files touched (estimate):** skills (fixes found), pilot repo
- **Depends on:** S-1, T-1, T-6, T-7

### D-2 — Shared review rules file (REVIEW.md)
- **Scope:** One source of review rules for every reviewer
- **Acceptance criteria:**
  - Our review, Claude Code Review, Rovo Dev and CodeRabbit read the same rules
- **Depends on:** P-1

### D-3 — Verified findings with confidence
- **Scope:** Higher review precision
- **Acceptance criteria:**
  - Each finding's code path is re-traced before posting
  - Confidence and a suggested fix are posted
- **Depends on:** P-1

### D-4 — AI attribution
- **Scope:** Know which code came from which agent
- **Acceptance criteria:**
  - Commit trailers (key, agent, model) + Agent Trace records, rolled up into the PR and Jira
- **Depends on:** P-1

### D-5 — sdlc-atl metrics
- **Scope:** Show the impact
- **Acceptance criteria:**
  - Cycle time, review rounds, rework, escaped defects, token cost
  - Published to Confluence, exportable to DX
- **Depends on:** D-4

### D-6 — Headless "work this ticket" for Data Center
- **Scope:** The Cloud-only vendor pattern, on DC (delivered by W-1..W-5)
- **Acceptance criteria:**
  - A labelled story is picked up by CI and worked by an AI agent with the skills (Copilot CLI first)
  - Progress goes to Jira; a draft PR opens on Bitbucket DC
- **Depends on:** W-5

### W-1 — sdlc-atl work KEY: one headless run
- **Scope:** Everything a CI job does for one ticket, as one testable command
- **Acceptance criteria:**
  - Claims the story (assign to the bot, In Progress, comment with the build link, `ai-ready` → `ai-running`)
  - Branches `feature/KEY-slug` from the base, imports the brief, runs the configured agent headless (`copilot`, `claude` or `codex`) with the sdlc-ticket skill and a time limit
  - Gate: the execution report must pass; then pushes, opens a draft PR, publishes the review and the verification page, moves the story to the review status (never Done)
  - Failures comment the reason and build link, label `ai-failed`; nothing is pushed to the base branch
- **Files touched (estimate):** `packages/atlassian/src/headless.ts`, `packages/atlassian/src/cli.ts`
- **Depends on:** none

### W-2 — Polling, eligibility and a kill switch
- **Scope:** Pick up work without Jira admin rights
- **Acceptance criteria:**
  - `sdlc-atl work --poll` runs the repo's JQL (`work.jql`, default: label `ai-ready`, not running) and works eligible stories one at a time
  - Eligibility: issue types, maximum story points, component allow-list; ineligible stories get a comment and `ai-skipped`
  - Kill switch: `work.enabled: false` or `SDLC_WORK=off`; a concurrency limit
- **Files touched (estimate):** `packages/atlassian/src/headless.ts`, `packages/atlassian/src/cli.ts`
- **Depends on:** W-1

### W-3 — Clarification loop
- **Scope:** The agent asks instead of guessing
- **Acceptance criteria:**
  - When the story is ambiguous the agent writes questions instead of code; they are posted as a Jira comment, label `ai-needs-info`
  - A human reply makes the story eligible again; the next run sees the conversation in the brief
- **Files touched (estimate):** `packages/atlassian/src/headless.ts`
- **Depends on:** W-2

### W-4 — Jenkins in the local stack
- **Scope:** A CI server to prove the loop locally
- **Acceptance criteria:**
  - `./dc.ps1 up` also starts Jenkins, configured as code (no clicking), with node, git, uv and the Copilot CLI
  - A job polls every few minutes and runs `sdlc-atl work --poll` in a fresh clone; a Jenkinsfile template for work
- **Files touched (estimate):** `infra/atlassian-dc/*`, `templates/ci/jenkins/*`
- **Depends on:** none

### W-5 — End-to-end demo
- **Scope:** Label a story, get a draft PR
- **Acceptance criteria:**
  - On the local stack, labelling a story `ai-ready` ends in a draft Bitbucket PR, a review, a verification page and the story In Review, with progress comments in Jira
  - A story with missing details ends in questions instead of code
- **Files touched (estimate):** `scripts/`, docs
- **Depends on:** W-3, W-4

### D-7 — Tests from acceptance criteria
- **Scope:** Make "does it meet the ticket" mechanical
- **Acceptance criteria:**
  - EARS / Given-When-Then criteria generate property and acceptance tests
  - An acceptance criterion → test → verification table is published
- **Depends on:** P-1

### D-8 — Enforce the learning loop in CI
- **Scope:** Turn the RCA warning into a gate
- **Acceptance criteria:**
  - The RCA's regression test exists, fails before the fix and passes after
  - A solutions index the planners read
- **Depends on:** P-1

### D-9 — CI self-heal on Jenkins / Bitbucket DC
- **Scope:** Fix red builds automatically, with a bounded number of retries
- **Acceptance criteria:**
  - Classify the failure → fix → re-run, bounded; the result shows in Code Insights
- **Depends on:** T-5

### D-10 — Incident intake
- **Scope:** Production problems feed the bug track
- **Acceptance criteria:**
  - `import --from sentry|jsm` creates a Bug with an RCA draft
- **Depends on:** P-1

### D-11 — sdlc-atl release VERSION
- **Scope:** Evidence-gated releases
- **Acceptance criteria:**
  - Gate: all verified and merged, no open linked bugs, RCAs complete
  - Release notes page in Confluence
- **Depends on:** P-1

### D-12 — Drift check
- **Scope:** Close the two-way sync gap
- **Acceptance criteria:**
  - Detect when the PRD, a story, or code for a verified item changed after filing; offer to re-plan
- **Depends on:** T-3

### D-13 — Cloud delegate mode and distribution
- **Scope:** Strategy ahead of the 2029 DC cutoff
- **Acceptance criteria:**
  - On Cloud, hand ticket-to-PR to vendor agents and keep filing/verification/gates
  - Evaluate a Spec Kit extension and Tessl publishing
- **Depends on:** P-1

### H-1 — Add origin remote and tag v0.1.0
- **Scope:** Housekeeping
- **Acceptance criteria:**
  - Remote added, `v0.1.0` tagged and pushed
- **Depends on:** none

### H-2 — Rename or split @sdlc/atlassian
- **Scope:** The package now holds engines, git hosts, review/PR and the CLI
- **Acceptance criteria:**
  - A new package layout (e.g. core / atlassian / git-hosts / cli), bundle and tests green
- **Depends on:** none

### H-3 — CI for sdlc-work
- **Scope:** Guard the repo itself
- **Acceptance criteria:**
  - Typecheck, unit tests and bundle freshness check on every push
- **Depends on:** S-1

### H-4 — Delete the GitHub test repo when done
- **Scope:** Cleanup
- **Acceptance criteria:**
  - `kennethlong/sdlc-work-pr-test` deleted once the GitHub live suite no longer needs it
- **Depends on:** T-5

## Dependency graph

Computed by `sdlc-atl breakdown` from the "Depends on" lines.

## Suggested execution order

Computed by `sdlc-atl breakdown`; see the "Spec: … - Ticket Breakdown" page in Confluence.
