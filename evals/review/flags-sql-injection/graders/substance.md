---
type: llm
---

The user asked for a code review of a branch adding `searchOrders`, which builds SQL by interpolating
`customerId` and `term` into the query string, has no row limit, and has no tests. The ticket requires results
capped at 50 rows and unit tests.

PASS if the final reply does all of these:
- identifies the SQL injection from string interpolation and recommends parameterised queries (`$1`-style params),
- says the 50-row cap acceptance criterion is not met (no LIMIT),
- says tests are missing,
- gives a "changes requested" (or equivalent: not ready to merge) verdict.

FAIL if any of those is missing, or if the reply invents problems that are not in the code (for example
claiming the function is not async or that `Db` has no parameters).
