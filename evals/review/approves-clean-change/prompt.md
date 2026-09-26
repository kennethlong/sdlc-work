---
description: A small, correct, tested change. The review must not invent problems - verdict approved or comments, no critical/high findings.
tags: [review]
plugins: ["../../../plugins/sdlc"]
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Can you review `feature/SHOP-51-format-money` against `main` before I open the PR? Git and our CLIs aren't available here, so the whole change is below. HEAD is `a1c0d93`.

Ticket SHOP-51 "Show order totals as money":
- `formatMoney(cents, currency)` returns e.g. `$12.50` for 1250 USD and `€0.05` for 5 EUR
- Negative amounts show a leading minus: `-$3.00`
- Unit tests cover these cases

`git diff --stat`: 2 files changed, 27 insertions(+)

```diff
diff --git a/src/money/format.ts b/src/money/format.ts
new file mode 100644
--- /dev/null
+++ b/src/money/format.ts
@@ -0,0 +1,11 @@
+const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
+
+/** Integer cents to a display string, e.g. 1250 USD -> "$12.50". Unknown currencies use their code. */
+export function formatMoney(cents: number, currency: string): string {
+  if (!Number.isInteger(cents)) throw new RangeError(`cents must be an integer, got ${cents}`);
+  const sign = cents < 0 ? '-' : '';
+  const abs = Math.abs(cents);
+  const symbol = SYMBOLS[currency] ?? `${currency} `;
+  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
+}
+
diff --git a/src/money/format.test.ts b/src/money/format.test.ts
new file mode 100644
--- /dev/null
+++ b/src/money/format.test.ts
@@ -0,0 +1,16 @@
+import { describe, expect, it } from 'vitest';
+import { formatMoney } from './format';
+
+describe('formatMoney', () => {
+  it('formats dollars and cents', () => expect(formatMoney(1250, 'USD')).toBe('$12.50'));
+  it('pads small amounts', () => expect(formatMoney(5, 'EUR')).toBe('€0.05'));
+  it('puts the minus before the symbol', () => expect(formatMoney(-300, 'USD')).toBe('-$3.00'));
+  it('falls back to the currency code', () => expect(formatMoney(100, 'CHF')).toBe('CHF 1.00'));
+  it('rejects fractional cents', () => expect(() => formatMoney(1.5, 'USD')).toThrow(RangeError));
+  it('formats zero', () => expect(formatMoney(0, 'GBP')).toBe('£0.00'));
+  it('handles large amounts', () => expect(formatMoney(123456789, 'USD')).toBe('$1234567.89'));
+  it('formats one cent', () => expect(formatMoney(1, 'USD')).toBe('$0.01'));
+  it('formats negative cents', () => expect(formatMoney(-5, 'EUR')).toBe('-€0.05'));
+  it('formats whole amounts', () => expect(formatMoney(700, 'GBP')).toBe('£7.00'));
+});
```

The test suite passes (`npx vitest run src/money`: 10 passed). Save the review where our review workflow expects it and tell me the verdict.
