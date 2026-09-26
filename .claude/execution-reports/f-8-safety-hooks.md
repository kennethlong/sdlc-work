# Execution Report: Baseline safety hooks for piv

Ticket: F-8

## What was built

- `plugins/sdlc/hooks/`: PreToolUse guard for Bash and PowerShell (and Read/Grep/Glob): secret files, env dumps, broad destructive commands (roots/home, force-push or delete of main, reset --hard, clean -fd, DROP DATABASE, disk formatting); JSON deny decision; fail-open on internal errors.
- `.sdlc/audit.jsonl`: redacted one-line summaries with the decision, sdlc repos only, rotated at 10 MB; `SDLC_GUARD=off`, `SDLC_AUDIT=off`.
- Works unchanged in Copilot CLI plugins (verified end to end in both).

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 221 passed
- Live, local DC stack (`npm run test:live`): ✓ 47 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local-only suites)
- Plugin manifest (`claude plugin validate plugins/sdlc`): ✓


## Divergences from the plan

Only active where the plugin is loaded; wizard installs for Copilot/Codex get skills + MCP, not the hooks.
