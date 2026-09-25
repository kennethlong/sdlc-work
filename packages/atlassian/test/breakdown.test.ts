import { describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGsdTools, GsdEngine, parseDependsOn, parseRequirements, PivEngine } from '../src/engines/index.ts';
import { storyDescription } from '../src/filing.ts';
import { cyclicItems, waves, type Breakdown, type WorkItem } from '../src/work.ts';

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

  it('puts cyclic items in a final wave, or throws when strict', () => {
    const items = [item('1'), item('2', ['3']), item('3', ['2'])];
    expect(waves(items).map((x) => x.map((i) => i.id))).toEqual([['1'], ['2', '3']]);
    expect(cyclicItems(items)).toEqual(['2', '3']);
    expect(cyclicItems([item('1'), item('2', ['1'])])).toEqual([]);
    expect(() => waves(items, { strict: true })).toThrow(/cycle/);
  });
});

describe('GSD roadmap parsing helpers', () => {
  it.each([
    ['Nothing (first phase)', []],
    ['Phase 1', ['1']],
    ['Phases 1 and 2.1', ['1', '2.1']],
    ['Phase 01, Phase 03', ['1', '3']],
    // Real-world GSD roadmap text:
    ['Phase 0 (Win32-only; independent of Phases 1-2)', ['0']],
    ['Phase 5.4 (live-channel seqlock model it extends); lands adjacent to Phase 9 with a seam', ['5.4']],
    ['**Phase 5.2** — its evidence base is this phase', ['5.2']],
    ['Phase 5.2 (workflow engine), Phase 04.4 / 05.7 (workspace, staging)', ['5.2', '4.4', '5.7']],
    ["Phase 17's **verified collision-input slice** (`.flr` floors, Phase 17 SC3) and x64 D3D9 LIVE-15", ['17']],
    ['Phase 4 (VCS foundation); Phase 14 ONLY for the optional drafting assists', ['4']],
    ['Phases 1-3 and 5', ['1', '2', '3', '5']],
  ])('depends on %j', (text, ids) => expect(parseDependsOn(text)).toEqual(ids));

  it('keeps only dependencies that exist in the roadmap', () => {
    expect(parseDependsOn('Phase 0, Phase 2', new Set(['1', '2']))).toEqual(['2']);
  });

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
  it('loads the fixture roadmap into a breakdown', { timeout: 30_000 }, async () => {
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

describe('PivEngine (reference artifacts)', () => {
  const pivFixture = fileURLToPath(new URL('./fixtures/piv-project', import.meta.url));

  it('parses the /spec breakdown in its loose real-world shapes', async () => {
    const b = await new PivEngine().loadBreakdown(pivFixture);
    expect(b).toMatchObject({ engine: 'piv', title: 'Reporting Improvements', overview: expect.stringMatching(/export and schedule/) });
    expect(b.items.map((i) => [i.id, i.title, i.dependsOn, i.status, i.acceptanceCriteria.length])).toEqual([
      ['TICKET-1', 'CSV export endpoint', [], 'complete', 3],
      ['TICKET-2', 'Export UI', ['TICKET-1'], 'planned', 2],
      ['TICKET-3', 'Scheduled exports', ['TICKET-1'], 'not_started', 2],
    ]);
    expect(b.items[0]!.goal).toBe('Any saved report can be exported as CSV through the API');
    expect(b.items[0]!.verification).toMatchObject({ status: 'passed', score: '4/4 validation checks passed', path: '.claude/execution-reports/ticket-1-csv-export-endpoint.md' });
  });

  it('links artifacts only by file-name prefix, Ticket line, or filed Jira key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-piv-'));
    try {
      cpSync(pivFixture, root, { recursive: true });
      rmSync(join(root, '.claude'), { recursive: true });
      mkdirSync(join(root, '.claude', 'plans'), { recursive: true });
      mkdirSync(join(root, '.claude', 'execution-reports'), { recursive: true });
      writeFileSync(join(root, '.claude', 'plans', 'ticket-10-other.md'), '# Feature: other');
      writeFileSync(join(root, '.claude', 'plans', 'mentions.md'), '# Feature: x\n\nBuilds on TICKET-1 and TICKET-3.');
      writeFileSync(join(root, '.claude', 'plans', 'sdlc-42-export-ui.md'), '# Feature: Export UI');
      writeFileSync(join(root, '.claude', 'execution-reports', 'sdlc-42-export-ui.md'), '### Validation Results\n\n- Lint: ✓\n- Unit Tests: ✗ 2 failed\n');

      const b = await new PivEngine().loadBreakdown(root, { issueKeys: { 'TICKET-2': 'SDLC-42' } });
      expect(b.items.map((i) => i.status)).toEqual(['not_started', 'needs_attention', 'not_started']);
      expect(b.items[1]!.verification).toMatchObject({ status: 'failed', score: '1/2 validation checks passed' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks for a config entry when several specs exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-piv-'));
    try {
      cpSync(pivFixture, root, { recursive: true });
      writeFileSync(join(root, 'docs', 'specs', 'another.md'), '# Spec: Another');
      await expect(new PivEngine().loadBreakdown(root)).rejects.toThrow(/Several specs.*"spec" in \.sdlc\/config\.json/);
      expect((await new PivEngine({ spec: 'docs/specs/reporting-improvements.md' }).loadBreakdown(root)).items).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
