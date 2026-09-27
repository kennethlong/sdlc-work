# Headless: AI works labelled stories into draft PRs (Data Center)

Atlassian's hands-off coding agent (Rovo Dev) only runs on Cloud. This does the same on Jira and Bitbucket Data
Center with the AI tool the team already uses (GitHub Copilot CLI by default; Claude Code or Codex also work).

## How it works

```
Jira DC                    CI job (Jenkins), every few minutes                  Bitbucket DC
─────────                  ───────────────────────────────────                  ────────────
Story labelled  ──poll───▶ sdlc-atl work --poll
"ai-ready"                   1. claim: assign to the bot, In Progress, comment with the build link
                             2. branch feature/KEY-slug, write the ticket brief
                             3. agent runs the sdlc-ticket skill headless (plan, code, validate, report, commit)
   ◀── questions ──────────  4a. unclear story: questions as a comment, label ai-needs-info, stop
                             4b. gate: commits + a passing execution report
                             5. push the branch, draft PR, review, verification page ──▶ draft PR
   ◀── "Ready for review" ── 6. story to the review status (never Done), label ai-done
```

A story without acceptance criteria is asked for them before any agent runs (`work.requireAcceptanceCriteria`,
default on): left to the model, whether a vague story gets questions varies from run to run. A human reply to the
questions makes the story eligible again; the next run reads the whole conversation from the
brief. Nothing is ever merged or pushed to the base branch: people review the draft PR.

## Labels

| Label | Meaning |
|---|---|
| `ai-ready` | Please work this story (you add it) |
| `ai-running` | A run has claimed it |
| `ai-needs-info` | The agent asked questions in a comment; reply to continue |
| `ai-done` | A draft PR is open for review |
| `ai-failed` | The run stopped; the comment says why (the branch is pushed if there was work) |
| `ai-skipped` | Not eligible for an unattended run; the comment says why |

## Configuration (`.sdlc/config.json`)

```json
{
  "jira": { "projects": ["SHOP"], "transitions": { "review": "In Review" } },
  "work": {
    "agent": "copilot",
    "issueTypes": ["Story", "Task", "Bug"],
    "maxPoints": 3,
    "components": ["web"],
    "timeoutMinutes": 45,
    "maxPerRun": 1
  }
}
```

- `agent`: `copilot` (default), `claude` or `codex`; `agentCommand` runs anything else (`{prompt}`, `{promptFile}`).
- `jql`: the poll query; default: the configured projects, `ai-ready` (or answered `ai-needs-info`), not running, not Done.
- Eligibility: `issueTypes`, `maxPoints` (the "Story Points" field), `components` (any match).
- **Kill switch:** `"enabled": false`, or `SDLC_WORK=off` in the CI environment.

## Running it

- One story: `sdlc-atl work SHOP-12` (in a clean clone; it switches branches). `--agent`, `--force` (skip eligibility).
- Polling: `sdlc-atl work --poll`, from a scheduled CI job in a fresh clone (see
  `templates/ci/jenkins/Jenkinsfile.sdlc-work`). One job per repository; no concurrent builds.
- CI needs: Node 22+, git, uv, the agent CLI with the sdlc skills (`node setup.mjs --yes --agents copilot
  --skip-credentials`), and these secrets as environment variables: `JIRA_BASE_URL`, `JIRA_PAT`,
  `CONFLUENCE_BASE_URL`, `CONFLUENCE_PAT`, `BITBUCKET_BASE_URL`, `BITBUCKET_TOKEN`, and the agent's credential
  (Copilot CLI: `COPILOT_GITHUB_TOKEN`, a bot account's token with Copilot access).
- The clone must be able to push: `git config http.extraHeader "Authorization: Bearer $BITBUCKET_TOKEN"`.

## Jenkins: a job, or a Jenkinsfile in the repo

- **In the repo (multibranch / organisation folders):** commit `templates/ci/jenkins/Jenkinsfile.sdlc-work-inrepo`
  as `Jenkinsfile.sdlc-work` (or merge its stage into the repo's `Jenkinsfile`) and point the build system at that
  script path. Jenkins checks the repo out; only the main branch gets the 5-minute timer and runs the stage
  (`SDLC_WORK_BRANCH` to change it); the bot's `feature/*` branches build as no-ops. The workspace is reset before
  each run.
- **A standalone job:** `templates/ci/jenkins/Jenkinsfile.sdlc-work` clones `REPO_URL` itself each time.

Both take the same credential ids (secret text) and read the base URLs from the environment.

## Without Jenkins

`sdlc-atl work` is an ordinary command; Jenkins is only a scheduler. For a pilot, a dedicated clone of the repo on
any machine with the AI CLI and the tokens will do:

```powershell
git clone <repo> C:\sdlc-runner\shop; cd C:\sdlc-runner\shop    # its own clone: the runner switches branches
sdlc-atl work --poll --every 5          # keep polling; Ctrl-C stops after the current story
```

`--every` rereads `.sdlc/config.json` each round (so `work.enabled: false` stops it) and carries on when Jira is
briefly unreachable. A scheduled task running `sdlc-atl work --poll` every few minutes works too.

## Several jobs, one Jira

Run one CI job per repository, each with a query (`work.jql`, or `jira.projects`) that selects only that repo's
stories, e.g. by component. If queries overlap anyway, the **claim check** keeps a story to one runner: each run
re-reads the story, writes a claim (an invisible issue property, `sdlc.work.claim`, with its build link), waits
(`work.claimSettleSeconds`, default 5) and reads it back. Only the last write survives, so exactly one runner
proceeds; the others report the story as `busy` and move on. The claim is released when the run ends. A runner
that dies leaves its claim behind: after the time limit plus 15 minutes it counts as stale, the poll query picks
the story up again, and the next run takes it over.

## Guardrails

- **A bot account** for Jira, Bitbucket and Copilot with the least permissions that work; no production secrets on
  the runner.
- **Draft PRs only**, with branch protection and required human review on the base branch.
- **Eligibility** limits what gets picked up; the **kill switch** stops it at once.
- **Limits:** one story at a time, a time limit per run, `git push` denied to the agent (the runner pushes).
- **Audit:** every step is a Jira comment with the build link; the plugin's safety hook blocks secret reads and
  destructive commands where the plugin is loaded.
