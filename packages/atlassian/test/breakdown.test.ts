import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { findGsdTools, GsdEngine, parseDependsOn, parseRequirements } from '../src/engines/index.ts';
import { storyDescription } from '../src/filing.ts';
import { waves, type Breakdown, type WorkItem } from '../src/work.ts';

const item = (id: string, dependsOn: string[] = []): WorkItem => ({
  id,
  title: `Item ${id}`,
  goal: 'g',
  acceptanceCriteria: [],
  requirements: [],
  dependsOn,
  status: 'not_started',
  source: 's',
});

describe('waves', () => {
  it('groups by dependency depth, ignoring unknown ids', () => {
    const w = waves([item('1', ['0']), item('2', ['1']), item('3', ['1']), item('4', ['2', '3'])]);
    expect(w.map((x) => x.map((i) => i.id))).toEqual([['1'], ['2', '3'], ['4']]);
  });

  it('rejects cycles', () => {
    expect(() => waves([item('1', ['2']), item('2', ['1'])])).toThrow(/cycle/);
  });
});

describe('GSD roadmap parsing helpers', () => {
  it.each([
    ['Nothing (first phase)', []],
    ['Phase 1', ['1']],
    ['Phases 1 and 2.1', ['1', '2.1']],
    ['Phase 01, Phase 03', ['1', '3']],
  ])('depends on %j', (text, ids) => expect(parseDependsOn(text)).toEqual(ids));

  it('extracts requirement ids with or without brackets', () => {
    expect(parseRequirements('**Requirements**: [EXP-01, EXP-02]')).toEqual(['EXP-01', 'EXP-02']);
    expect(parseRequirements('**Requirements**: AUTH-1 AUTH-2')).toEqual(['AUTH-1', 'AUTH-2']);
  });
});

const fixture = fileURLToPath(new URL('./fixtures/gsd-project', import.meta.url));
const hasGsd = (() => {
  try {
    return !!findGsdTools(fixture);
  } catch {
    return false;
  }
})();

describe.skipIf(!hasGsd)('GsdEngine (needs GSD Core installed)', () => {
  it('loads the fixture roadmap into a breakdown', async () => {
    const b = await new GsdEngine().loadBreakdown(fixture);
    expect(b.title).toBe('Reporting Improvements');
    expect(b.overview).toMatch(/export and schedule reports/);
    expect(b.items.map((i) => [i.id, i.title, i.dependsOn, i.status])).toEqual([
      ['1', 'CSV export endpoint', [], 'complete'],
      ['2', 'Export UI', ['1'], 'planned'],
      ['3', 'Scheduled exports', ['1'], 'not_started'],
    ]);
    expect(b.items[0]!.acceptanceCriteria).toHaveLength(3);
    expect(b.items[0]!.requirements).toEqual(['EXP-01', 'EXP-02']);
    expect(b.items[0]!.verification).toMatchObject({
      status: 'passed',
      score: '3/3 must-haves verified',
      path: '.planning/phases/01-csv-export-endpoint/01-VERIFICATION.md',
    });
    expect(b.items[0]!.verification!.markdown).toMatch(/^# Phase 1: CSV export endpoint Verification Report/);
    expect(b.items[1]!.verification).toBeUndefined();
  });
});

describe('storyDescription', () => {
  it('renders goal, criteria checklist, deps by title, wave and source', () => {
    const b: Breakdown = { engine: 'gsd', title: 't', overview: '', items: [item('1'), { ...item('2', ['1']), acceptanceCriteria: ['works'], requirements: ['R-1'] }] };
    const md = storyDescription(b.items[1]!, 2, b);
    expect(md).toContain('- [ ] works');
    expect(md).toContain('**Requirements:** R-1');
    expect(md).toContain('**Depends on:** Item 1');
    expect(md).toContain('**Wave:** 2');
    expect(md).toContain('_Source: GSD s.');
  });
});
