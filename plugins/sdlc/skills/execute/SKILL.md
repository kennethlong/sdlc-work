---
name: execute
description: Implement a plan from .claude/plans/ step by step, running each step's check as you go, then the tests and the full validation gate. PIV loop step 3. Use with the path of an approved plan.
argument-hint: "<path to plan>"
---

# Execute: build exactly what the plan says, verified as you go

1. **Read the whole plan** (`$ARGUMENTS`) and every file in its "Context to read" list before changing
   anything.
2. **Do the steps in order.** For each one: make the change, following the cited pattern; run its **Check**
   command; fix the problem before moving on if it fails.
3. **Write the tests** the plan lists, including the edge and error cases.
4. **Run the full validation gate** from the plan (or `/sdlc:validate`). Everything must pass.

## When reality differs from the plan

The plan can be wrong. When it is:
- Prefer the smallest change that keeps the plan's intent, and follow the codebase's existing patterns over
  inventing new ones.
- **Record the divergence** (what the plan said, what you did, why). `/sdlc:report` needs it, and it is how the
  plans improve.
- If the divergence changes the design or the scope, stop and ask.

Don't skip checks, and don't mark work done with failing tests. Finish with a short summary: files changed,
tests added, validation results, divergences. Next: `/sdlc:validate`, then `/sdlc:report`.
