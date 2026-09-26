# Plan template

Fill every section; delete a section only when it truly does not apply and say why in Notes. Keep the
headings: `/sdlc:execute` reads "Context to read before implementing", each step's **Check**, and "Validation".

```markdown
# Plan: <title>

Ticket: <KEY>
Goal: <one sentence: the outcome, not the activity>

Validate the documentation and codebase patterns below before you start: names of existing utils, types and
modules matter, and so do the files they are imported from.

## Feature

- **Description:** <what it does and why it matters to its users>
- **User story:** As a <type of user>, I want <action>, so that <benefit>.
- **Problem:** <the specific problem or gap>
- **Solution:** <the approach, in 2–4 sentences>
- **Type:** New capability | Enhancement | Refactor | Bug fix
- **Complexity:** Low | Medium | High
- **Systems affected:** <components/services>
- **Dependencies:** <libraries or services, with versions>

Acceptance criteria (from the ticket, plus any agreed during planning):
- [ ] <criterion>

## Context to read before implementing

Read all of these first. Line ranges point at the part that matters.

- `path/to/file.ts:40-85`: <why: the pattern to mirror / the integration point / the model to extend>
- `path/to/test.ts:1-60`: <why: the test style to follow>

### Documentation

- <URL#section>: <the specific section, and why it is needed>

## New files

- `path/to/new-thing.ts`: <responsibility>
- `path/to/new-thing.test.ts`: <what it covers>

## Patterns to follow

Real excerpts from this codebase (not invented examples), each with its source:

**Naming** (`src/foo/bar.ts:12`):
```ts
<a few lines>
```

**Error handling** (`src/foo/errors.ts:30-41`):
```ts
<a few lines>
```

**Logging / config / tests** (as relevant, same format)

**Anti-patterns to avoid:** <what not to copy, and why>

## Design decisions

- <decision>: chosen because <reason>; rejected <alternative> because <reason>
- Edge cases and failure modes handled: <list>
- Security: <input validation, auth, secrets, injection>
- Performance: <expected sizes, hot paths, N+1s, memory>

## Implementation phases

1. **Foundation:** <types, schemas, helpers>
2. **Core:** <business logic>
3. **Integration:** <routes, registration, config, wiring>
4. **Tests and validation:** <what proves it works>

## Steps

Execute in order, top to bottom. Each step is atomic and checkable on its own.
Actions: CREATE, UPDATE, ADD, REMOVE, REFACTOR, MIRROR.

### 1. <ACTION> `path/to/file`
- **Do:** <the specific change>
- **Pattern:** `other/file.ts:12` <what to copy from it>
- **Imports:** <exact modules and names>
- **Gotcha:** <what is easy to get wrong here>
- **Check:** `<non-interactive command that proves this step works>`

### 2. ...

## Tests

- **Unit:** <cases, each with inputs and expected results, including edge and error cases>
- **Integration:** <workflows across components>
- **Edge cases:** <empty, huge, unicode, concurrent, permission denied, network failure, ...>
- **E2E (user-facing changes):** <flows for `/sdlc:e2e`: entry URL, happy path with the assertion that proves
  success, the error paths and the UI signal for each, the moments to screenshot>

## Validation

The full gate, in order. Commands are non-interactive and mirror CI. Each level becomes a ✓/✗ line in the
execution report.

1. **Syntax and style:** `<lint>`, `<format --check>`
2. **Types:** `<type-check>`
3. **Unit tests:** `<command>`
4. **Integration tests:** `<command>` (or "none in this repo")
5. **Manual:** <steps with exact requests/clicks and expected results; the agent runs what it can (e.g. curl the
   endpoint) and lists the rest as needing a human>
6. **E2E (browser):** `/sdlc:e2e <KEY>` with the flows above; "not applicable: <why>" when nothing user-facing
   changed

Build (`<command>`) and any extra tools (e.g. an MCP-backed check) go under level 6 or as their own lines.

## Completion checklist

- [ ] All steps done in order, each Check passed
- [ ] All tests from "Tests" written and passing
- [ ] All six validation levels run (or marked not applicable with a reason)
- [ ] Acceptance criteria met, one by one
- [ ] No regressions; code follows the patterns above

## Notes

<trade-offs, open questions, follow-ups>

Confidence this plan executes in one pass: N/10, because <reasons>.
```
