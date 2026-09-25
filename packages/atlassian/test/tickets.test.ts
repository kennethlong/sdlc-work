import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceCriteria } from '../src/tickets.ts';
import { ENGINE_CASES } from './engines.ts';

describe('acceptanceCriteria', () => {
  it('reads list items under an acceptance-criteria heading or bold label', () => {
    expect(acceptanceCriteria('Intro\n\n## Acceptance Criteria\n\n- [ ] one\n- two\n\n## Notes\n- not this')).toEqual(['one', 'two']);
    expect(acceptanceCriteria('**Acceptance criteria:**\n1. first\n2. second')).toEqual(['first', 'second']);
    expect(acceptanceCriteria('No criteria here\n- just a list')).toEqual([]);
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
    expect(story).toContain('sdlc-atl sync');
    expect(bug).toContain('/rca SDLC-8');
    expect(bug).toMatch(/regression test/);
  });
});
