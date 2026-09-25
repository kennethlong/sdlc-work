// Re-publish the PR description and review on the showcase PR from the checkout seed-showcase.ts left behind.
// Usage: node scripts/republish-showcase-pr.ts <path to sdlc-showcase-code-* dir>
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, openPr, publishReview, resolveHost, StateFile } from '../packages/atlassian/src/index.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const code = process.argv[2];
if (!code) throw new Error('usage: node scripts/republish-showcase-pr.ts <checkout dir>');
const { jira, confluence } = connect({ cwd: repo });
const host = resolveHost(code, { cwd: repo });
const pr = await openPr({ root: code, host, jira, confluence, state: new StateFile(code), base: 'main' });
if (pr.pr) await host.updatePr(pr.pr, { body: pr.body }); // rewrite even when unchanged (e.g. after a marker-format change)
const review = await publishReview({ root: code, host, jira, file: join(code, '.sdlc/reviews/review.md'), base: 'main' });
console.log(`PR ${pr.action}: ${pr.pr?.url}; review comment ${review.comment}`);
