import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceCriteria } from '../src/tickets.ts';
import { ENGINE_CASES } from './engines.ts';

describe('acceptanceCriteria', () => {
  it('reads list items under an acceptance-criteria heading or bold label', () => {
    expect(acceptanceCriteria('Intro\n\n## Acceptance Criteria\n\n- [ ] one\n- two\n\n## Notes\n- not this')).toEqual(['one', 'two']);
    expect(acceptanceCriteria('**Acceptance criteria:**\n1. first\n2. second')).toEqual(['first', 'second']);
    expect(acceptanceCriteria('No criteria here\n- just a list')).toEqual([]);
  });
});

describe.each(ENGINE_CASES)('ticket brief next steps ($name engine)', (ec) => {
  const skills = readdirSync(fileURLToPath(new URL('../../../plugins/sdlc/skills', import.meta.url)));

  it.each([false, true])('only name skills the plugin ships (bug: %s)', (isBug) => {
    const steps = ec.engine().nextSteps('ABC-12', 'Export "fails" on empty', isBug).join('\n');
    const named = [...steps.matchAll(/\/sdlc:([a-z-]+)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(skills, `/sdlc:${n}`).toContain(n);
    // Nothing that looks like one of the reference's un-namespaced commands.
    expect(steps).not.toMatch(/`\/(prime|plan-feature|implement-fix|execution-report|rca|execute|validate)\b/);
  });
});

describe.each(ENGINE_CASES.filter((c) => c.available))('ticketProgress ($name engine)', (ec) => {
  it('follows artifacts named after the key: none -> planned -> complete with verification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-ticket-'));
    try {
      const engine = ec.engine();
      expect((await engine.ticketProgress(root, 'SDLC-7')).status).toBe('not_started');
      ec.planTicket(root, 'SDLC-7');
      expect((await engine.ticketProgress(root, 'SDLC-7')).status).toBe('planned');
      expect((await engine.ticketProgress(root, 'SDLC-70')).status).toBe('not_started'); // no prefix bleed
      ec.passTicket(root, 'SDLC-7');
      const p = await engine.ticketProgress(root, 'SDLC-7');
      expect(p.status).toBe('complete');
      expect(p.verification?.status).toBe('passed');
      expect(p.artifacts.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tells the user what to run next, bug-aware', () => {
    const story = ec.engine().nextSteps('SDLC-7', 'Export button', false).join('\n');
    const bug = ec.engine().nextSteps('SDLC-8', 'Export crashes', true).join('\n');
    expect(story).toContain('SDLC-7');
    expect(story).toContain('/sdlc:sync');
    expect(bug).toContain('/sdlc:rca SDLC-8');
    expect(bug).toMatch(/regression test/);
  });
});
