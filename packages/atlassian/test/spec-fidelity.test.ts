import { describe, expect, it } from 'vitest';
import { parseSpec } from '../src/engines/piv.ts';
import { breakdownWarnings, fileOverlaps, type WorkItem } from '../src/work.ts';

const spec = `# Spec: Exports

## Epic summary

Self-service exports.

## Tickets

### TICKET-1 — CSV endpoint
- **Scope:** An endpoint
- **Acceptance criteria:**
  - Type checks pass
- **Files touched (estimate):** \`src/reports/csv.ts\`, \`src/api/export.ts\` (+ tests)
- **Depends on:** none

### TICKET-2 — Upgrade the CSV library
- **Type:** Task
- **Scope:** Chore
- **Files touched (estimate):** package.json and src/reports/
- **Depends on:** none

### TICKET-3 — Export button
- **Scope:** UI
- Type checks pass
- **Files touched:** src/ui/ExportButton.tsx
- **Depends on:** TICKET-1

## Dependency graph

TICKET-3 ← TICKET-1

## Suggested execution order

Wave 1 (parallel): TICKET-1, TICKET-2
`;

const item = (id: string, files: string[], dependsOn: string[] = []): WorkItem => ({
  id, title: id, goal: '', acceptanceCriteria: [], requirements: [], dependsOn, status: 'not_started', source: '', files,
});

describe('spec fidelity', () => {
  const t = parseSpec(spec).tickets;

  it('reads Files touched as paths, dropping notes like "(+ tests)"', () => {
    expect(t[0]!.files).toEqual(['src/reports/csv.ts', 'src/api/export.ts']);
    expect(t[1]!.files).toEqual(['package.json', 'src/reports/']);
  });

  it('reads a per-ticket issue type; "Type checks pass" stays a criterion', () => {
    expect(t[1]!.issueType).toBe('Task');
    expect(t[0]!.issueType).toBeUndefined();
    expect(t[0]!.acceptanceCriteria).toEqual(['Type checks pass']);
    expect(t[2]!.acceptanceCriteria).toEqual(['Type checks pass']);
  });

  it('ignores the dependency graph and execution order sections when parsing tickets', () => {
    expect(t).toHaveLength(3);
    expect(t[2]!.dependsOn).toEqual(['TICKET-1']);
  });

  it('flags parallel tickets that touch the same file or directory', () => {
    const items = t.map((x) => item(x.id, x.files, x.dependsOn));
    expect(fileOverlaps(items)).toEqual([
      'Wave 1: TICKET-1 and TICKET-2 both touch src/reports/csv.ts; make one depend on the other or split the shared change out',
    ]);
  });

  it('does not flag overlaps across waves (they run in order)', () => {
    expect(fileOverlaps([item('A', ['src/x.ts']), item('B', ['./src/x.ts'], ['A'])])).toEqual([]);
  });

  it('combines cycle and overlap warnings', () => {
    const w = breakdownWarnings([item('A', ['a.ts'], ['B']), item('B', ['b.ts'], ['A']), item('C', ['c.ts']), item('D', ['C.TS'])]);
    expect(w[0]).toMatch(/Dependency cycle.*A, B/);
    expect(w[1]).toMatch(/C and D both touch c\.ts/);
  });
});
