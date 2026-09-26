---
description: A branch with a SQL injection and an unmet acceptance criterion; the review must catch both and record them in the review file format the pr/publish-review steps read.
tags: [review, smoke]
plugins: ["../../../plugins/sdlc"]
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Please code-review my branch `feature/SHOP-42-order-search` before I open the PR. Git and our CLIs aren't available in this environment, so everything you need is below. Base branch is `main`, HEAD is `4f9c2e1`.

Ticket SHOP-42 "Search my orders by note":
- A customer can search their orders by text in the order note
- Only the customer's own orders are returned
- Results are capped at 50 rows
- Unit tests cover the search

The branch adds one file (`git diff --stat`: 1 file changed, 12 insertions(+)):

```diff
diff --git a/src/orders/search.ts b/src/orders/search.ts
new file mode 100644
--- /dev/null
+++ b/src/orders/search.ts
@@ -0,0 +1,12 @@
+import type { Db } from '../db';
+
+export type OrderHit = { id: string; total: number; note: string };
+
+/** Orders of one customer whose note contains the search term. */
+export async function searchOrders(db: Db, customerId: string, term: string): Promise<OrderHit[]> {
+  const sql =
+    `SELECT id, total, note FROM orders ` +
+    `WHERE customer_id = '${customerId}' AND note LIKE '%${term}%' ORDER BY created_at DESC`;
+  const rows = await db.query(sql);
+  return rows as OrderHit[];
+}
```

`Db.query(sql: string, params?: unknown[])` supports `$1`-style parameters. There is no test file for search yet.

Save the review where our review workflow expects it, and give me the verdict.
