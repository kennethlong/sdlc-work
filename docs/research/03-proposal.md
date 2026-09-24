# Proposal: direction for `sdlc-work` (DRAFT, for discussion)

## Positioning

Don't compete with Spec Kit, GSD, or BMAD on planning ceremony; they are mature and one (GSD) is already
installed here. Take the starter pack's strongest ideas (rules derived from code, PIV-sized tickets, the
bug-to-rule learning loop) and **extend it across the whole lifecycle**, especially the phases nobody covers:
security, release, ops feedback, tracker sync, and measurement. Ship it as a **Claude Code plugin marketplace
of portable Agent Skills**, so it also runs in Codex, Gemini CLI, and Copilot.

## Proposed shape

```
sdlc-work/
├─ .claude-plugin/marketplace.json     # one repo, several installable plugins
├─ plugins/
│  ├─ sdlc-core/        # state dir + orchestration: prime, create-rules, spec, plan, execute, validate, commit, pr
│  ├─ sdlc-review/      # diff-scoped review → verify findings → fix loop; security-review; CI workflows
│  ├─ sdlc-test/        # test strategy, Playwright agents, mutation-guided test gen, flaky triage
│  ├─ sdlc-release/     # changelog/release notes, versioning, rollout checklist, rollback plan
│  ├─ sdlc-ops/         # incident intake (Sentry/GitHub/Jira) → rca → rule + regression test
│  ├─ sdlc-learn/       # execution report, system review, compound step, metrics
│  └─ sdlc-guard/       # hooks: secret/destructive guard, format-on-edit, Stop gate, SessionStart, audit JSONL
├─ packages/sdlc-cli/   # TypeScript: state machine, tracker adapters, artifact schemas, `sdlc status`
├─ scripts/             # PowerShell install/bootstrap for Windows (+ sh equivalents)
├─ evals/               # per-skill with/without evals (claude plugin eval / promptfoo)
└─ docs/
```

**One state directory per consuming repo** (e.g. `.sdlc/`) replaces the starter pack's seven scattered paths:

```
.sdlc/
  state.json                 # current ticket, phase, gate results (schema-validated)
  tickets/<id>/ spec.md plan.md execution-report.md review.md verification.md
  rca/<id>.md
  metrics.jsonl
```

## Language choices (case by case)

| Concern | Choice | Why |
|---|---|---|
| Hooks (run on every tool call) | **Python** single-file `uv` scripts, or TypeScript bundled to one `.mjs` | Fast cold start and cross-platform. PowerShell cold start (~300–500 ms) is too slow per tool call |
| CLI, state machine, schemas, tracker adapters | **TypeScript** (Node 22, zod) | Typed artifact schemas, the MCP/GitHub/Jira SDKs are TS-first, and it matches the plugin ecosystem |
| Windows install/bootstrap, dev-machine setup | **PowerShell 7** | Native on Windows; provide `.sh` twins for CI/Linux |
| Eval harness and data wrangling | **Python** or TS (promptfoo is TS) | Decide when we build `evals/` |
| Skills | Markdown (SKILL.md) | Portable across agents |

## Candidate roadmap

1. **Foundation:** port the starter-pack skills into `sdlc-core`, fixing the defects in 01 (generic reviewer,
   unified `.sdlc/` paths, diff base...HEAD, Windows-safe commands, Atlassian `/v2/mcp`). Package as a plugin.
2. **Guardrails:** rewrite hooks (JSONL audit log, broader destructive-command coverage including the
   PowerShell tool, Stop gate with an attempt counter, format-on-edit), with unit tests.
3. **Orchestration:** `sdlc-cli` state machine with gates (spec → plan → execute → validate → review → PR),
   a fresh subagent per task, atomic commits, and resume.
4. **Tracker abstraction:** GitHub Issues + Jira (+ Linear), two-way status sync.
5. **Review & security:** verify-before-report review, security review, CI workflows via claude-code-action.
6. **Test depth:** Playwright agents, mutation-guided tests, requirement-derived property tests.
7. **Release & ops:** release notes/changelog, rollout checklist; incident → RCA → rule → regression test.
8. **Measurement:** OTel preset, `metrics.jsonl`, per-skill evals in CI.

## Decisions (2026-09-24)

- **Tracker:** Jira + Confluence **Data Center** (self-hosted at work). The official Rovo MCP server is
  Cloud-only, so the Jira/Confluence bridge must target the DC REST API with Personal Access Tokens, either
  via a community MCP server (e.g. `sooperset/mcp-atlassian`, to be verified) or our own thin TS adapter.
  Local testing uses Jira Software and Confluence DC in Docker with free trial licenses. Keep the adapter
  interface tracker-agnostic so Cloud can be added later.
- **Portability:** portable to other agents from day one (Agent Skills + AGENTS.md; no Claude-only features in core skills).
- **Starter pack:** rewrite, using it as inspiration only. No copied content, so its missing license doesn't matter.
- **GSD:** recommended to build on **GSD Core** (`@opengsd/gsd-core`, the community continuation) as the
  plan/execute engine behind an adapter, and to spend our effort on the Jira/Confluence bridge and the phases GSD lacks.
  Confirmed. Migrated this machine from `get-shit-done-cc@1.42.3` to `@opengsd/gsd-core@1.14.0` on 2026-09-24;
  the existing `.planning/` projects read cleanly under the new version.

## Open questions

- Which tracker(s) are real for you: Jira/Confluence, GitHub Issues, Linear?
- Target agents: Claude Code only, or portable to Codex/Copilot/Gemini from day one?
- Fork the starter pack's content (license terms needed) or rewrite from scratch using it as inspiration?
- Relationship to GSD: build on it, borrow its patterns, or stay independent?
- Target consumer stacks (the reviewers and validators need per-stack knowledge)?
