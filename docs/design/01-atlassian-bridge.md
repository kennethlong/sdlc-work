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
| `piv` | Reference-style skills (prime → plan-feature → execute → validate) | `docs/specs/<epic>.md` tickets (the reference's `/spec` output) | `.claude/plans/` = planned; `.claude/execution-reports/` ✓/✗ "Validation Results" = verdict | ✅ Slice 4 |

The same live test suite (filing + sync lifecycle) runs against both engines' fixtures.

**piv artifact ⇄ ticket linking (deviation):** the reference never records which ticket a plan or execution report
belongs to (plans are named after the feature). An artifact belongs to a ticket when its file name starts with
the ticket id or its filed Jira key (`ticket-1-…`, `sdlc-5-…`), or it has a `Ticket: TICKET-1` line. Merely
mentioning a ticket ("depends on TICKET-1") does not link it. Our rewritten PIV skills (slice 6) will follow this.

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

- **Small feature:** Jira Story → `import-story <KEY>` pulls the summary, description and acceptance criteria into
  GSD as a quick task or a single phase → plan → execute → verify → report back to the story. This is the
  reference's per-ticket loop, where `/prime <jira-key>` reads the ticket.
- **Bug:** Jira Bug → **RCA** (the reference's `/rca`: root cause, fix strategy, regression test) → fix
  (`implement-fix`) → verify → report back, and **every bug becomes a rule + regression test** (the reference's
  learning loop).
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
| Distribution | Copy `.claude/` into each repo | Plugin (marketplace) + `install.ps1` for other agents; skills namespaced `/sdlc:*` | Versioned, one-command install and updates; portable across agents |
| Automation | Manual skill invocation | git post-commit hook runs `sync` | Status follows the work without anyone remembering; agent-agnostic |
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
   root) with 12 skills: `setup`, `prd`, `spec`, `ticket`, `rca`, `fix`, `sync`, and the reference-style loop for the
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
   **Verified against contract fakes only**; to verify live, point `~/.sdlc/atlassian.env` at a (free) Cloud site
   and run the live suites. Unconfirmed until then: issue-link direction on Cloud, whether a site still requires
   Epic Name.

## DC notes

- Auth: `Authorization: Bearer <PAT>`. Confluence 10 disables REST basic auth.
- Jira DC epics use the *Epic Link* custom field (discovered by name) or the Agile API `/rest/agile/1.0/epic/{key}/issue`.
- Confluence rewrites stored page text, so "unchanged" is detected with a source hash kept in a page property.
