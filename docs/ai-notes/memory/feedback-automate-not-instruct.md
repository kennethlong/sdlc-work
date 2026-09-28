---
name: feedback-automate-not-instruct
description: "User wants multi-step manual setup automated end to end, and doesn't want caution about pasting throwaway dev credentials"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e76c5441-c4a4-4041-8e55-e3226bdb46bd
  modified: 2026-09-24T19:08:19.643Z
---

When a setup needs many manual steps (e.g. setup wizards plus tokens, about 30 minutes of clicking), build a one-command automation instead of handing over a checklist. Verify it on a throwaway side stack rather than the user's live instance.

Don't warn the user off pasting dev-only secrets into chat, such as 3-hour test license keys or admin passwords for a local throwaway instance. Keep that caution for real or shared credentials.

**Why:** 2026-09-24, the user said: "This whole process is too much... It takes 30 minutes", and "why do you care if I paste them here, they only last for 3 hours and are only good for a standalone dev instance."

**How to apply:** default to scripts (TS, PowerShell or Python) that generate their own credentials and write them to .env. See [[project-sdlc-work-goal]].
