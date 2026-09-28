---
name: feedback-reference-first
description: "For every sdlc-work feature, check the ai-native-starter-pack reference flow first; deviations are allowed but must be explained and documented"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e76c5441-c4a4-4041-8e55-e3226bdb46bd
  modified: 2026-09-25T00:13:12.042Z
---

Before designing any sdlc-work feature, look at how the reference implementation (C:\Code\ai-native-starter-pack) handles it: its skills, the diagrams, the PIV loop, /spec and /rca. Follow it by default. Deviating is fine, but state the reason explicitly and record it in the design doc's "Deviations from the reference" section.

**Why:** on 2026-09-24 I proposed a Jira-first import flow that differed from the reference without saying so. The user said: "I really liked the reference implementation flow... we can deviate, but we need to understand why ;-)". Configurable flows may come in a later version.

**How to apply:** each design doc gets a reference comparison. The rule is also written into the repo's AGENTS.md. See [[project-sdlc-work-goal]].
