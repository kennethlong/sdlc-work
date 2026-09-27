# Local Jira + Confluence Data Center

A non-production Jira Software and Confluence DC stack for developing and testing the sdlc-work
Jira/Confluence bridge against the same product type that work runs.

| Service | URL | Default version |
|---|---|---|
| Jira Software | http://jira.localhost:8080 | 10.3.25 (LTS) |
| Confluence | http://confluence.localhost:8090 | 10.2.18 (LTS) |
| Bitbucket DC | http://bitbucket.localhost:7990 | 9.4.24 (LTS), project `SDLC`, repo `sandbox` |
| Jenkins | http://localhost:8081 | LTS (JDK 21), job `sdlc-work-poll` |
| Postgres 16 | localhost:5433 (host), `postgres:5432` (in network) | |

All ports bind to 127.0.0.1 only. The apps need about 10 GB of RAM together. Requires Docker Desktop and Node 22+.

## One command

```powershell
cd infra/atlassian-dc
./dc.ps1 up
```

Unattended, from nothing to ready:
1. creates `.env` with random database passwords,
2. starts Postgres, Jira, and Confluence and waits for them,
3. runs both setup wizards with Playwright (headless): license, admin account, email/content/user-management choices,
4. creates Jira project `SDLC` (Scrum) and Confluence space `SDLC`,
5. creates an admin Personal Access Token in each app,
6. Bitbucket DC sets itself up from environment variables (no wizard); setup adds project `SDLC`, repo `sandbox`
   and an HTTP access token (`BITBUCKET_TOKEN`).

Everything it generates goes into `.env`: `JIRA_ADMIN_USER/PASSWORD`, `CONFLUENCE_ADMIN_USER/PASSWORD`,
`JIRA_PAT`, `CONFLUENCE_PAT`, `*_LICENSE_KEY`, `*_BASE_URL`. It is idempotent: re-running `./dc.ps1 up` or
`./dc.ps1 setup` skips what already exists.

Licensing: if `JIRA_LICENSE_KEY` / `CONFLUENCE_LICENSE_KEY` are empty, setup uses Atlassian's published
[3-hour test licenses](https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/).
Put the company **developer license** keys in `.env` before the first `up` to use those instead.

> **Use the `*.localhost` hostnames in the browser.** Jira and Confluence both use a `JSESSIONID` cookie, and
> browsers don't separate cookies by port. On plain `localhost`, logging into one logs you out of the other.

## Day to day

```powershell
./dc.ps1 creds                  # show the admin logins
./dc.ps1 status                 # container + app state
./dc.ps1 setup -Headed          # re-run setup and watch the browser (debugging)
./dc.ps1 logs jira              # follow logs for one service
./dc.ps1 down                   # stop, data kept in docker volumes
./dc.ps1 reset                  # stop and wipe all data (asks for confirmation); next `up` rebuilds everything
./dc.ps1 up -NoSetup            # containers only
```

## Jenkins: the headless work loop

`./dc.ps1 up` also builds and starts Jenkins (`jenkins/Dockerfile`: Node 24, git, uv, GitHub Copilot CLI),
configured as code (`jenkins/casc/jenkins.yaml`), with no setup wizard. Log in with `JENKINS_ADMIN_USER` /
`JENKINS_ADMIN_PASSWORD` (`./dc.ps1 creds`).

- **Job `sdlc-work-poll`** runs every 5 minutes, never concurrently: a fresh clone of `SDLC_WORK_REPO_URL`
  (default `sandbox`), then `sdlc-atl work --poll --agent copilot`. The pipeline is
  `templates/ci/jenkins/Jenkinsfile.sdlc-work` (the same file works on a work Jenkins, with credential ids as
  parameters); it is read when Jenkins starts, so restart Jenkins after editing it (`docker compose -p
  sdlc-atlassian restart jenkins`). The same goes for `npm run bundle`: the job runs the CLI the container
  installed at start (`~/.sdlc/bin`, printed as `sdlc-atl: …` in the build log).
- **Job `sdlc-work-inrepo`** is the in-repo variant: a multibranch pipeline over the sandbox repo reading
  `Jenkinsfile.sdlc-work` from it (`node scripts/demo-headless.ts --in-repo` commits it). Only `main` polls;
  feature branches build as no-ops.
- Demo: `node scripts/demo-headless.ts` commits a `.sdlc/config.json` to the sandbox repo, creates a clear and a
  vague `ai-ready` story, triggers the job and prints what happened (run `node scripts/seed-showcase.ts` first).
- **The sdlc-work repo is mounted read-only** at `/opt/sdlc-work`: at start the container installs its CLI (to
  `~/.sdlc/bin`, which the job runs) and the
  container installs the skills for the Copilot CLI and registers the MCP server (`node setup.mjs`, log in
  `$JENKINS_HOME/sdlc-setup.log`).
- **Credentials** come from `.env` as environment variables, never from the image: the Atlassian PATs, the
  Bitbucket token, and `COPILOT_GITHUB_TOKEN`, which `dc.ps1` takes from your `gh` login when empty (dev only; a
  real deployment uses a bot account's token with Copilot access). `up` recreates Jenkins after setup so it gets
  fresh tokens. The pipeline never traces commands (no token in build logs).
- **Same URLs inside:** `*.localhost` always means loopback (curl and git hard-code it), so the container forwards
  its own loopback ports 8080/8090/7990 to the app containers (`SDLC_LOCAL_FORWARDS`) and Jenkins listens on 8081.
- Stop the loop: disable the job in Jenkins, or `docker compose -p sdlc-atlassian stop jenkins`.

## Licenses

**Test (timebomb) licenses last 3 hours per instance and cannot be renewed in place.** The 3 hours count from
when the instance first sees the key, so re-applying it is rejected ("This license has expired"). An expired
instance goes read-only. To keep going on test keys, get a fresh instance (about 7 minutes, **wipes data**):

```powershell
./dc.ps1 rebuild                # down -v + up; keeps admin passwords and keys in .env, makes new PATs
```

Our tests create and delete their own data, so rebuilding is cheap for development. For data that should last,
use the **developer license**: put the keys in `.env` (`JIRA_LICENSE_KEY`, `CONFLUENCE_LICENSE_KEY`), then either
`./dc.ps1 rebuild` (fresh instance) or install them into the running one, keeping its data:

```powershell
./dc.ps1 license all -Apply     # installs the keys from .env; fetches a test key only when none is set (-Fetch forces it)
```

- **Jira:** installed via REST (`/rest/plugins/applications/1.0/installed/jira-software/license`), no restart.
- **Confluence:** rewrites `atlassian.license.message` in `confluence.cfg.xml` and restarts Confluence
  (1–2 minutes). Don't use `ATL_FORCE_CFG_UPDATE` for this: it regenerates the whole file from the image
  template, resetting `setupStep`, which sends a configured instance back into the setup wizard.

Other license helpers: `./dc.ps1 license` (fetch test keys into `.env`), `./dc.ps1 license jira -Copy` (clipboard).

## How setup works (`setup/`)

TypeScript run directly by Node (type stripping, no build step). `src/setup.ts` orchestrates; `jira.ts` and
`confluence.ts` hold the wizard steps; `wizard.ts` identifies each wizard page by URL **plus heading** (Jira
changes pages without changing the URL) and stops with a screenshot in `setup-debug/` on anything unexpected.

Worth knowing if you touch it:
- Confluence 10 disables REST basic auth. Setup logs in through the browser once, creates a PAT with an
  in-page `fetch` (session-cookie requests from outside the page fail the XSRF check), and uses the PAT after that.
- Jira keeps wizard progress per browser session, so re-running mid-wizard replays earlier steps harmlessly.

## Notes

- Match `JIRA_VERSION` / `CONFLUENCE_VERSION` in `.env` to production; REST behaviour differs between majors.
  A new major may need wizard selector updates in `setup/src/`.
- Changing versions upward on an existing volume runs an upgrade. Downgrading needs `./dc.ps1 reset`.
- A second stack (e.g. for testing setup changes): `./dc.ps1 up -EnvFile other.env -Project sdlc-atlassian-dev`
  with different `*_PORT` values in `other.env`.
