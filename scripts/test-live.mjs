// `npm run test:live`: run the live suites (local DC stack by default). Sets SDLC_LIVE=1 portably and passes any
// extra arguments to vitest, e.g. `npm run test:live -- packages/atlassian/test/pr.live.test.ts`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url).resolve('vitest/package.json');
const { bin } = JSON.parse(readFileSync(pkg, 'utf8'));
const vitest = join(dirname(pkg), typeof bin === 'string' ? bin : bin.vitest);
const r = spawnSync(process.execPath, [vitest, 'run', '--project', 'live', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, SDLC_LIVE: '1' },
});
process.exit(r.status ?? 1);
