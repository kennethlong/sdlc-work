---
name: review-fix
description: Fix the findings from a code review (.sdlc/reviews/<branch>.md) one at a time, most severe first, each with a test, then validate and re-review so the PR comment and Jira show the new state. Use after /sdlc:review reports findings.
argument-hint: "[review file]"
---

# Review fix: close the findings, prove each one

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

1. **Read the review** (`$ARGUMENTS`, or the newest file in `.sdlc/reviews/`) fully, and the files it cites.
2. **Order**: critical → high → medium → low. Ask the user before skipping any critical/high finding, or before
   fixing a finding that you think is wrong (explain why instead).
3. **For each finding**:
   - explain the problem in one or two sentences;
   - where the finding is a behaviour bug, **write the test that exposes it first** and see it fail;
   - make the smallest fix that follows the repo's patterns, and see the test pass;
   - commit, one finding (or one tight group) per commit, with the Jira key in the message.
4. **Validate** with the full gate (`/sdlc:validate`).
5. If a finding reveals a *pattern* the agent keeps getting wrong, propose a rule for AGENTS.md (the
   reference's learning loop).
6. **Push, then re-review**: `git push`, then `/sdlc:review` again. It rewrites the review file for the new HEAD, and
   publishing updates the same PR comment and annotations. Report what was fixed, what was deferred and why.
