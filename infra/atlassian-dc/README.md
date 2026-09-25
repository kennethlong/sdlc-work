# Local Jira + Confluence Data Center

A non-production Jira Software and Confluence DC stack for developing and testing the sdlc-work
Jira/Confluence bridge against the same product type that work runs.

| Service | URL | Default version |
|---|---|---|
| Jira Software | http://jira.localhost:8080 | 10.3.25 (LTS) |
| Confluence | http://confluence.localhost:8090 | 10.2.18 (LTS) |
| Postgres 16 | localhost:5433 (host), `postgres:5432` (in network) | |

All ports bind to 127.0.0.1 only. The apps need about 8 GB of RAM together. Requires Docker Desktop and Node 22+.

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
5. creates an admin Personal Access Token in each app.

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

## When a 3-hour test license expires

```powershell
./dc.ps1 license all -Apply     # fetch fresh test keys and install them; data is kept
```

- **Jira:** installed via REST (`/rest/plugins/applications/1.0/installed/jira-software/license`), no restart.
- **Confluence:** rewrites `atlassian.license.message` in `confluence.cfg.xml` and restarts Confluence
  (1–2 minutes). Don't use `ATL_FORCE_CFG_UPDATE` for this: it regenerates the whole file from the image
  template, resetting `setupStep`, which sends a configured instance back into the setup wizard.

Other license helpers: `./dc.ps1 license` (fetch keys into `.env`), `./dc.ps1 license jira -Copy` (clipboard).

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
