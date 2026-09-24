# Local Jira + Confluence Data Center

A non-production Jira Software and Confluence DC stack, licensed with the company's DC developer license.
It's used to develop and test the sdlc-work Jira/Confluence bridge against the same product type that
work runs.

| Service | URL | Default version |
|---|---|---|
| Jira Software | http://jira.localhost:8080 | 10.3.25 (LTS) |
| Confluence | http://confluence.localhost:8090 | 10.2.18 (LTS) |
| Postgres 16 | localhost:5433 (host), `postgres:5432` (in network) | |

All ports bind to 127.0.0.1 only. The apps need about 8 GB of RAM together.

> **Use the `*.localhost` hostnames in the browser.** Jira and Confluence both use a `JSESSIONID` cookie, and
> browsers don't separate cookies by port. On plain `localhost`, logging into one logs you out of the other.
> Chrome, Edge, and Firefox resolve `*.localhost` to loopback without any hosts-file edits.

## First-time setup

```powershell
cd infra/atlassian-dc
./dc.ps1 init          # creates .env with random DB passwords
# optional: edit .env to match work's Jira/Confluence versions, add CONFLUENCE_LICENSE_KEY
./dc.ps1 up            # pulls images, starts, waits for /status
```

Then finish each setup wizard in the browser:

1. **Jira** (http://jira.localhost:8080): the database is already configured from env vars. Paste the Jira
   **developer license** key, create the admin user, and create a test project (e.g. key `SDLC`, Scrum
   template so Epics/Stories exist).
2. **Confluence** (http://confluence.localhost:8090): paste the Confluence developer license (unless it's set in
   `.env`), create the admin user, and create a test space (e.g. key `SDLC`).
3. In each app go to **Profile → Personal Access Tokens → Create token** and put the tokens into `.env` as
   `JIRA_PAT` / `CONFLUENCE_PAT`.

Get the license keys from the developer license in my.atlassian.com (ask the Atlassian billing/technical
contact). **Never commit `.env`**; it is gitignored.

## Day to day

```powershell
./dc.ps1 status        # container + app state
./dc.ps1 logs jira     # follow logs for one service
./dc.ps1 down          # stop, data kept in docker volumes
./dc.ps1 reset         # stop and wipe all data (asks for confirmation)
```

## Notes

- Match `JIRA_VERSION` / `CONFLUENCE_VERSION` in `.env` to production. REST API behaviour differs between
  major versions. Available tags: `atlassian/jira-software`, `atlassian/confluence` on Docker Hub.
- Changing versions upward on an existing volume runs an upgrade. Downgrading needs `./dc.ps1 reset`.
- The DB init script only runs on an empty `pgdata` volume.
