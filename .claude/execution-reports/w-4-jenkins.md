# Execution Report: Jenkins in the local stack

Ticket: W-4

## What was built

- Jenkins (configuration as code, no wizard) at http://localhost:8081 with Node 24, git, uv, the Copilot CLI and the sdlc skills; loopback forwarding so the `*.localhost` URLs work inside the container; the repo mounted read-only.
- Job `sdlc-work-poll` (every 5 minutes, no concurrent builds) from `templates/ci/jenkins/Jenkinsfile.sdlc-work`, usable at work with parameters; `dc.ps1` up/status/creds/rebuild include Jenkins.

## Validation Results

- Type check (`tsc -b`): ✓
- Unit tests (`npm test`): ✓ 236 passed
- Live, local DC stack (`npm run test:live`): ✓ 49 passed, 4 skipped
- Live, Jira/Confluence Cloud: ✓ 42 passed, 11 skipped (Bitbucket-only suites)
- End to end on the local stack with the real Copilot CLI in Jenkins: SDLC-12 (vague) asked questions, Alice answered, then a draft PR #4 with a passing verification; SDLC-11 (clear) ended in draft PR #5 via plan → execute → report (all six skills used): ✓

## Divergences from the plan

Loopback port forwarding instead of extra_hosts (the apps bind to the host loopback, and *.localhost always resolves to loopback). The pipeline runs without shell tracing so tokens never reach the build log; an empty CLI parameter no longer hides the agent's SDLC_ATL.
