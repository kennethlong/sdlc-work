// W-5 demo on the local stack: label stories ai-ready, let Jenkins' poll job have the real AI agent (Copilot CLI by
// default) work them, then show the outcome. Needs `./dc.ps1 up` (with Jenkins) and `node scripts/seed-showcase.ts`.
// Usage: node scripts/demo-headless.ts [--no-trigger] [--in-repo]
//   --in-repo  also commit the in-repo Jenkinsfile (Jenkinsfile.sdlc-work) for the multibranch job sdlc-work-inrepo
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, envLookup, LABELS } from '../packages/atlassian/src/index.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const env = envLookup({ cwd: repo });
const { jira } = connect({ cwd: repo });
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

// 1. The sandbox repo tells the runner how to work: piv engine, this Jira project, Copilot, two stories per poll.
const clone = mkdtempSync(join(tmpdir(), 'sdlc-demo-'));
const git = (...a: string[]) => execFileSync('git', ['-c', `http.extraHeader=Authorization: Bearer ${env('BITBUCKET_TOKEN')}`, ...a], { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('clone', '-q', `${env('BITBUCKET_BASE_URL')}/scm/sdlc/sandbox.git`, '.');
mkdirSync(join(clone, '.sdlc'), { recursive: true });
writeFileSync(
  join(clone, '.sdlc', 'config.json'),
  JSON.stringify({ engine: 'piv', git: { base: 'main' }, jira: { projects: ['SDLC'] }, confluence: { space: 'SDLC' }, work: { agent: 'copilot', maxPerRun: 2, timeoutMinutes: 30 } }, null, 2) + '\n',
);
writeFileSync(join(clone, '.gitignore'), '.sdlc/tickets/\n.sdlc/work/\n.sdlc/sync.log\n.sdlc/audit.jsonl*\n.sdlc/context/\n');
git('config', 'user.name', 'sdlc demo');
git('config', 'user.email', 'demo@example.invalid');
const inRepo = process.argv.includes('--in-repo');
if (inRepo) copyFileSync(join(repo, 'templates', 'ci', 'jenkins', 'Jenkinsfile.sdlc-work-inrepo'), join(clone, 'Jenkinsfile.sdlc-work'));
git('add', '.sdlc/config.json', '.gitignore', ...(inRepo ? ['Jenkinsfile.sdlc-work'] : []));
try {
  git('commit', '-qm', 'chore: sdlc config for unattended work');
  git('push', '-q', 'origin', 'HEAD:main');
  log('sandbox: .sdlc/config.json committed to main');
} catch {
  log('sandbox: config already in place');
}
rmSync(clone, { recursive: true, force: true });

// 2. Two stories: one clear, one too vague to build without asking.
const clear = await jira.createIssue({
  project: 'SDLC',
  issueType: 'Story',
  summary: 'CSV export: quote cells per RFC 4180',
  labels: [LABELS.ready],
  description: `**Goal:** Exported CSV opens correctly in Excel and Google Sheets when cells contain commas, quotes or line breaks.

## Acceptance criteria
- [ ] \`toCsv\` in \`src/reports/csv.ts\` wraps a cell in double quotes when it contains a comma, a double quote, CR or LF
- [ ] Double quotes inside a quoted cell are doubled (\`a"b\` becomes \`"a""b"\`)
- [ ] Cells without those characters are written unchanged
- [ ] Unit tests cover each case and run with \`npm test\` (Node's built-in \`node --test\`; no new dependencies)`,
});
const vague = await jira.createIssue({ project: 'SDLC', issueType: 'Story', summary: 'Make the exports better', labels: [LABELS.ready], description: 'Customers complain about the exports. Improve them.' });
log(`stories: ${clear.key} (clear), ${vague.key} (vague), both labelled ${LABELS.ready}`);

if (process.argv.includes('--no-trigger')) process.exit(0);

// 3. Trigger the poll job instead of waiting for its 5-minute timer, and follow it.
const jenkins = 'http://localhost:8081';
const auth = `Basic ${Buffer.from(`admin:${env('JENKINS_ADMIN_PASSWORD')}`).toString('base64')}`;
const crumbRes = await fetch(`${jenkins}/crumbIssuer/api/json`, { headers: { Authorization: auth } });
const crumb = (await crumbRes.json()) as { crumbRequestField: string; crumb: string };
const cookie = crumbRes.headers.get('set-cookie')?.split(';')[0] ?? '';
const next = ((await (await fetch(`${jenkins}/job/sdlc-work-poll/api/json`, { headers: { Authorization: auth } })).json()) as { nextBuildNumber: number }).nextBuildNumber;
await fetch(`${jenkins}/job/sdlc-work-poll/build`, { method: 'POST', headers: { Authorization: auth, Cookie: cookie, [crumb.crumbRequestField]: crumb.crumb } });
log(`jenkins: triggered sdlc-work-poll #${next} (${jenkins}/job/sdlc-work-poll/${next}/console)`);

for (;;) {
  await new Promise((r) => setTimeout(r, 20_000));
  const b = await fetch(`${jenkins}/job/sdlc-work-poll/${next}/api/json`, { headers: { Authorization: auth } });
  if (!b.ok) continue;
  const build = (await b.json()) as { building: boolean; result: string | null };
  if (build.building) continue;
  log(`jenkins: #${next} ${build.result}`);
  break;
}
for (const key of [clear.key, vague.key]) {
  const i = await jira.getIssue(key, 'status,labels');
  const last = (await jira.comments(key)).at(-1)?.body.split('\n')[0] ?? '';
  log(`${key}: ${i?.fields.status?.name} [${(i?.fields.labels ?? []).join(', ')}] ${last.slice(0, 160)}`);
}
