// Global setup for the live project: live suites create and delete real issues, pages and PRs, so they only run
// when asked for (SDLC_LIVE=1, set by `npm run test:live`) and only against the local stack unless
// SDLC_LIVE_ALLOW_REMOTE=1 (e.g. the Cloud test site).
import { fileURLToPath } from 'node:url';
import { envLookup } from '../src/config.ts';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost)$/i;

export function remoteUrls(get: (k: string) => string): string[] {
  return ['JIRA_BASE_URL', 'CONFLUENCE_BASE_URL', 'BITBUCKET_BASE_URL']
    .map((k) => [k, get(k)] as const)
    .filter(([, url]) => {
      if (!url) return false;
      try {
        return !LOCAL.test(new URL(url).hostname);
      } catch {
        return true;
      }
    })
    .map(([k, url]) => `${k}=${url}`);
}

export default function setup() {
  if (process.env.SDLC_LIVE !== '1') {
    throw new Error('Live tests change real Jira/Confluence/Bitbucket data. Run them with `npm run test:live` (sets SDLC_LIVE=1).');
  }
  const remote = remoteUrls(envLookup({ cwd: fileURLToPath(new URL('../../..', import.meta.url)) }));
  if (remote.length && process.env.SDLC_LIVE_ALLOW_REMOTE !== '1') {
    throw new Error(`Live tests would run against non-local instances (${remote.join(', ')}). Set SDLC_LIVE_ALLOW_REMOTE=1 if that is intended.`);
  }
}
