// W-1..W-3 end to end on the local Jira + Bitbucket DC, with a scripted agent (no AI credits): a labelled story ends
// in a draft PR and In Review; a story with open questions ends in a Jira comment and ai-needs-info.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BitbucketDcHost, connect, envLookup, JiraClient, LABELS, loadConfig, PivEngine, resolveHost, StateFile, workTicket, type WorkDeps } from '../src/index.ts';
import { TEST_PROJECT } from './engines.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const get = envLookup({ cwd: repoRoot });
const bbBase = get('BITBUCKET_BASE_URL');
const bbToken = get('BITBUCKET_TOKEN');
const cfg = loadConfig({ cwd: repoRoot });
const fakeAgent = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));

describe.skipIf(!bbBase || !bbToken || !cfg.jira)('headless work (live, Jira + Bitbucket DC)', () => {
  const run = `h${Date.now().toString(36)}`;
  const base = `base-${run}`;
  let jira: JiraClient;
  let root: string;
  let host: BitbucketDcHost;
  const keys: string[] = [];
  const branches: string[] = [];
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const story = async (summary: string) => {
    const { key } = await jira.createIssue({ project: TEST_PROJECT, issueType: 'Story', summary: `${run} ${summary}`, labels: [LABELS.ready], description: 'Goal: export.\n\n## Acceptance criteria\n\n- An Export button downloads CSV' });
    keys.push(key);
    return key;
  };
  const deps = (key: string, mode: string): WorkDeps => ({
    jira,
    host,
    engine: new PivEngine(),
    state: new StateFile(root),
    root,
    config: { git: { base }, work: { agentCommand: ['node', fakeAgent, key, mode, '{phase}', '{promptFile}'] } },
    buildUrl: 'http://ci.localhost/job/42',
  });

  beforeAll(async () => {
    ({ jira } = connect({ cwd: repoRoot }));
    root = mkdtempSync(join(tmpdir(), 'sdlc-headless-'));
    git('init', '-q', '-b', base);
    git('config', 'user.email', 'bot@e.x');
    git('config', 'user.name', 'sdlc bot');
    git('config', 'http.extraHeader', `Authorization: Bearer ${bbToken}`); // the runner pushes with plain git
    git('remote', 'add', 'origin', `${bbBase}/scm/sdlc/sandbox.git`);
    writeFileSync(join(root, 'README.md'), 'base\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('push', '-q', '-u', 'origin', base);
    host = resolveHost(root, { cwd: repoRoot }) as BitbucketDcHost;
  });

  afterAll(async () => {
    for (const b of branches) {
      const pr = await host.findOpenPr(b, base).catch(() => undefined);
      if (pr) {
        const raw = await host['http'].get<{ version: number }>(`/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}`);
        await host['http'].request('DELETE', `/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}`, { body: { version: raw.version } }).catch(() => {});
      }
    }
    for (const b of [...branches, base]) {
      try {
        git('push', '-q', 'origin', '--delete', b);
      } catch {
        /* already gone */
      }
    }
    for (const k of keys) await jira.deleteIssue(k);
    rmSync(root, { recursive: true, force: true });
  });

  it('works a story into a draft PR: claimed, commented, labelled, In Progress (not Done)', async () => {
    const key = await story('Export button');
    const r = await workTicket(key, deps(key, 'pass'));
    branches.push(r.branch!);
    expect(r).toMatchObject({ outcome: 'pr' });

    const pr = await host.findOpenPr(r.branch!, base);
    expect(pr).toMatchObject({ draft: true, title: `${key}: ${run} Export button` });

    const issue = await jira.getIssue(key, 'labels,status,assignee');
    expect(issue!.fields.labels).toEqual([LABELS.done]);
    expect(issue!.fields.status?.statusCategory?.key).toBe('indeterminate'); // local workflow has no In Review
    expect(issue!.fields.assignee?.name).toBe((await jira.myself()).name);
    const bodies = (await jira.comments(key)).map((c) => c.body);
    expect(bodies[0]).toMatch(/Started an unattended AI run/);
    expect(bodies.at(-1)).toMatch(/Ready for review/);
  });

  it('asks instead of guessing: questions in Jira, ai-needs-info, nothing pushed', async () => {
    const key = await story('Unclear export');
    const r = await workTicket(key, deps(key, 'ask'));
    expect(r.outcome).toBe('needs-info');
    const issue = await jira.getIssue(key, 'labels');
    expect(issue!.fields.labels).toEqual([LABELS.needsInfo]);
    expect((await jira.comments(key)).at(-1)!.body).toMatch(/Which reports need the button/);
    expect(git('ls-remote', '--heads', 'origin', r.branch!).trim()).toBe('');
  });
});
