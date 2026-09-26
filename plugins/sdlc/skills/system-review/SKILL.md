---
name: system-review
description: Meta-level review of how well finished work followed its plan - classify each divergence as justified or problematic, trace root causes, score alignment /10, and propose the exact AGENTS.md and skill text that would prevent it next time. Reviews the process, not the code. Use after /sdlc:report (or a finished GSD phase or quick task), or across several tickets to find repeated patterns.
argument-hint: "[ticket-or-phase]"
---

# System review: bugs in the process, not the code

A code review asks "is this change right?". A system review asks "why did the agent do something other than
the plan said, and what should change in our rules, plans or skills so it doesn't happen again?"

- Good divergence reveals a plan limitation → improve planning.
- Bad divergence reveals unclear requirements or missing context → improve communication.
- A problem that repeats reveals missing automation → a new skill, check or hook.

## 1. Find the plan and what actually happened

From `$ARGUMENTS` (a ticket key or spec ticket id, a GSD phase number, or plan + report paths; engine:
`.sdlc/config.json` "engine"):

- **piv** (a Jira key or spec ticket id): the plan `.claude/plans/<ticket>-<slug>.md` and the newest
  `.claude/execution-reports/<ticket>-<slug>.md` (lower-cased key; bug fixes use `<key>-fix-<slug>`).
- **gsd** (a phase number): `.planning/phases/<NN>-*/`: each `*-PLAN.md` and its `*-SUMMARY.md` (sections
  "Deviations from Plan", "Decisions & Deviations", "Issues Encountered"), plus `*-VERIFICATION.md` when present.
  A quick task (`.planning/quick/<id>-*/`): its plan and summary.
- **Two paths**: use them as plan and report.
- **Nothing given**: the most recently changed execution report or GSD summary; say which one you picked.
- **Several tickets or a whole phase**: review each, then look across them. Patterns across tickets are the
  most valuable output.

Also read what shaped the work: `AGENTS.md` (project rules), the `/sdlc:plan` and `/sdlc:execute` skill
instructions (or GSD's planner, for gsd), and the ticket brief `.sdlc/tickets/<KEY>.md` or spec ticket for the
acceptance criteria.

In Claude Code, hand the analysis in steps 2-5 to the `system-reviewer` agent (fresh context, read-only) with
the paths you found, and check its result. Anywhere else, do the steps yourself.

## 2. Planned vs actual

From the plan: the intended approach, files, patterns it cited, validation steps. From the report or summary:
what was built, every divergence with its stated reason, what was skipped, what failed validation, what was hard.
Also compare the two yourself: an unreported divergence (files the plan didn't name, a skipped validation
level) counts, and is itself a finding about the report.

## 3. Classify each divergence

- **Good ✅ (justified):** the plan assumed something the codebase doesn't have; a better existing pattern was
  found; a real security or performance need; an acceptance criterion forced it.
- **Bad ❌ (problematic):** an explicit plan constraint ignored; new architecture instead of the existing
  pattern; a shortcut that leaves debt; a misread requirement; validation skipped or weakened.

## 4. Root cause of each bad divergence

Be specific about where and why: *unclear plan* (which instruction), *missing context* (which file or doc was
not read or doesn't exist), *missing validation* (which check would have caught it), *repeated manual step*
(what was done by hand again). "The plan didn't say which retry helper to use" beats "the plan was unclear".

## 5. Improvements, with the actual text

Only for patterns (repeated, or likely to repeat), not one-offs. Each must be a concrete edit:

- **AGENTS.md**: the rule to add, written as it should appear, citing an example (`path:line`).
- **Plan skill / GSD planning**: the missing instruction or template section.
- **Execute or validate skill**: the check or step to add.
- **New skill, script or hook**: for a manual process repeated 3+ times.

## 6. Write it down

Save to `.claude/system-reviews/<ticket>-<slug>-review.md` (for several tickets:
`.claude/system-reviews/<date>-<scope>-review.md`):

```
# System Review: <title>

- Plan: <path>
- Execution report / summary: <path>
- Date: <YYYY-MM-DD>

## Alignment score: N/10
(10 all divergences justified · 7-9 minor justified · 4-6 mixed · 1-3 major problematic)

## Divergences
- divergence: <what changed>
  planned: <what the plan said>
  actual: <what was done>
  reason: <stated reason, or "not reported">
  classification: good ✅ | bad ❌
  root_cause: <unclear plan | missing context | missing validation | repeated manual step | ...> — <where, why>

## Pattern compliance
- [ ] Followed the codebase's architecture
- [ ] Used the patterns in AGENTS.md
- [ ] Followed the testing patterns
- [ ] Ran every validation level the plan listed

## Improvements
### AGENTS.md
<rule text, ready to paste>
### Plan skill
<instruction text>
### Execute / validate
<check text>
### New skill or automation
<what, and the manual step it replaces>

## Key learnings
- Worked well: …
- Needs improvement: …
- Try next time: …
```

Show the user the score and the proposed edits. Apply AGENTS.md or skill changes only when they agree; this
skill analyses and proposes. To share the review with the team, publish it:
`node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs" page push .claude/system-reviews/<file>.md --space <SPACE>`.
