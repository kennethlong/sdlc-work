# Design: Atlassian bridge (Jira + Confluence Data Center)

Status: draft, 2026-09-24. Target: Jira Software DC 10.3, Confluence DC 10.2 (local stack in `infra/atlassian-dc`).
Cloud later behind the same interfaces.

## Two layers

| Layer | What | Why |
|---|---|---|
| **Agent tools** | [`mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) (MIT, DC + PAT, ~98 tools) launched via `scripts/mcp-atlassian.mjs`, which loads URLs/PATs from `infra/atlassian-dc/.env` | Ad-hoc "read this ticket / search Confluence" for any MCP-capable agent (Claude Code, Codex, Cursor, Copilot). Already solved, so don't rebuild |
| **Bridge** (`packages/atlassian`, TypeScript) | Typed DC client for just the endpoints we need, plus deterministic sync between Jira/Confluence and GSD `.planning/` | Repeatable, testable, idempotent operations must not depend on an LLM choosing tools. Nobody else does GSD ⇄ Jira |

## Source-of-truth split

- **Jira/Confluence own the WHAT:** epics, stories, acceptance criteria, PRDs.
- **GSD `.planning/` owns the HOW and the progress:** phases, plans, execution, verification.
- The bridge moves WHAT into planning (import) and progress back out (status, comments, published reports).

## Proposed mapping (to confirm)

| Jira / Confluence | GSD |
|---|---|
| Epic | Milestone (ROADMAP milestone, REQUIREMENTS scope) |
| Story under the epic | Phase (vertical slice with its own success criteria) |
| Story acceptance criteria | Phase success criteria + REQ-IDs in REQUIREMENTS.md |
| Sub-task | Plan within the phase (optional; plans are often finer than anyone wants in Jira) |
| Confluence PRD page | Input to `gsd-ingest-docs` / PROJECT.md |
| Confluence child pages | Published phase VERIFICATION / milestone summary |

Status sync (GSD → Jira): phase planned → *In Progress*, verified → *Done*; SUMMARY/VERIFICATION posted as a
comment and linked Confluence page. Mapping state kept in `.planning/atlassian.json` (issue key ⇄ phase dir), so
re-runs are idempotent.

## Slices

1. ✅ **Client + agent tools** (done 2026-09-24; 9 unit + 9 live tests): DC client (issues, JQL, transitions, comments, links, epic children; pages, CQL,
   create/update with markdown→storage), `mcp-atlassian` launcher, integration tests against the local stack.
2. **Import:** `sdlc-atl import-epic <KEY>` seeds or updates `.planning` from an epic and its stories.
3. **Sync out:** `sdlc-atl sync` pushes phase status, comments, and Confluence reports; idempotent via `atlassian.json`.
4. **Skills:** portable SKILL.md wrappers (`/jira-import`, `/jira-sync`) and a GSD hook point.
5. **Cloud adapter:** same interfaces, Cloud auth and endpoints.

## DC notes

- Auth: `Authorization: Bearer <PAT>`. Confluence 10 disables REST basic auth.
- Jira DC epics use the *Epic Link* custom field (id varies per instance; discover via `/rest/api/2/field`) or the
  Agile API `/rest/agile/1.0/epic/{key}/issue`.
- Writes need `X-Atlassian-Token: no-check`.
