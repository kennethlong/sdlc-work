import type { EnvFile } from './env.ts';
import { appState } from './rest.ts';

/**
 * Bitbucket DC sets itself up unattended (SETUP_* env), so there is no wizard: once RUNNING, create an HTTP access
 * token for the admin (REST basic auth is enabled on Bitbucket DC), plus project SDLC and repo "sandbox" for tests.
 */
export async function setupBitbucket(env: EnvFile) {
  const port = env.get('BITBUCKET_PORT', '7990');
  const state = await appState(`http://localhost:${port}`);
  console.log(`bitbucket: ${state} at http://bitbucket.localhost:${port}`);
  if (state !== 'RUNNING') throw new Error(`bitbucket is ${state}; start the stack first (./dc.ps1 up)`);

  const base = `http://bitbucket.localhost:${port}`;
  const user = env.get('BITBUCKET_ADMIN_USER', 'admin');
  const basic = 'Basic ' + Buffer.from(`${user}:${env.get('BITBUCKET_ADMIN_PASSWORD')}`).toString('base64');
  const call = async (method: string, path: string, body?: unknown, tolerate: number[] = []) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: basic, Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (tolerate.includes(res.status)) return undefined;
    const text = await res.text();
    if (!res.ok) throw new Error(`bitbucket ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };

  if (!(await call('GET', '/rest/api/1.0/projects/SDLC', undefined, [404]))) {
    await call('POST', '/rest/api/1.0/projects', { key: 'SDLC', name: 'SDLC' });
    console.log('  bitbucket: created project SDLC');
  }
  if (!(await call('GET', '/rest/api/1.0/projects/SDLC/repos/sandbox', undefined, [404]))) {
    await call('POST', '/rest/api/1.0/projects/SDLC/repos', { name: 'sandbox', scmId: 'git', defaultBranch: 'main' });
    console.log('  bitbucket: created repo SDLC/sandbox');
  }
  if (!env.get('BITBUCKET_TOKEN')) {
    const t = await call('PUT', `/rest/access-tokens/1.0/users/${encodeURIComponent(user)}`, {
      name: 'sdlc-work',
      permissions: ['PROJECT_ADMIN', 'REPO_ADMIN'],
      expiryDays: 90,
    });
    env.set('BITBUCKET_TOKEN', t.token);
    console.log('  bitbucket: created HTTP access token -> .env BITBUCKET_TOKEN');
  }
  env.set('BITBUCKET_BASE_URL', base);
}
