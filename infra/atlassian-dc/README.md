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

## Test licenses until the developer license arrives

Atlassian publishes [timebomb licenses](https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/)
for testing: 10 users, **valid 3 hours from when applied**. `dc.ps1` fetches them from that page:

```powershell
./dc.ps1 license                    # fetch current keys into .env (JIRA_LICENSE_KEY, CONFLUENCE_LICENSE_KEY)
./dc.ps1 license jira -Copy         # also copy the Jira key to the clipboard, for the setup wizard
./dc.ps1 license confluence -Copy
./dc.ps1 license all -Apply         # install fresh keys into already-set-up instances (after expiry)
```

`-Apply` needs the instance past its setup wizard:
- **Jira:** installed via REST (`/rest/plugins/applications/1.0/installed/jira-software/license`), no restart.
  Needs `JIRA_PAT` for an admin user, or `JIRA_ADMIN_USER`/`JIRA_ADMIN_PASSWORD`, in `.env`.
- **Confluence:** rewrites `atlassian.license.message` in `confluence.cfg.xml` and restarts Confluence
  (about 1–2 minutes). Don't use `ATL_FORCE_CFG_UPDATE` for this: it regenerates the whole file from the image
  template, resetting `setupStep`, which sends a configured instance back into the setup wizard.

When the real developer license arrives, paste it in each app's license admin page. The data is kept.

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
