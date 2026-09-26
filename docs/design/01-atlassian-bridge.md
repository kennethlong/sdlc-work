# Design: Atlassian bridge (Jira + Confluence Data Center)

Status: flow agreed 2026-09-24. Targets Jira Software DC 10.3 and Confluence DC 10.2 (local stack in
`infra/atlassian-dc`), with Cloud later behind the same interfaces.

## Two layers

| Layer | What | Why |
|---|---|---|
| **Agent tools** | [`mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) (MIT, DC + PAT) launched by `scripts/mcp-atlassian.mjs` | Ad-hoc "read this ticket / search Confluence" for any MCP-capable agent. Already solved, so we don't rebuild it |
| **Bridge** (`packages/atlassian`) | Typed DC client plus deterministic steps between Confluence/Jira and GSD `.planning/` | Repeatable, idempotent operations shouldn't depend on an LLM choosing tools |

## Planning engine is an option

`engine: gsd | piv` (in `.sdlc/config.json`, or `--engine`; auto-detected from `.planning/ROADMAP.md` vs
`docs/specs/`). The Jira/Confluence side works on an engine-neutral **work breakdown** (items with title, goal,
acceptance criteria, requirement ids, dependencies, status); each engine has an adapter that produces it.

| Engine | Planning/execution | Breakdown source | Progress + verification | Status |
|---|---|---|---|---|
| `gsd` | GSD Core (discuss → plan → execute → verify) | `.planning/ROADMAP.md` phases, via `gsd-tools` | `disk_status` + `*-VERIFICATION.md` front matter | ✅ Slices 2–3 |
| `piv` | Reference-style skills (`/sdlc:prime` → `plan` → `execute` → `validate` → `report`; the reference's prime → plan-feature → execute → validate → execution-report) | `docs/specs/<epic>.md` tickets (the reference's `/spec` output) | `.claude/plans/` = planned; `.claude/execution-reports/` ✓/✗ "Validation Results" = verdict | ✅ Slice 4 |

The same live test suite (filing + sync lifecycle) runs against both engines' fixtures.

**piv artifact ⇄ ticket linking (deviation):** the reference never records which ticket a plan or execution report
belongs to (plans are named after the feature). An artifact belongs to a ticket when its file name starts with
the ticket id or its filed Jira key (`ticket-1-…`, `sdlc-5-…`), or it has a `Ticket: TICKET-1` line. Merely
mentioning a ticket ("depends on TICKET-1") does not link it. Our PIV skills follow this.

Mapping state is engine-neutral: `.sdlc/atlassian.json` (item id ⇄ issue key, page ids). Every filed story also
carries a label `sdlc-item-<id>`, so re-runs stay idempotent even without the state file (e.g. another developer).

## Flow: follows the reference, in two tracks

The reference ([`ai-native-starter-pack`](../../../ai-native-starter-pack), see its `/spec` skill and
`diagrams/ai-native-sdlc-detailed.png`) runs: **Epic PRD (Confluence) → `/spec` → tickets (Jira) → `/prime`
(reads the ticket) → PIV loop → PR → code review → ship → `/rca` → updated rules.** We keep that shape and use
GSD for the planning and execution machinery.

### Track A: large features (PRD-first)

Use it when the work spans more than one ticket or needs stakeholder review before building.

1. **PRD in Confluence** (the source of truth). It can be drafted with an agent in its own session, as in the
   reference's two-session PM flow.
2. **Spec → GSD milestone.** The PRD page, plus the Jira epic as extra context ("PRD wins" on conflict), goes
   through GSD's doc intake to produce REQUIREMENTS + ROADMAP. GSD `granularity: fine`, so each phase is one
   ticket-sized vertical slice (the reference sizes a ticket at one plan of 500–700 lines and 20–60 min of execution).
3. **File tickets** (the reference's `/spec` steps 5–6):
   - each phase becomes a Jira Story under the epic, with scope, acceptance criteria (the phase's success
     criteria) and "Depends on";
   - idempotent: existing children are matched and skipped, never duplicated;
   - the ticket breakdown (dependency graph and waves) is published as a child page of the PRD.
4. **Per ticket:** GSD discuss → plan → execute → verify. This is the reference's prime → plan-feature →
   execute → validate, with GSD's plan checker, parallel waves and goal-backward verification on top.
5. **Report back** (our addition, see Deviations): a planned phase moves its story to *In Progress*, a verified
   phase moves it to *Done*, and the verification report goes to a Confluence child page linked on the story.

### Track B: small features and bugs (Jira-only)

Use it when the work fits one ticket: one PIV loop, no stakeholder review.

- **Small feature:** Jira Story → `/sdlc:ticket <KEY>` (`sdlc-atl import <KEY>` writes the brief with the summary,
  description and acceptance criteria) → a GSD quick task or the piv loop → plan → execute → verify → report back
  to the story. This is the reference's per-ticket loop, where `/prime <jira-key>` reads the ticket.
- **Bug:** Jira Bug → **RCA** (`/sdlc:rca`, the reference's `/rca`: root cause, fix strategy, regression test) →
  fix (`/sdlc:fix`, the reference's `implement-fix`) → verify → report back, and **every bug becomes a rule +
  regression test** (the reference's learning loop; the sweep of other occurrences is ours).
- **Escalate** when triage or slicing shows it's bigger than one ticket: promote it to Track A (write the PRD,
  link the original ticket to the epic).

### Mapping

| Confluence / Jira | GSD |
|---|---|
| PRD page (+ epic) | Milestone: PROJECT / REQUIREMENTS / ROADMAP |
| Story under the epic | Phase (ticket-sized with `granularity: fine`) |
| Story acceptance criteria | Phase success criteria / REQ-IDs |
| Sub-task | Plan within the phase (optional; created at plan time) |
| PRD child page "Spec: … Ticket Breakdown" | ROADMAP phases, dependency graph, waves |
| Confluence child page per verified story | Phase VERIFICATION report |

Mapping state lives in `.sdlc/atlassian.json`, with labels as a fallback, so every step is re-runnable.

## Deviations from the reference

| Topic | Reference | Ours | Why |
|---|---|---|---|
| Planning/execution engine | Own skills (`plan-feature`, `execute`, `validate`) | GSD Core | GSD already does this better: plan checker, fresh-context parallel waves, atomic commits, goal-backward verification. Rewriting it would waste effort |
| Status back to Jira | None: ends at the GitHub PR | Transitions + Confluence verification reports | The team lives in Jira/Confluence. Progress should be visible there without asking an engineer |
| Bug intake | GitHub Issues (`gh issue view`) | Jira Bugs | The team tracks bugs in Jira |
| Primed ticket | `/prime <key>` holds it in the session only | Persisted brief `.sdlc/tickets/<KEY>.md` | A fresh session, another agent, or GSD's planner can read it; survives context resets |
| RCA doc | `docs/rca/issue-<n>.md`, stays in the repo | `docs/rca/<KEY>.md`, published to Confluence + the bug | Keyed by the Jira bug; the RCA is visible where the team works |
| Learning loop | Stated principle ("every bug → rule + regression test") | `publish-rca` warns when the RCA names no regression test or prevention rule | Makes the loop checkable instead of aspirational |
| Distribution | Copy `.claude/` into each repo | Plugin (marketplace) for Claude Code; `node setup.mjs` (wizard) for GitHub Copilot, Codex and others: skills in `~/.agents/skills`, MCP registered per tool; skills namespaced `/sdlc:*` / `sdlc-*` | Versioned, one-command install and updates; the team is mostly on Copilot and Codex |
| Agent tools (MCP) | Atlassian's remote MCP (`mcp.atlassian.com`, Rovo; Cloud only, OAuth) | `mcp-atlassian` (open source) via `uvx`, PAT for Data Center, API token for Cloud | Rovo MCP doesn't serve Data Center, where the team is |
| PRD | `create-prd`: long template in a repo file | `prd`: shorter section set, published to Confluence (`page push`), refined from Confluence | Confluence is the PRD's home for stakeholders; the sections kept are the ones `spec` consumes |
| `prime-backend` / `prime-frontend` | Separate area-scoped primes | One `prime` that loads the ticket(s) plus only the code they touch | Scoping by ticket gives the same focus without a skill per layer |
| `end-to-end-feature` | One skill chains prime → plan → execute → commit | `/sdlc:ticket` chains the loop, pausing for the user's go-ahead after planning (skippable); GSD's own flow for the gsd engine | A review point before code is written; the chaining already exists in both engines |
| Worktrees (`new-worktrees`, `merge-worktrees`) | Parallel feature work in worktrees | Not ported; GSD runs parallel waves itself, piv tickets run one at a time on a branch | Parallelism is GSD's job here; developers already work on separate branches |
| `init-project` | Skill to run the project from a fresh clone | Not ported; the run/build/test commands live in `AGENTS.md` (`/sdlc:create-rules`) | Project-specific: better as rules every agent reads than as a generic skill |
| `ast-grep` skill, reference docs (`architecture-patterns`, API and component best practices, vertical slices) | Generic guidance shipped in `.claude/` | Not ported | Not SDLC-specific; project context comes from `create-rules` modules instead of generic docs |
| Agents `research-agent`, `code-reviewer` | Claude subagents | Not ported: `review` runs inline; research uses each tool's own subagents | Must work in Copilot and Codex, which don't load Claude agents |
| System review | `system-review` takes plan + report paths; Claude-only `system-reviewer` agent; improvements go to `CLAUDE.md` | `/sdlc:system-review` finds the artifacts from a ticket key or GSD phase (piv reports or GSD SUMMARY deviations), several tickets at once, runs inline outside Claude Code; improvements go to `AGENTS.md`, applied on the user's OK | Works with both engines and every agent; the Jira key is how people refer to work |
| Rules builder | `create-rules` writes `CLAUDE.md` + `.claude/context/` for repos without one | `/sdlc:create-rules` writes `AGENTS.md` (`CLAUDE.md` imports it), replaces the `init` stub, never drops existing rules without showing them; skeleton in `template.md`; `.claude/context/` kept | One rules file for Copilot, Codex and Claude Code; the context table's paths make modules findable by any agent |
| Plan template | Embedded in `plan-feature`; "CONTEXT REFERENCES", per-task **VALIDATE**; `.claude/plans/{name}.md` | `plan/plan-template.md` beside a lean skill; "Context to read before implementing", per-step **Check**; `<ticket>-<slug>.md` + `Ticket:` line | Skill stays short; `execute` and existing plans use these names; the prefix links plans to Jira |
| E2E level | agent-browser (WSL on Windows); `screenshots/<ticket>-*.png` | `/sdlc:e2e`: Playwright MCP first, agent-browser second, the repo's browser tests third; evidence in `.claude/e2e/<ticket>/` | Windows is the main platform and Playwright MCP runs natively in Copilot, Codex and Claude Code |
| Validation reporting | ✅/❌ summary with overall PASS/FAIL; manual steps for a human | ✓/✗ only for checks that ran; a "Not run:" line for skipped or human-only checks | `sync` counts every ✓/✗ line to set the Jira verdict; verdicts stay honest |
| Spec waves and parallel safety | The agent writes the dependency graph and waves; "independent tickets don't share files" is advice | `sdlc-atl breakdown` computes waves (pasted into the spec); same-wave "Files touched" overlaps are flagged by `breakdown` and `file-breakdown` | Computed waves can't drift from Jira links; a check catches collisions advice misses |
| Chores and missing epics | Agent picks Story/Task via MCP; without an epic, publishes to Confluence only | `Type: Task` per ticket in the spec, honoured by `file-breakdown`; without an epic, `spec` stops at the spec file (optional `page push`) | Filing is deterministic in the CLI, so the type must be in the spec; the breakdown page comes from filing |
| Commit | `/commit` stages everything; "What Changed" / "AI Layer Changes" shown after committing | `/sdlc:commit`: `type(KEY): summary` with a validated key, files staged by name after a secret check, "AI Layer Changes" in the commit body, never skips hooks | Keys drive PR linking and sync; staging everything risks committing tokens; the note belongs in git history |
| Prime inputs | Jira keys and Confluence page ids via the Cloud Rovo MCP | Keys via `sdlc-atl import`, pages via `page pull`, spec tickets and page URLs; several at once | Works on Data Center; briefs and pages become files any agent can re-read |
| Review stats and categories | "Stats" block and a Code Quality heading in a local report | `stats:` front matter and a `quality` category, counted per category in the PR and Jira comments | Reviews are published to the PR and Jira, not kept locally |
| Safety hooks | Python via `uv run`, wired by copying `settings.json.example` per project; `exit 2` to block; blocks every `rm -rf` | Dependency-free Node hook in the plugin (`hooks/hooks.json`), JSON `deny` decision; blocks secret reads, env dumps and broad destructive commands (roots/home, force-push to main, `reset --hard`, `clean -fd`, `DROP DATABASE`, disk formatting) for Bash and PowerShell; allows `rm -rf node_modules` | Active on plugin install; the same file works in Copilot CLI; a guard that blocks routine cleanup gets switched off |
| Audit log | PostToolUse writes full events (incl. output) to `logs/post_tool_use.json` | PreToolUse appends a redacted summary line with the decision to `.sdlc/audit.jsonl` (sdlc repos only, rotated at 10 MB); `SDLC_GUARD=off` / `SDLC_AUDIT=off` | Records blocked calls too; never stores secrets or file contents |
| `settings.json.example` (permissions) | Claude Code permission presets | Not ported | Each agent has its own permission model; the F-8 hooks cover secrets and destructive commands |
| Project rules file | `CLAUDE.md` (its architecture notes even argue against `AGENTS.md`) | `AGENTS.md` holds the rules; `CLAUDE.md` imports it (`@AGENTS.md`); `init` sets this up without overwriting | The team works mostly in GitHub Copilot and Codex, which read `AGENTS.md`, not `CLAUDE.md`; one file keeps every agent on the same rules |
| Automation | Manual skill invocation | git post-commit hook runs `sync` | Status follows the work without anyone remembering; agent-agnostic |
| Review scope | `git diff HEAD` (uncommitted only) | `base...HEAD`, uncommitted listed separately | The reference's review missed everything already committed on the branch |
| Review passes | One pass (bugs, security, perf, quality, standards) | Pass 1: does it meet the ticket's acceptance criteria; pass 2: the reference's checklist | Spec compliance first (superpowers' two-stage review); a correct-but-wrong-feature change is the costliest miss |
| Review output | `.claude/code-reviews/*.md`, one PR comment on GitHub | Parseable `.sdlc/reviews/*.md`; one PR comment updated in place, Bitbucket Code Insights annotations, Jira verdict, `--gate` | Machine-readable findings let CI gate and Jira reflect review state |
| PR creation | Not done ("create pull request (if applicable)") | `sdlc-atl pr`, after user confirmation | Links PR ⇄ Jira deterministically; team works in Bitbucket DC and GitHub |
| When is it Done | "Ship" after PR review | Default: verified; optional `doneWhen: merged` | Teams without PR gates keep today's behaviour; PR-gated teams get the reference's order |
| Execution report location | `.claude/execution-reports/[feature].md` | `.claude/execution-reports/<ticket>-<slug>.md` | Same folder; the ticket prefix is what links the verdict to Jira |
| Small work | Implicit: any ticket can enter the PIV loop | Explicit Track B with escalation to Track A | Makes "does this need a PRD?" a deliberate decision instead of drift |
| Ticket slicing | Agent slices the PRD directly into tickets | `gsd` engine: slices via GSD ROADMAP (`granularity: fine`), then files phases as tickets. `piv` engine: as the reference | One source for the plan: tickets mirror GSD phases, so status can sync back mechanically |
| Engine choice | Its own skills only | `gsd` or `piv` | Teams can keep the reference's lighter loop or opt into GSD; the Jira/Confluence side is shared |
| Duplicate check | Compares summaries with the epic's existing children | State file, then `sdlc-item-<id>` label, then summary match | Summaries get edited in Jira; labels and state survive that |
| Reading GSD plans | n/a | Via `gsd-tools` (`roadmap analyze`, `roadmap get-phase`) rather than parsing markdown | Stays correct as GSD's format evolves |
| Plan/report ⇄ ticket link (piv) | None: plans named after the feature | File-name prefix or `Ticket:` line | Needed to sync status; smallest convention that keeps the reference's layout |

Flows may become configurable later, once we've seen how the team uses them.

## Slices

1. ✅ **Client + agent tools** (2026-09-24; 9 unit + 9 live tests).
2. ✅ **Track A ticket filing (gsd engine)** (2026-09-24; 34 tests total): `sdlc-atl file-breakdown` (items → stories under the epic, dependency
   links, idempotent, `--dry-run`) and publishing the breakdown page under the PRD.
3. ✅ **Report back** (2026-09-24; 40 tests total): `sdlc-atl sync [--dry-run]`. Status → transition map
   (default: planned/executing/needs_attention → *In Progress*, complete → *Done*; override in `.sdlc/config.json`
   `jira.transitions`), forward-only (never out of Done), verification report → `Verification: <KEY> <title>` page
   under the breakdown page, remote link + one comment per new/changed report. Triggered manually for now; slice 6
   wires it into GSD/skills.
4. ✅ **`piv` engine adapter** (2026-09-24; 63 tests total): reads `/spec` breakdowns (tolerant of the loose shapes
   agents write), plans and execution reports. Hardened on a real 36-phase GSD roadmap: canonical phase ids
   (`04.3` = `4.3`), conservative parsing of free-text "Depends on", non-fatal cycles, BOM-tolerant reads,
   parallel `gsd-tools` calls.
5. ✅ **Track B** (2026-09-25; 76 tests total): `sdlc-atl import KEY` (ticket brief `.sdlc/tickets/KEY.md` with
   acceptance criteria, recent comments and engine-specific next steps), `sync` covers imported tickets (GSD quick
   tasks / piv plans + execution reports named after the key), `publish-rca KEY` (RCA doc → Confluence page under
   "Root Cause Analyses" + comment on the bug; warns without a regression test / prevention rule), `escalate KEY --epic`.
6. ✅ **Skills + automation** (2026-09-25; 78 tests total): Claude Code plugin `plugins/sdlc` (marketplace at the repo
   root) with 12 skills (19 after slice 9): `setup`, `prd`, `spec`, `ticket`, `rca`, `fix`, `sync`, and the reference-style loop for the
   piv engine (`prime`, `plan`, `execute`, `validate`, `report`), rewritten, not copied. A bundled self-contained CLI
   and MCP launcher (esbuild) make the installed plugin work without `node_modules`. `scripts/install.ps1` serves
   other agents (`~/.agents/skills`). A git post-commit hook (`sdlc-atl hooks install`) runs `sync` in the background
   whenever a commit touches planning artifacts, for every agent and for humans. Verified with a headless Claude
   Code session loading the plugin.
7. ✅ **Cloud adapter** (2026-09-25; 87 tests total): per-product flavor (`dc` | `cloud`, detected from
   `*.atlassian.net`), Basic email + API token auth for Cloud. Jira Cloud: `/search/jql` with page tokens (old `/search`
   returns 410), epics via `parent` ("Epic Link" removed 2025; Agile epic endpoint deprecated), `accountId` identity.
   Confluence Cloud (`ConfluenceCloudClient`): v2 pages/children/properties (v1 content API removed from the spec),
   v1 kept only for CQL search and current user. MCP launcher passes Cloud credentials to mcp-atlassian.
   **Verified live on Atlassian Cloud** (2026-09-25, free site, team-managed Scrum project): all live suites pass for
   both engines (the bug/RCA scenario skips when a project has no Bug type). Confirmed on Cloud: issue-link direction
   matches DC; Epic Name not required; CQL search indexing lags ~40s (vs <1s on DC); Cloud omits `fields` when no
   requested field has a value.
8. ✅ **PR + code review, GitHub and Bitbucket Data Center** (2026-09-25; 108 tests total). Host from the `origin`
   remote. `sdlc-atl review-scope` (base...HEAD + uncommitted listed separately), `sdlc-atl pr` (create/update the
   PR titled "KEY: summary", body with Jira + verification links, Jira remote link + comment, optional review
   status), `sdlc-atl publish-review FILE [--gate]` (one PR comment updated in place; Bitbucket Code Insights report +
   line annotations; Jira verdict comment). Skills `review`, `review-fix`, `pr`; CI templates for GitHub Actions and
   Jenkins (untested). `jira.doneWhen: "merged"` keeps verified work out of Done until its PR merges. Bitbucket DC
   runs in the local stack with unattended setup and is verified live; GitHub is verified live against a private test
   repo (opt-in suite: `SDLC_GITHUB_TEST_REPO=owner/repo`).

9. ✅ **Hardening and the reference's learning layer** (2026-09-26; 221 unit tests). Safety fixes S-1..S-7 (live
   tests opt-in and local-only, race-safe state, HTTP timeouts and safe retries, markup escaping, validated keys,
   resilient forward-only sync reaching Done by status category). `AGENTS.md` as the single rules file. The
   getting-started wizard (`node setup.mjs`) for Copilot CLI / VS Code, Codex and Claude Code. Restored from the
   reference: `system-review` + `system-reviewer`, `create-rules`, plan depth (template, 6 validation levels), `e2e`,
   spec sizing and file-overlap checks, `commit`, wider `prime`, review `quality` + stats, safety/audit hooks
   (Claude Code and Copilot CLI), plugin evals.

## DC notes

- Auth: `Authorization: Bearer <PAT>`. Confluence 10 disables REST basic auth.
- Jira DC epics use the *Epic Link* custom field (discovered by name) or the Agile API `/rest/agile/1.0/epic/{key}/issue`.
- Confluence rewrites stored page text, so "unchanged" is detected with a source hash kept in a page property.
