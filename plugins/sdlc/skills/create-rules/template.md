# <Project name>

<One or two sentences: what this codebase is, its main stack.>

Rules for every AI coding agent (GitHub Copilot, Codex, Claude Code, ...). Claude Code reads them through
CLAUDE.md, which imports this file. Each rule cites the code it comes from.

## Naming

- <files, modules, functions, variables: the convention> (`path:line`)

## Core patterns

- <error handling> (`path:line`)
- <logging> (`path:line`)
- <async / data access / date-time handling> (`path:line`)
- Legacy: <the old pattern still present, and what to use instead> (`path:line`)

## Build and validation

| Check | Command |
|---|---|
| Lint | `<command>` |
| Type check | `<command>` |
| Unit tests | `<command>` |
| Build | `<command>` |

Testing as it really is: <e.g. "unit tests with vitest beside the code; no E2E tests yet">.

## On-demand context

Load a module only when the task touches its area.

| Module | Load when |
|---|---|
| `.claude/context/architecture.md` | changing how modules connect, adding a service |
| `.claude/context/<topic>.md` | <when> |

## Hard rules

General constraints for every task (specific one-offs go in a context module):

- Run the full validation gate before opening a PR.
- Never commit secrets or credentials.
- <more, each cited>

## Miscellaneous / Gotchas

<!-- Running list: add what agents repeatedly get wrong, with a pointer to where it bit (RCA, review). -->
- <first entry from the analysis, if any>
