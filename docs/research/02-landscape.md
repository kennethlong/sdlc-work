# Landscape: AI SDLC frameworks, skills, and tools (Sept 2026)

Condensed from two research passes on 2026-09-24. Star counts are approximate. Items marked (unverified)
were not confirmed against a primary source.

## Spec-driven / lifecycle frameworks

| Framework | Pitch | License / tooling | Notable |
|---|---|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) (~139k★) | constitution → specify → clarify → plan → tasks → implement | MIT / Python CLI | De-facto SDD standard, 30+ agents, `[P]` parallel tasks, `/analyze` cross-artifact check. Weak on brownfield, specs drift |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) (~53k★) | Simulated agile team of persona agents | MIT / Node | Widest role coverage (Analyst, PM, Architect, SM, Dev, QA). Heavy ceremony |
| [GSD / GSD Core](https://github.com/open-gsd/gsd-core) | Context engineering: discuss → plan → execute → verify → ship | MIT / TS | **Already installed in this environment.** Ambiguity-scored specs, plan checker, wave-parallel fresh-context executors, atomic commits, goal-backward verification, Nyquist test audit, threat-model audit, forensics, learnings. Huge command surface |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) (~70k★) | Brownfield-first change proposals | MIT / TS | **Delta specs** (ADDED/MODIFIED/REMOVED) archived into living specs |
| [AWS Kiro](https://kiro.dev) | Agentic IDE with spec mode | Commercial | EARS acceptance criteria, **property-based tests from requirements**, steering files, event hooks, headless CLI |
| [Tessl](https://tessl.io) | Skill/spec registry + package manager | Commercial | **Evals that run tasks with vs. without a skill** |
| [Agent OS](https://github.com/buildermethods/agent-os) | Standards discovery + injection | MIT / shell | Good at codifying house style |
| [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) (~24k★) | 30 commands, 20 personas | MIT / Python | Broad but ungated |
| [Ruflo (claude-flow)](https://github.com/ruvnet/ruflo) (~73k★) | Swarm orchestration + vector memory | MIT / TS+Rust | Ambitious, hard to audit |
| [Taskmaster AI](https://github.com/eyaltoledano/claude-task-master) (~28k★) | PRD → dependency task graph | MIT + Commons Clause | Planning only |
| [obra/superpowers](https://github.com/obra/superpowers) | Discipline skills: TDD, subagent-per-task, 2-stage review | MIT / md | Rigorous "iron laws", verification-before-completion |
| [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) (~25k★) | plan → work → review → **compound** | MIT | Best learning loop: every change leaves docs/rules behind |
| [cc-sdd](https://github.com/gotalab/cc-sdd) | Portable Kiro-style SDD | MIT | Implementer + independent reviewer per task; debug agent after 2 rejections |
| [Google Conductor](https://github.com/gemini-cli-extensions/conductor) | Context → tracks (spec + plan) | Apache? (unverified) | Gemini CLI + Claude Code |
| Ralph loops | Fresh agent per iteration reading specs from disk | various | Simplest autonomous pattern; `/loop` is now built in |

### Phase coverage (● strong ◐ partial ○ none)

| | PRD | Arch | Tasks | Impl | Test | Review | Sec | Docs | Release | Ops | Retro |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **starter-pack** | ◐ | ◐ | ● | ◐ | ◐ | ◐ | ○ | ○ | ○ | ◐ | ● |
| Spec Kit | ● | ● | ● | ● | ◐ | ◐ | ○ | ◐ | ○ | ◐ | ○ |
| BMAD | ● | ● | ● | ● | ● | ◐ | ○ | ◐ | ○ | ○ | ◐ |
| GSD | ● | ◐ | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ● |
| OpenSpec | ◐ | ● | ● | ● | ○ | ◐ | ○ | ● | ○ | ○ | ○ |
| Kiro | ● | ● | ● | ● | ● | ◐ | ○ | ◐ | ◐ | ○ | ○ |
| superpowers | ● | ◐ | ● | ● | ● | ● | ○ | ○ | ◐ | ● | ○ |
| Compound Eng. | ● | ◐ | ● | ● | ◐ | ● | ◐ | ◐ | ◐ | ○ | ● |

## Building blocks and point tools

**Packaging:** [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces). A
`.claude-plugin/marketplace.json` lists plugins; each plugin has `.claude-plugin/plugin.json` plus
`skills/ agents/ commands/ hooks/hooks.json .mcp.json`. Users install with `/plugin marketplace add org/repo`.
`claude plugin eval` runs a plugin's eval suite with and without the plugin (verify the CLI syntax).

**Portability:** the [Agent Skills standard](https://agentskills.io) (SKILL.md) is read by Claude Code, Codex,
Gemini CLI, Copilot, Cursor, Goose, and Factory. [AGENTS.md](https://agents.md) is the cross-tool rules file,
and Claude Code falls back to it.

**Collections to mine:** [wshobson/agents](https://github.com/wshobson/agents) (multi-harness layout),
[VoltAgent subagents](https://github.com/VoltAgent/awesome-claude-code-subagents),
[awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code),
[claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery),
[anthropics/skills](https://github.com/anthropics/skills) (skill-creator, webapp-testing).

**MCP servers:** GitHub MCP, Atlassian Rovo MCP (GA; **endpoint moved to `/v2/mcp`**, and the starter pack
still points at `/v1/mcp`), Linear, Sentry, [Playwright MCP](https://github.com/microsoft/playwright-mcp),
Context7, [Semgrep MCP](https://github.com/semgrep/mcp), Snyk Studio, and [snyk/agent-scan](https://github.com/snyk/agent-scan)
for vetting third-party skills and MCP servers.

**Per phase:**
- *PR review:* [claude-code-action v1](https://github.com/anthropics/claude-code-action) (CI backbone),
  managed Claude Code Review / `/code-review ultra`, and CodeRabbit, Greptile, Qodo, Copilot (buy, don't build).
- *Testing:* [Playwright Test Agents](https://playwright.dev/docs/test-agents) (planner/generator/healer;
  `npx playwright init-agents --loop=claude`), [Meta ACH](https://arxiv.org/abs/2501.12862) (mutation-guided test gen,
  a pattern to copy with Stryker), Kiro-style property-based tests.
- *Security:* [claude-code-security-review](https://github.com/anthropics/claude-code-security-review) Action,
  Semgrep, Snyk.
- *CI:* Nx self-healing CI pattern (classify the failure, propose a fix, verify by re-running, then push).
- *Release:* release-please or changesets plus an LLM rewrite of the release notes.
- *Ops:* Sentry Seer, Datadog Bits AI SRE, PagerDuty, incident.io (buy). Copy a runbook skill that uses observability MCPs.
- *Evals and telemetry:* [promptfoo](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/) and
  [Claude Code OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage) (`CLAUDE_CODE_ENABLE_TELEMETRY=1`).
- *Background agents:* Claude Code on the web, Routines/`/schedule`, Copilot coding agent, Codex cloud, Devin.
  All read AGENTS.md and skills, so keep ours portable.

## Patterns worth stealing

1. Constitution/steering file loaded every session (Spec Kit, Kiro, Agent OS).
2. Ambiguity pass before planning (`/clarify`, GSD ambiguity score).
3. Testable requirement syntax: EARS / Given-When-Then (Kiro, OpenSpec).
4. Delta specs merged into living specs on archive (OpenSpec).
5. Cross-artifact consistency check and plan checker (Spec Kit `/analyze`, GSD).
6. Fresh-context subagent per task; lean orchestrator (GSD, superpowers, Ralph).
7. Wave-parallel execution from a dependency graph.
8. Atomic commit per task with a manifest for safe undo (GSD).
9. Two-stage independent review (spec compliance, then quality) with bounded retries and escalation.
10. Goal-backward verification: check outcomes, not checkboxes (GSD).
11. Requirement-derived property-based tests; TDD iron laws.
12. Event hooks (on save, on commit) as deterministic triggers (Kiro).
13. Scale-adaptive tracks: quick path vs. full ceremony.
14. STATE.md pause/resume handoff.
15. "Compound" step: every change leaves a rule or doc behind.
16. Skills evaluated with vs. without (Tessl, `claude plugin eval`).

## Gaps nobody covers well (our opportunity)

- **Production → spec feedback:** incidents and telemetry feeding RCA, then rules, then regression tests, automatically.
- **Release and deploy:** changelog governance, feature flags, staged rollout, rollback criteria.
- **Two-way tracker sync** (Jira/Linear/GitHub status reflects agent state; epics map to specs).
- **Spec–code drift detection in CI.**
- **Security tied to requirements:** threat model → controls → verified in code → SAST/SCA gates.
- **Team concurrency:** multiple devs and agents on parallel specs, ownership, merge ordering.
- **Outcome metrics:** rework rate, defect escape, cost per ticket, and proof the toolset beats the baseline.
- **Non-functional requirements** (perf, a11y, compliance) as verifiable spec items.
