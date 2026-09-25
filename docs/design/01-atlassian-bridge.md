# Design: Atlassian bridge (Jira + Confluence Data Center)

Status: flow agreed 2026-09-24. Targets Jira Software DC 10.3 and Confluence DC 10.2 (local stack in
`infra/atlassian-dc`), with Cloud later behind the same interfaces.

## Two layers

| Layer | What | Why |
|---|---|---|
| **Agent tools** | [`mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) (MIT, DC + PAT) launched by `scripts/mcp-atlassian.mjs` | Ad-hoc "read this ticket / search Confluence" for any MCP-capable agent. Already solved, so we don't rebuild it |
| **Bridge** (`packages/atlassian`) | Typed DC client plus deterministic steps between Confluence/Jira and GSD `.planning/` | Repeatable, idempotent operations shouldn't depend on an LLM choosing tools |

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

Mapping state (issue key ⇄ phase dir, page ids) lives in `.planning/atlassian.json` so every step is re-runnable.

## Deviations from the reference

| Topic | Reference | Ours | Why |
|---|---|---|---|
| Planning/execution engine | Own skills (`plan-feature`, `execute`, `validate`) | GSD Core | GSD already does this better: plan checker, fresh-context parallel waves, atomic commits, goal-backward verification. Rewriting it would waste effort |
| Status back to Jira | None: ends at the GitHub PR | Transitions + Confluence verification reports | The team lives in Jira/Confluence. Progress should be visible there without asking an engineer |
| Bug intake | GitHub Issues (`gh issue view`) | Jira Bugs | The team tracks bugs in Jira |
| Small work | Implicit: any ticket can enter the PIV loop | Explicit Track B with escalation to Track A | Makes "does this need a PRD?" a deliberate decision instead of drift |
| Ticket slicing | Agent slices the PRD directly into tickets | Slices via GSD ROADMAP (`granularity: fine`), then files phases as tickets | One source for the plan: tickets mirror GSD phases, so status can sync back mechanically |

Flows may become configurable later, once we've seen how the team uses them.

## Slices

1. ✅ **Client + agent tools** (2026-09-24; 9 unit + 9 live tests).
2. **Track A ticket filing:** `file-roadmap` (phases → stories under the epic, idempotent) and publishing the
   breakdown page under the PRD.
3. **Report back:** `sync` (status transitions, verification pages, links) via `.planning/atlassian.json`.
4. **Track B:** `import-story` / `import-bug` into GSD, and an RCA skill writing to Jira.
5. **Skills:** portable SKILL.md wrappers (`/spec`, `/jira-sync`, `/rca`) and GSD hook points.
6. **Cloud adapter.**

## DC notes

- Auth: `Authorization: Bearer <PAT>`. Confluence 10 disables REST basic auth.
- Jira DC epics use the *Epic Link* custom field (discovered by name) or the Agile API `/rest/agile/1.0/epic/{key}/issue`.
- Confluence rewrites stored page text, so "unchanged" is detected with a source hash kept in a page property.
