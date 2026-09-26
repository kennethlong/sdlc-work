---
name: e2e
description: Check a user-facing change end to end in a real browser - start the app, drive the plan's happy and error paths, assert what the user should see, save screenshots as evidence, and report ✓/✗ lines for the execution report. Validation level 6; /sdlc:validate runs it when the plan lists E2E flows. Use after the change is built and the unit/integration levels pass.
argument-hint: "[ticket key or plan path]"
---

# E2E: prove it works the way a user will use it

Unit tests show the code does what the code says. This shows the feature does what the ticket says, in a
real browser, against the running app. Only for user-facing changes; for anything else report "not applicable".

Input: `$ARGUMENTS`, a ticket key or plan path. Read the plan's **Tests → E2E** section (flows, assertions,
screenshot moments) and the ticket's acceptance criteria. No plan? Derive the flows from the acceptance
criteria and say so in the report.

## 1. Pick the browser tool

Use the first one available, and say which:

1. **Playwright MCP** (tools like `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
   `browser_take_screenshot`, `browser_console_messages`). Works natively on **Windows**, macOS and Linux.
   Not configured? The user can add it once: `npx @playwright/mcp@latest` as an MCP server in their tool
   (Claude Code: `claude mcp add playwright -- npx @playwright/mcp@latest`; Copilot CLI:
   `copilot mcp add playwright -- npx @playwright/mcp@latest`; Codex: `codex mcp add playwright -- npx @playwright/mcp@latest`).
2. **agent-browser** CLI (`npm i -g agent-browser && agent-browser install`): `open`, `snapshot -i`, `click @e1`,
   `fill @e2 "text"`, `wait --text …`, `screenshot <path>`, `errors`, `close`. On **Windows** it needs WSL
   (it uses Unix domain sockets); prefer Playwright MCP there.
3. The project's own browser tests (`npx playwright test <spec>`, Cypress) if the flow is already covered or
   worth adding as a permanent test. Prefer adding a test when the repo already has a browser test suite.

If none is available, don't fake it: report E2E as not run (no ✓/✗ symbol), with what the user needs to install.

## 2. Start the app

- Find the start command and port: AGENTS.md, `package.json` scripts (`dev`, `start`, `preview`), README,
  docker-compose. Reuse an app that is already running on the expected port.
- Start it **in the background** so you can keep working (Claude Code: a background shell; elsewhere a second
  terminal). Windows PowerShell: `Start-Process npm -ArgumentList 'run','dev' -PassThru` and note the process id.
- Wait until it answers before driving it: poll the URL (`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:<port>/`
  on Windows, `-o /dev/null` elsewhere) for up to about a minute. Prefer `127.0.0.1` over `localhost` if the
  app binds IPv4 only.
- Seed or log in as the plan says. Never use real customer data or production credentials.

## 3. Drive each flow

For every flow in the plan (happy path first, then each error/edge path):

1. Navigate to the entry URL.
2. Take a snapshot to find the elements; interact by accessible role/name or snapshot ref, not brittle CSS.
3. Perform the steps (fill, click, submit). Wait for the result (text, URL, network idle), not for fixed times.
4. **Assert** the outcome the plan names: visible text, URL, element state, a download, a row in a table.
   A flow passes only if its assertion holds.
5. **Screenshot** at the moments the plan lists (at least the final state of each flow).
6. Re-snapshot after navigation: element refs go stale.

After all flows, collect **console errors** (Playwright: console messages at error level; agent-browser:
`errors`). A new uncaught error fails the E2E check even if the flows passed.

## 4. Evidence

Save screenshots to `.claude/e2e/<ticket>/` (lower-cased key, like the plan), named
`<nn>-<flow>-<moment>.png`, e.g. `.claude/e2e/sdlc-12/01-export-happy-path-done.png`. Screenshots can be large:
suggest adding `.claude/e2e/` to `.gitignore` unless the team wants them in the repo.

## 5. Clean up

Close the browser, and stop the app if you started it (Windows: `Stop-Process -Id <id>`; stop child `node`
processes too). Leave an app the user already had running alone.

## 6. Report

One ✓/✗ line per flow plus console errors, ready to paste into the execution report's **Validation Results**
(`/sdlc:report`; `sdlc-atl sync` counts every ✓/✗ line there, so write the symbol only for checks you ran):

```
- E2E (browser, Playwright MCP): ✓ happy path: CSV downloads with 3 rows
- E2E: ✓ empty report shows "No rows to export"
- E2E: ✗ unauthorized user still sees the Export button (expected hidden)
- E2E console errors: ✓ none
Evidence: .claude/e2e/sdlc-12/ (4 screenshots)
```

On a ✗: say what you saw versus what was expected, with the screenshot path. Fix the cause and re-run the
flow, or hand it back to `/sdlc:execute`; never loosen the assertion to get green.

**gsd engine:** GSD Core's `gsd-dom-verifier` (its live-DOM UAT capability) checks acceptance criteria in a
browser after each execution wave and writes `DOM-VERIFY.md`. When it ran, read that file and carry its
results over; use this skill for flows it did not cover or when the capability is off.
