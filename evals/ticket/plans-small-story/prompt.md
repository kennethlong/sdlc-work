---
description: A one-plan story on the piv engine. The agent should plan it (plan named after the Jira key so progress links back to Jira), with a validation step per acceptance criterion, and stop before implementing.
tags: [ticket]
plugins: ["../../../plugins/sdlc"]
max_turns: 35
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Let's pick up Jira story SHOP-12. This repo uses the piv planning engine. Jira, git and our CLIs aren't reachable from here, so the ticket and the relevant code are below. **Plan it only: stop after the plan, don't implement anything.**

**SHOP-12 (Story): "Export CSV button on the report page"**
Goal: users can download the report they are looking at as CSV.
Acceptance criteria:
- An "Export CSV" button appears in the report page header
- Clicking it downloads `<report-name>.csv` from `GET /api/reports/:id/export.csv` (the endpoint already exists)
- The button shows a spinner and is disabled while the download is in progress
- A component test covers the click and the disabled state

Relevant code:

```tsx
// src/web/reports/ReportPage.tsx
import { useReport } from './useReport';
import { ReportTable } from './ReportTable';

export function ReportPage({ id }: { id: string }) {
  const report = useReport(id);
  if (!report) return <Spinner />;
  return (
    <section>
      <header className="report-header">
        <h1>{report.name}</h1>
      </header>
      <ReportTable rows={report.rows} />
    </section>
  );
}
```

```ts
// src/web/api.ts
export async function download(url: string, filename: string): Promise<void> { /* fetches and saves a blob */ }
```

```tsx
// src/web/reports/ReportTable.test.tsx (existing test style)
import { render, screen } from '@testing-library/react';
it('renders a row per record', () => { render(<ReportTable rows={rows} />); expect(screen.getAllByRole('row')).toHaveLength(3); });
```

Commands: `npm run lint`, `npm run typecheck`, `npm test`.
