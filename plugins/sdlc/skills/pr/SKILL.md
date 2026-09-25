---
name: pr
description: Open (or update) the pull request for the current branch on GitHub or Bitbucket Data Center - titled and described from the Jira issue, linked from Jira - after checking validation and review. Use when work on a ticket is ready for review.
argument-hint: "[--base <branch>] [--draft]"
---

# PR: from a verified branch to a reviewable pull request

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.
The host (GitHub or Bitbucket Data Center) is detected from the `origin` remote. Credentials: `GITHUB_TOKEN`, or a
logged-in `gh` CLI; `BITBUCKET_BASE_URL` + `BITBUCKET_TOKEN` (an HTTP access token), e.g. in `~/.sdlc/atlassian.env`.

## 1. Ready?

- The branch name contains the Jira key (e.g. `feature/SDLC-12-export-button`); rename the branch if not.
  That's what links the PR, the review and Jira (and the Jira development panel on Bitbucket DC).
- The validation gate passed (`/sdlc:validate`), and the work is verified (GSD verification or `/sdlc:report`).
- Everything is committed. `sdlc-atl review-scope` lists uncommitted files.
- Recommended: `/sdlc:review` first, so the PR starts with no blocking findings.

## 2. Preview, confirm, push, open

```
sdlc-atl pr --dry-run $ARGUMENTS
```

Show the user the title, target branch and body. **Pushing and opening a PR are visible to the team: get the
user's go-ahead**, then:

```
git push -u origin <branch>
sdlc-atl pr $ARGUMENTS
```

This creates the PR, or updates the existing open one's title and body (re-running is safe). It adds a link to the
PR on the Jira issue with a comment, and, if `.sdlc/config.json` sets `jira.transitions.review` (e.g.
`"In Review"`), moves the issue there.

## 3. Review on the PR

If a review exists for the current HEAD, publish it: `sdlc-atl publish-review .sdlc/reviews/<file>.md`.
Otherwise run `/sdlc:review`, which publishes when a PR exists. Give the user the PR URL and the review verdict.

After more commits: `git push`, `sdlc-atl pr` to refresh the body, and `/sdlc:review` again.
