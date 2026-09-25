// Slice 8 end to end on the local Bitbucket DC + Jira: open a PR for a keyed branch, link Jira, publish reviews.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BitbucketDcHost, connect, envLookup, importTicket, JiraClient, loadConfig, openPr, PivEngine, publishReview, resolveHost, StateFile, syncProgress } from '../src/index.ts';
import { TEST_PROJECT } from './engines.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const get = envLookup({ cwd: repoRoot });
const bbBase = get('BITBUCKET_BASE_URL');
const bbToken = get('BITBUCKET_TOKEN');
const cfg = loadConfig({ cwd: repoRoot });

describe.skipIf(!bbBase || !bbToken || !cfg.jira)('PR + review (live, Bitbucket DC)', () => {
  const run = `t${Date.now().toString(36)}`;
  let jira: JiraClient;
  let root: string;
  let key = '';
  let host: BitbucketDcHost;
  const base = `base-${run}`;
  let branch = '';
  let fixedVerdict = '';
  const git = (...a: string[]) => execFileSync('git', ['-c', `http.extraHeader=Authorization: Bearer ${bbToken}`, ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (file: string, msg: string) => {
    writeFileSync(join(root, file), `${msg}\n`);
    git('add', '.');
    git('commit', '-qm', msg);
  };
  const review = (findings: string[]) => {
    mkdirSync(join(root, '.sdlc', 'reviews'), { recursive: true });
    const f = join(root, '.sdlc', 'reviews', 'r.md');
    writeFileSync(f, ['---', `base: ${base}`, 'findings:', ...(findings.length ? findings : ['  []']), '---', '# Code review', '', 'Summary for humans.'].join('\n').replace('findings:\n  []', 'findings: []'));
    return f;
  };

  beforeAll(async () => {
    ({ jira } = connect({ cwd: repoRoot }));
    key = (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Story', summary: `${run} Export button` })).key;
    branch = `feature/${key}-export-button`;
    root = mkdtempSync(join(tmpdir(), 'sdlc-pr-'));
    git('init', '-q', '-b', base);
    git('config', 'user.email', 't@e.x');
    git('config', 'user.name', 't');
    git('remote', 'add', 'origin', `${bbBase}/scm/sdlc/sandbox.git`);
    commit('README.md', 'base');
    git('push', '-q', '-u', 'origin', base);
    git('checkout', '-qb', branch);
    commit('export.ts', `${key} add export button`);
    git('push', '-q', '-u', 'origin', branch);
    host = resolveHost(root, { cwd: repoRoot }) as BitbucketDcHost;
  });

  afterAll(async () => {
    const pr = await host.findOpenPr(branch, base).catch(() => undefined);
    if (pr) {
      const raw = await host['http'].get<{ version: number }>(`/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}`);
      await host['http'].request('DELETE', `/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}`, { body: { version: raw.version } }).catch(() => {});
    }
    for (const b of [branch, base]) {
      try {
        git('push', '-q', 'origin', '--delete', b);
      } catch {
        /* already gone */
      }
    }
    await jira.deleteIssue(key);
    rmSync(root, { recursive: true, force: true });
  });

  const open = (dryRun = false) => openPr({ root, host, jira, state: new StateFile(root), base, dryRun });

  it('resolves Bitbucket DC from the origin remote', () => {
    expect(host.kind).toBe('bitbucket-dc');
    expect(host.repoId).toBe('SDLC/sandbox');
  });

  it('opens a PR titled from Jira, links it from the issue; re-running is a no-op', async () => {
    expect((await open(true)).action).toBe('would-create');
    const r = await open();
    expect(r).toMatchObject({ action: 'created', key, title: `${key}: ${run} Export button` });
    expect(r.pr!.url).toMatch(new RegExp(`/projects/SDLC/repos/sandbox/pull-requests/${r.pr!.id}$`));
    expect(r.body).toContain(`**Jira:** [${key}]`);
    expect(r.body).toContain(`${key} add export button`);

    const links = await jira.http.get<{ object: { url: string } }[]>(`/rest/api/2/issue/${key}/remotelink`);
    expect(links.map((l) => l.object.url)).toContain(r.pr!.url);
    expect((await jira.comments(key)).at(-1)!.body).toContain('Pull request opened');
    expect(new StateFile(root).data.prs?.[branch]).toMatchObject({ id: r.pr!.id, key, host: 'bitbucket-dc' });

    expect((await open()).action).toBe('unchanged');
  });

  it('refuses unpushed work, and updates the PR body after new commits are pushed', async () => {
    commit('export2.ts', `${key} progress bar`);
    await expect(open()).rejects.toThrow(/not pushed/);
    git('push', '-q');
    const r = await open();
    expect(r.action).toBe('updated');
    expect(r.body).toContain(`${key} progress bar`);
  });

  it('publishes a review: one PR comment, Code Insights annotations, a Jira comment; idempotent', async () => {
    const f = review([
      '  - { severity: high, category: security, file: export.ts, line: 1, title: CSV cells not escaped, detail: "=HYPERLINK(...) executes in Excel", suggestion: Prefix risky cells with a quote }',
      '  - { severity: low, file: export2.ts, line: 1, title: Rename variable }',
    ]);
    const jiraComments = (await jira.comments(key)).length;
    const r = await publishReview({ root, host, jira, file: f, base });
    expect(r).toMatchObject({ verdict: 'changes_requested', blocking: 1, comment: 'created', annotations: true, jiraCommented: true });
    expect(await jira.comments(key)).toHaveLength(jiraComments + 1);

    const sha = git('rev-parse', 'HEAD').trim();
    const insights = `/rest/insights/1.0/projects/SDLC/repos/sandbox/commits/${sha}/reports/sdlc-review`;
    expect(await host['http'].get<{ result: string }>(insights)).toMatchObject({ result: 'FAIL' });
    const ann = await host['http'].get<{ annotations: { path: string; line: number; severity: string }[] }>(`${insights}/annotations`);
    expect(ann.annotations.map((a) => [a.path, a.line, a.severity]).sort()).toEqual([
      ['export.ts', 1, 'HIGH'],
      ['export2.ts', 1, 'LOW'],
    ]);

    const again = await publishReview({ root, host, jira, file: f, base });
    expect(again).toMatchObject({ comment: 'unchanged', jiraCommented: false });

    const fixed = await publishReview({ root, host, jira, file: review([]), base });
    fixedVerdict = fixed.verdict;
    expect(fixed).toMatchObject({ verdict: 'approved', blocking: 0, comment: 'updated' });
    expect(await host['http'].get<{ result: string }>(insights)).toMatchObject({ result: 'PASS' });
    expect((await host['http'].get<{ annotations: unknown[] }>(`${insights}/annotations`)).annotations).toEqual([]);
  });

  it('doneWhen "merged": verified work waits in progress until the PR is merged, then goes to Done', async () => {
    expect(fixedVerdict).toBe('approved');
    // Track B ticket with a passing PIV execution report named after the key.
    await importTicket({ jira, root, key, engine: new PivEngine(), state: new StateFile(root) });
    for (const [dir, body] of [
      ['plans', '# Feature: export'],
      ['execution-reports', '### Validation Results\n\n- Tests: ✓'],
    ] as const) {
      mkdirSync(join(root, '.claude', dir), { recursive: true });
      writeFileSync(join(root, '.claude', dir, `${key.toLowerCase()}-export.md`), body);
    }
    const sync = () =>
      syncProgress({
        jira,
        root,
        state: new StateFile(root),
        engineFor: () => new PivEngine(),
        doneWhen: 'merged',
        prState: async (id) => (await host.getPr(id))?.state,
      });
    let r = await sync();
    expect(r.tickets[0]).toMatchObject({ key, status: 'complete', transition: { to: 'In Progress' } });
    expect((await jira.getIssue(key, 'status'))!.fields.status!.name).toBe('In Progress');

    const pr = (await host.findOpenPr(branch, base))!;
    const { version } = await host['http'].get<{ version: number }>(`/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}`);
    await host['http'].request('POST', `/rest/api/1.0/projects/SDLC/repos/sandbox/pull-requests/${pr.id}/merge`, { query: { version } });
    expect((await host.getPr(pr.id))?.state).toBe('merged');

    r = await sync();
    expect(r.tickets[0]).toMatchObject({ transition: { to: 'Done', action: 'moved' } });
    expect((await jira.getIssue(key, 'status'))!.fields.status!.name).toBe('Done');
  });
});
