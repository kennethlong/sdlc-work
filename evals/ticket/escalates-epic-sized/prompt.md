---
description: A "story" that is really an epic. The ticket skill should not force it through one plan; it should recommend escalating to a PRD / epic (Track A).
tags: [ticket]
plugins: ["../../../plugins/sdlc"]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Can you work Jira story SHOP-90? Jira and our CLIs aren't reachable from here, so here it is:

**SHOP-90 (Story): "Multi-currency support"**
We're launching in the EU and UK. Customers should be able to shop, pay and get invoices in EUR and GBP as well as USD.
- Prices shown in the customer's currency across the storefront, cart and checkout
- Payments captured in that currency with our payment provider (new merchant accounts needed; finance is still deciding EUR settlement)
- Invoices and refunds in the order's currency, with VAT rules per country
- Finance reports converted to USD using the daily rate
- Admins can set per-currency price overrides

The repo has separate storefront, checkout, payments, invoicing and reporting modules.
