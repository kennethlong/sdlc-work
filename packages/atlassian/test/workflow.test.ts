import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JiraClient } from '../src/jira.ts';
import { StateFile } from '../src/state.ts';
import { syncProgress } from '../src/sync.ts';
import type { Engine, WorkStatus } from '../src/work.ts';

// A work-style workflow: "Done" is called Closed and needs a Resolution; some transitions lead backwards.
const CATEGORY: Record<string, string> = { Open: 'new', 'In Progress': 'indeterminate', 'In Review': 'indeterminate', QA: 'indeterminate', Closed: 'done' };
const FLOW: Record<string, string[]> = {
  Open: ['In Progress'],
  'In Progress': ['Open', 'In Review', 'Closed'],
  'In Review': ['In Progress', 'QA', 'Closed'],
  QA: ['In Review', 'Closed'],
  Closed: ['Open'],
};

function fakeJira(statuses: Record<string, string>) {
  const posted: { key: string; to: string; fields?: unknown }[] = [];
  const failing = new Set<string>();
  const jira = new JiraClient({ baseUrl: 'https://jira.example.com', flavor: 'dc', auth: { type: 'bearer', token: 't' } });
  const status = (name: string) => ({ name, statusCategory: { key: CATEGORY[name]! } });
  (jira as unknown as { http: unknown }).http = {
    baseUrl: 'https://jira.example.com',
    async get(path: string) {
      const key = decodeURIComponent(path.split('/')[5]!);
      if (failing.has(key)) throw new Error(`GET ${path} -> 403: no permission`);
      if (path.endsWith('/transitions')) {
        return {
          transitions: FLOW[statuses[key]!]!.map((to, i) => ({
            id: String(i),
            name: `to ${to}`,
            to: status(to),
            ...(to === 'Closed' ? { fields: { resolution: { required: true, allowedValues: [{ name: 'Fixed' }, { name: "Won't Do" }] } } } : {}),
          })),
        };
      }
      return { key, fields: { summary: key, status: status(statuses[key]!) } };
    },
    async post(path: string, body: { transition: { id: string }; fields?: unknown }) {
      const key = decodeURIComponent(path.split('/')[5]!);
      const to = FLOW[statuses[key]!]![Number(body.transition.id)]!;
      posted.push({ key, to, fields: body.fields });
      statuses[key] = to;
      return undefined;
    },
  };
  return { jira, posted, failing };
}

describe('JiraClient.moveTo', () => {
  it('reaches Done by category through intermediate statuses, setting Resolution', async () => {
    const { jira, posted } = fakeJira({ 'K-1': 'Open' });
    const r = await jira.moveTo('K-1', 'Done', { category: 'done' });
    expect(r).toEqual({ action: 'moved', status: 'Closed', hops: ['In Progress', 'Closed'] });
    expect(posted.at(-1)!.fields).toEqual({ resolution: { name: 'Fixed' } });
  });

  it('never takes a backwards transition', async () => {
    const { jira, posted } = fakeJira({ 'K-1': 'In Review' });
    expect((await jira.moveTo('K-1', 'Open')).action).toBe('no-transition');
    expect(posted).toEqual([]);
  });
});

describe('syncProgress on a real-world workflow', () => {
  const run = async (statuses: Record<string, string>, progress: Record<string, WorkStatus>, extra: { hold?: string[] } = {}) => {
    const { jira, posted, failing } = fakeJira(statuses);
    const root = mkdtempSync(join(tmpdir(), 'sdlc-wf-'));
    const state = new StateFile(root);
    state.data.tickets = Object.fromEntries(Object.keys(progress).map((k) => [k, { summary: k }]));
    const engine = { ticketProgress: async (_r: string, key: string) => ({ status: progress[key]!, artifacts: [] }) } as unknown as Engine;
    return { jira, posted, failing, sync: () => syncProgress({ jira, state, root, engineFor: () => engine, ...extra }) };
  };

  it('does not pull In Review back to In Progress while work continues', async () => {
    const { sync, posted } = await run({ 'K-1': 'In Review' }, { 'K-1': 'executing' });
    const r = await sync();
    expect(r.tickets[0]!.transition.action).toBe('kept-started');
    expect(posted).toEqual([]);
  });

  it('moves verified work to the done category even when it is called Closed', async () => {
    const { sync, posted } = await run({ 'K-1': 'In Review' }, { 'K-1': 'complete' });
    const r = await sync();
    expect(r.tickets[0]!.transition).toMatchObject({ action: 'moved', to: 'Closed' });
    expect(posted.map((p) => p.to)).toEqual(['Closed']);
  });

  it('starts To Do work', async () => {
    const { sync } = await run({ 'K-1': 'Open' }, { 'K-1': 'planned' });
    expect((await sync()).tickets[0]!.transition).toMatchObject({ action: 'moved', to: 'In Progress' });
  });

  it('carries on past an issue that fails, and reports it', async () => {
    const { sync, failing } = await run({ 'K-1': 'Open', 'K-2': 'Open' }, { 'K-1': 'planned', 'K-2': 'planned' });
    failing.add('K-1');
    const r = await sync();
    expect(r.errors).toBe(1);
    expect(r.tickets.find((t) => t.key === 'K-1')).toMatchObject({ transition: { action: 'error' }, error: expect.stringMatching(/403/) });
    expect(r.tickets.find((t) => t.key === 'K-2')!.transition.action).toBe('moved');
  });

  it('respects hold statuses for lateral moves (done-when-merged review step)', async () => {
    const { jira } = fakeJira({ 'K-1': 'QA' });
    const root = mkdtempSync(join(tmpdir(), 'sdlc-wf-'));
    const state = new StateFile(root);
    state.data.tickets = { 'K-1': { summary: 'K-1' } };
    const engine = { ticketProgress: async () => ({ status: 'complete' as WorkStatus, artifacts: [] }) } as unknown as Engine;
    const r = await syncProgress({
      jira, state, root, engineFor: () => engine, hold: ['QA'],
      doneWhen: 'merged', transitions: { review: 'In Review' } as never, prState: async () => 'open',
    });
    expect(r.tickets[0]!.transition.action).toBe('kept-hold');
  });
});
