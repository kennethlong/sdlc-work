import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PivEngine } from '../src/engines/piv.ts';
import { agentCommand, answered, CLAIM_PROPERTY, claimIsStale, defaultJql, ineligibility, LABELS, pollAndWork, watchAndWork, workDisabled, pivPaths, workPrompt, workTicket, type AgentRunner, type WorkDeps } from '../src/headless.ts';
import type { GitHost, PullRequest } from '../src/hosts/types.ts';
import { JiraClient, type JiraIssue } from '../src/jira.ts';
import { StateFile } from '../src/state.ts';

const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 10));
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A clone of a bare "origin" whose main has one commit. */
function repo() {
  const origin = tmp('sdlc-origin-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = tmp('sdlc-work-');
  git(root, 'clone', '-q', origin, '.');
  git(root, 'config', 'user.email', 'bot@example.com');
  git(root, 'config', 'user.name', 'bot');
  writeFileSync(join(root, 'README.md'), 'hi\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  git(root, 'push', '-q', 'origin', 'main');
  return { root, origin };
}

type Comment = { author: { name: string }; body: string; created: string };
function fakeJira(issue: Partial<JiraIssue['fields']> = {}) {
  const labels = new Set<string>([LABELS.ready]);
  const props = new Map<string, unknown>();
  const comments: Comment[] = [];
  const statuses: string[] = [];
  const fields = () => ({
    summary: 'Export CSV button',
    issuetype: { name: 'Story' },
    status: { name: statuses.at(-1) ?? 'To Do', statusCategory: { key: statuses.length ? 'indeterminate' : 'new' } },
    description: 'Goal: export.\n\nh2. Acceptance criteria\n* A button exports CSV',
    labels: [...labels],
    comment: { comments },
    ...issue,
  });
  const jira = Object.create(JiraClient.prototype) as JiraClient;
  Object.assign(jira, {
    flavor: 'dc',
    getIssue: async (key: string) => ({ key, id: '1', self: '', fields: fields() }),
    myself: async () => ({ name: 'bot', displayName: 'Bot' }),
    editLabels: async (_k: string, add: string[] = [], remove: string[] = []) => {
      remove.forEach((l) => labels.delete(l));
      add.forEach((l) => labels.add(l));
    },
    assign: async () => {},
    moveTo: async (_k: string, s: string) => (statuses.push(s), { action: 'moved', status: s, hops: [s] }),
    // Mentions rendered exactly as the real client does (flavor dc: [~name]).
    addComment: async (_k: string, body: string, opts: { mention?: { name?: string }[] } = {}) => (
      comments.push({ author: { name: 'bot' }, body: [...(opts.mention ?? []).map((u) => jira.mentionMarkup(u)), body].filter(Boolean).join(' '), created: new Date().toISOString() }),
      { id: '1' }
    ),
    comments: async () => comments,
    epicOf: async () => undefined,
    addRemoteLink: async () => {},
    browseUrl: (k: string) => `https://jira/browse/${k}`,
    fieldId: async () => {
      throw new Error('no such field');
    },
    search: async () => [{ key: 'ABC-1', id: '1', self: '', fields: fields() }],
    // Issue properties with jitter, so concurrent runs really interleave.
    getIssueProperty: async (_k: string, p: string) => (await jitter(), props.get(p)),
    setIssueProperty: async (_k: string, p: string, v: unknown) => (await jitter(), void props.set(p, structuredClone(v))),
    deleteIssueProperty: async (_k: string, p: string) => void props.delete(p),
  });
  return { jira, labels, comments, statuses, props };
}

function fakeHost() {
  const created: { source: string; draft?: boolean }[] = [];
  const host: GitHost = {
    kind: 'bitbucket-dc',
    repoId: 'SDLC/app',
    findOpenPr: async () => undefined,
    getPr: async () => undefined,
    createPr: async (pr) => (created.push({ source: pr.source, draft: pr.draft }), { id: '7', url: 'https://bb/pr/7', title: pr.title, state: 'open', source: pr.source, target: pr.target } as PullRequest),
    updatePr: async () => {},
    prBody: async () => '',
    upsertComment: async () => 'created',
    publishAnnotations: async () => false,
    fileUrl: () => '',
  };
  return { host, created };
}

/** Agent stand-ins: what a real agent leaves behind in each phase (plan -> execute -> report). */
const P = pivPaths('ABC-1', 'Export CSV button');
const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const reportWith = (result: string): AgentRunner => async ({ root, phase }) => {
  if (phase === 'plan') put(root, P.plan, '# Plan\n\nTicket: ABC-1\n');
  if (phase === 'execute') {
    put(root, 'export.ts', 'export const x = 1;\n');
    git(root, 'add', 'export.ts');
    git(root, 'commit', '-qm', 'feat(ABC-1): export button');
  }
  if (phase === 'report') put(root, P.report, `# Report\n\nTicket: ABC-1\n\n## Validation Results\n\n- Unit tests: ${result}\n- Lint: ✓\n`);
  return { code: 0, output: `${phase} done`, timedOut: false };
};
const agents: Record<'passes' | 'fails' | 'asks' | 'idle' | 'noCode', AgentRunner> = {
  passes: reportWith('✓ 3 passed'),
  fails: reportWith('✗ 1 failed'),
  asks: async ({ root, phase }) => {
    if (phase === 'plan') put(root, '.sdlc/work/ABC-1-questions.md', '1. Which reports? (assuming all)\n');
    return { code: 0, output: 'asked', timedOut: false };
  },
  idle: async () => ({ code: 1, output: 'error: not logged in', timedOut: false }),
  noCode: async ({ root, phase }) => {
    if (phase === 'plan') put(root, P.plan, '# Plan\n\nTicket: ABC-1\n');
    return { code: 0, output: 'thought about it', timedOut: false };
  },
};

function deps(runAgent: AgentRunner, jiraFields: Partial<JiraIssue['fields']> = {}) {
  const { root, origin } = repo();
  const j = fakeJira(jiraFields);
  const h = fakeHost();
  const d: WorkDeps = { jira: j.jira, host: h.host, engine: new PivEngine(), state: new StateFile(root), root, config: { git: { base: 'main' }, work: { claimSettleSeconds: 0.05 } }, runAgent, buildUrl: 'https://ci/job/1' };
  return { d, root, origin, ...j, ...h };
}

describe('workTicket', () => {
  it('passing work: pushes the branch, opens a draft PR, never Done, labels ai-done', { timeout: 30_000 }, async () => {
    const t = deps(agents.passes);
    const r = await workTicket('ABC-1', t.d);
    expect(r).toMatchObject({ outcome: 'pr', prUrl: 'https://bb/pr/7', branch: 'feature/ABC-1-export-csv-button' });
    expect(t.created).toEqual([{ source: 'feature/ABC-1-export-csv-button', draft: true }]);
    expect(git(t.origin, 'branch', '--list')).toContain('feature/ABC-1-export-csv-button');
    expect(git(t.origin, 'log', '-1', '--format=%s', 'main')).toBe('init'); // base untouched
    expect([...t.labels]).toEqual([LABELS.done]);
    expect(t.statuses).not.toContain('Done');
    expect(t.comments[0]!.body).toMatch(/Started an unattended AI run \(\[build\]\(https:\/\/ci\/job\/1\)\)/);
    expect(t.comments.at(-1)!.body).toMatch(/Ready for review: \[draft pull request\]\(https:\/\/bb\/pr\/7\)/);
  });

  it('questions instead of code: posts them and waits (ai-needs-info), nothing pushed', { timeout: 30_000 }, async () => {
    const t = deps(agents.asks);
    const r = await workTicket('ABC-1', t.d);
    expect(r.outcome).toBe('needs-info');
    expect(t.comments.at(-1)!.body).toContain('Which reports?');
    expect([...t.labels]).toEqual([LABELS.needsInfo]);
    expect(git(t.origin, 'branch', '--list')).not.toContain('feature/');
  });

  it('failed validation: no PR, the branch is pushed for a human, ai-failed', { timeout: 30_000 }, async () => {
    const t = deps(agents.fails);
    const r = await workTicket('ABC-1', t.d);
    expect(r.outcome).toBe('failed');
    expect(r.reason).toMatch(/validation did not pass \(failed/);
    expect(t.created).toEqual([]);
    expect(git(t.origin, 'branch', '--list')).toContain('feature/ABC-1-export-csv-button');
    expect([...t.labels]).toEqual([LABELS.failed]);
  });

  it('an agent that does nothing: explains with its last output', { timeout: 30_000 }, async () => {
    const t = deps(agents.idle);
    const r = await workTicket('ABC-1', t.d);
    expect(r.outcome).toBe('failed');
    expect(t.comments.at(-1)!.body).toMatch(/no plan was written[\s\S]*not logged in/);
  });

  it('a plan but no code: stops after the execute phase, and the plan was committed by the runner', { timeout: 30_000 }, async () => {
    const t = deps(agents.noCode);
    const r = await workTicket('ABC-1', t.d);
    expect(r.reason).toMatch(/no commits implementing the plan/);
    expect(git(t.root, 'log', '-1', '--format=%s')).toBe('docs(ABC-1): implementation plan');
    expect(t.comments.map((c) => c.body)).toContainEqual(expect.stringMatching(/Plan written/));
  });

  it('refuses a dirty workspace (other than .sdlc/)', { timeout: 30_000 }, async () => {
    const t = deps(agents.passes);
    writeFileSync(join(t.root, 'README.md'), 'changed\n');
    expect((await workTicket('ABC-1', t.d)).reason).toMatch(/uncommitted changes/);
  });

  it('skips ineligible stories with a comment', { timeout: 30_000 }, async () => {
    const t = deps(agents.passes, { issuetype: { name: 'Epic' } });
    const r = await workTicket('ABC-1', t.d);
    expect(r).toMatchObject({ outcome: 'skipped' });
    expect([...t.labels]).toEqual([LABELS.skipped]);
  });

  it('kill switch', async () => {
    expect(workDisabled({ enabled: false })).toMatch(/enabled is false/);
    expect(workDisabled({}, { SDLC_WORK: 'off' })).toBe('SDLC_WORK=off');
    expect(workDisabled({}, {})).toBeUndefined();
    const t = deps(agents.passes);
    t.d.config.work = { enabled: false };
    expect(await pollAndWork(t.d)).toEqual([{ key: '-', outcome: 'disabled', reason: '.sdlc/config.json work.enabled is false' }]);
  });
});

describe('clarification loop and eligibility', () => {
  const bot = { name: 'bot' };
  const q = { author: bot, body: '🤖 Before I build this I need a few answers.' };
  it('a question waits for a human reply', () => {
    expect(answered([q], bot)).toBe(false);
    expect(answered([q, { author: bot, body: 'progress' }], bot)).toBe(false);
    expect(answered([q, { author: { name: 'alice' }, body: 'all reports' }], bot)).toBe(true);
    expect(answered([], bot)).toBe(true);
  });

  it('eligibility rules', () => {
    const issue = (f: Record<string, unknown>) => ({ key: 'A-1', id: '1', self: '', fields: { summary: 's', issuetype: { name: 'Story' }, status: { name: 'To Do', statusCategory: { key: 'new' } }, ...f } }) as JiraIssue;
    expect(ineligibility(issue({}))).toEqual([]);
    expect(ineligibility(issue({ issuetype: { name: 'Epic' } }))[0]).toMatch(/type Epic/);
    expect(ineligibility(issue({}), { maxPoints: 3 }, 5)[0]).toMatch(/5 story points/);
    expect(ineligibility(issue({ components: [{ name: 'web' }] }), { components: ['api'] })[0]).toMatch(/no component/);
  });

  it('the prompt names the evidence the gate checks (headless agents otherwise skip straight to code)', () => {
    const piv = workPrompt('ABC-1', { name: 'piv' }, 'Export CSV button');
    expect(piv).toContain('.claude/plans/abc-1-export-csv-button.md');
    expect(piv).toContain('.claude/execution-reports/abc-1-export-csv-button.md');
    expect(piv).toMatch(/rejects work without that evidence/);
    expect(workPrompt('ABC-1', { name: 'gsd' }, 'x')).toMatch(/GSD quick task whose description starts with "ABC-1:"/);
    expect(piv.length).toBeLessThan(2000); // fits a Windows command line with room to spare
  });

  it('default query and agent command lines', () => {
    expect(defaultJql({ jira: { projects: ['SDLC'] } })).toMatch(/^project in \(SDLC\) AND statusCategory != Done AND \(\(labels in \(ai-ready, ai-needs-info\) AND labels not in \(ai-running\)\)/);
    expect(agentCommand({}, 'P', 'f')).toEqual(['copilot', '-p', 'P', '--allow-all-tools', '--no-ask-user', '--deny-tool', 'shell(git push)']);
    expect(agentCommand({ agent: 'codex' }, 'P', 'f')).toEqual(['codex', 'exec', '--full-auto', 'P']);
    expect(agentCommand({ agentCommand: ['node', 'fake.mjs', '{promptFile}'] }, 'P', 'f.md')).toEqual(['node', 'fake.mjs', 'f.md']);
  });
});

describe('claiming a story (two jobs with overlapping queries)', () => {
  it('two runners racing for one story: exactly one works it, the other backs off', { timeout: 60_000 }, async () => {
    const a = deps(agents.passes);
    const b = deps(agents.passes);
    // Same Jira and host, separate CI workspaces.
    b.d.jira = a.d.jira;
    b.d.host = a.d.host;
    b.d.buildUrl = 'https://ci/job/2';
    const results = await Promise.all([workTicket('ABC-1', a.d), workTicket('ABC-1', b.d)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['busy', 'pr']);
    expect(a.created).toHaveLength(1);
    expect(a.comments.filter((c) => /Started an unattended AI run/.test(c.body))).toHaveLength(1);
    expect(a.props.size).toBe(0); // the winner released its claim
  });

  it('a live claim blocks; a stale one (dead runner) is taken over', { timeout: 30_000 }, async () => {
    const t = deps(agents.passes);
    t.props.set(CLAIM_PROPERTY, { id: 'other', at: new Date().toISOString(), build: 'https://ci/job/9' });
    expect(await workTicket('ABC-1', t.d)).toMatchObject({ outcome: 'busy', reason: expect.stringMatching(/another run holds it/) });
    t.props.set(CLAIM_PROPERTY, { id: 'other', at: new Date(Date.now() - 3 * 3600_000).toISOString() });
    expect((await workTicket('ABC-1', t.d)).outcome).toBe('pr');
  });

  it('staleness follows the time limit', () => {
    const at = (min: number) => ({ id: 'x', at: new Date(Date.now() - min * 60_000).toISOString() });
    expect(claimIsStale(at(30))).toBe(false);
    expect(claimIsStale(at(61))).toBe(true); // 45 + 15
    expect(claimIsStale(at(61), { timeoutMinutes: 90 })).toBe(false);
    expect(claimIsStale(undefined)).toBe(true);
  });

  it('the poll query also finds stories whose runner died', () => {
    expect(defaultJql({})).toContain('(labels = ai-running AND updated <= "-60m")');
  });
});

describe('watchAndWork (no CI server)', () => {
  it('polls every round, survives a failing round, and stops when aborted', { timeout: 30_000 }, async () => {
    const t = deps(agents.passes);
    const slept: number[] = [];
    const errors: string[] = [];
    let calls = 0;
    const stop = new AbortController();
    const rounds = await watchAndWork(
      () => {
        calls++;
        if (calls === 2) throw new Error('Jira unreachable');
        if (calls === 3) stop.abort(); // e.g. Ctrl-C during the third round: that round still finishes
        return t.d;
      },
      5,
      { signal: stop.signal, sleep: async (ms) => void slept.push(ms), onError: (e) => errors.push(e.message) },
    );
    expect(rounds).toBe(3);
    expect(errors).toEqual(['Jira unreachable']);
    expect(slept).toEqual([300_000, 300_000]); // no sleep after the stop
    expect(t.created).toHaveLength(1); // round 1 worked the story; round 3 found it done
  });
});

describe('no acceptance criteria', () => {
  const noAc = { description: 'Customers complain about the exports. Improve them.' };
  it('asks for criteria without spending an agent run', { timeout: 30_000 }, async () => {
    let agentCalls = 0;
    const t = deps(async (o) => (agentCalls++, agents.passes(o)), noAc);
    const r = await workTicket('ABC-1', t.d);
    expect(r).toMatchObject({ outcome: 'needs-info', reason: 'no acceptance criteria' });
    expect(agentCalls).toBe(0);
    expect(t.comments.at(-1)!.body).toMatch(/no acceptance criteria/);
    expect([...t.labels]).toEqual([LABELS.needsInfo]);
  });

  it('an unrelated comment is not an answer; a reply to the question is', { timeout: 60_000 }, async () => {
    let agentCalls = 0;
    const t = deps(async (o) => (agentCalls++, agents.passes(o)), noAc);
    t.comments.push({ author: { name: 'alice' }, body: 'Looking into this next sprint', created: '' });
    expect((await workTicket('ABC-1', t.d)).outcome).toBe('needs-info'); // the bot hadn't asked yet
    t.comments.push({ author: { name: 'alice' }, body: 'Criteria: UTF-8 BOM, dated file names', created: '' });
    expect((await workTicket('ABC-1', t.d)).outcome).toBe('pr');
    expect(agentCalls).toBe(3); // plan, execute, report
  });
});

describe('questions @-mention the reporter', () => {
  it('mentions the reporter with real mention markup', { timeout: 30_000 }, async () => {
    const t = deps(agents.asks, { reporter: { name: 'alice', displayName: 'Alice (Product)' } });
    await workTicket('ABC-1', t.d);
    expect(t.comments.at(-1)!.body).toMatch(/^\[~alice\] 🤖 Before I build this I need a few answers/);
  });

  it('does not mention the bot when it filed the story itself', { timeout: 30_000 }, async () => {
    const t = deps(agents.asks, { reporter: { name: 'bot', displayName: 'Bot' } });
    await workTicket('ABC-1', t.d);
    expect(t.comments.at(-1)!.body).toMatch(/^🤖 Before I build this/);
  });

  it('mention markup per flavor, and it survives the markdown conversion', async () => {
    const dc = new JiraClient({ baseUrl: 'https://jira', flavor: 'dc', auth: { type: 'bearer', token: 't' } });
    const cloud = new JiraClient({ baseUrl: 'https://x.atlassian.net', flavor: 'cloud', auth: { type: 'basic', user: 'u', token: 't' } });
    expect(dc.mentionMarkup({ name: 'alice' })).toBe('[~alice]');
    expect(cloud.mentionMarkup({ accountId: '5b10ac8d82e05b22cc7d4ef5' })).toBe('[~accountid:5b10ac8d82e05b22cc7d4ef5]');
    expect(cloud.mentionMarkup({ name: 'alice' })).toBe(''); // Cloud needs the account id
    let posted = '';
    (dc as unknown as { http: unknown }).http = { post: async (_p: string, b: { body: string }) => ((posted = b.body), { id: '1' }) };
    await dc.addComment('A-1', 'Which [reports]?', { mention: [{ name: 'alice' }] });
    expect(posted).toBe('[~alice] Which \\[reports\\]?'); // the mention is raw; the text is escaped
  });
});
