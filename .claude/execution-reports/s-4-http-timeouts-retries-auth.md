# Execution Report: HTTP timeouts, safe retries, clear auth errors

Ticket: S-4

## What was built

- Every request has a timeout (60 s; `SDLC_HTTP_TIMEOUT_MS`).
- 429 is retried for every method; 503 and network failures only for idempotent methods, so a POST is never repeated.
- 401 says the token is missing, wrong or expired and names the instance; a bare 403 says permission is missing.
- Network failures explain themselves: timeout (VPN/proxy), untrusted TLS certificate (points at `NODE_EXTRA_CA_CERTS`), host not found, refused, reset.
- Tests: `http.test.ts` against a local server.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 99 passed
- Live, local DC stack (`npm run test:live`): ✓ all passed
- Live, Jira/Confluence Cloud (`SDLC_LIVE_ALLOW_REMOTE=1`): ✓ 42 passed, 9 skipped (local-only)
- Bundle freshness: ✓

## Divergences from the plan

None.
