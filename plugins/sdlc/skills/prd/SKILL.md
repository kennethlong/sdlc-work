---
name: prd
description: Draft or refine a Product Requirements Document for a large feature (Track A) and publish it to Confluence. Use when requirements for a multi-ticket feature have been discussed, or the user asks for a PRD. Not for single-ticket work (use /sdlc:ticket).
argument-hint: "[feature name or Confluence page id to refine]"
---

# PRD: capture WHAT we are building, before slicing it

Track A step 1. The PRD in Confluence becomes the source of truth for the feature; `/sdlc:spec` slices it into
tickets later, **in a separate session**. Drafting requirements and decomposing them are different jobs, and
mixing them bloats context and tempts slicing before the requirements settle.

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. Gather

- If `$ARGUMENTS` is a Confluence page id, pull it to refine: `sdlc-atl page pull <id> --out docs/prd/<slug>.md`.
- Otherwise work from the conversation. Ask about gaps that change scope: target users, the MVP boundary,
  hard constraints (compliance, platforms, deadlines), how success is measured. Don't invent answers to these;
  list open questions instead.
- Skim the codebase only enough to keep the PRD feasible (existing modules, auth, data model). Planning detail
  belongs in the tickets, not here.

## 2. Write `docs/prd/<slug>.md`

Start with `# PRD: <Feature name>`; the H1 becomes the Confluence page title. Sections, scaled to the feature:

1. **Summary**: the problem, who has it, the outcome in 2–4 sentences.
2. **Users and needs**: personas and the pain each one has today.
3. **Scope**: In scope (MVP) and Out of scope, both explicit.
4. **User stories**: "As a …, I want …, so that …", each with **acceptance criteria** written so they can be
   tested (Given/When/Then or observable statements, no "fast"/"easy").
5. **Non-functional requirements**: performance, security, accessibility, compliance, as measurable criteria.
6. **Constraints and dependencies**: systems, teams, data, rollout limits.
7. **Success metrics**: how we will know it worked after release.
8. **Risks and open questions**: each with an owner or a proposed way to close it.

Keep it about the WHAT and the WHY. Architecture choices go in only where they are real constraints.

## 3. Publish

```
sdlc-atl page push docs/prd/<slug>.md --space <SPACE> [--parent <page id>]
```

Re-running updates the same page (unchanged content isn't re-versioned). Report the page URL and id, list
the open questions, and tell the user the next step: a fresh session running `/sdlc:spec` with the page id and
the Jira epic key (create the epic first if there isn't one).
