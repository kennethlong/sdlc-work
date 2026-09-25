import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Data Center (self-hosted, PAT auth) or Cloud (*.atlassian.net, email + API token). */
export type Flavor = 'dc' | 'cloud';
export type Auth = { type: 'bearer'; token: string } | { type: 'basic'; user: string; token: string };
export type ProductConfig = { baseUrl: string; flavor: Flavor; auth: Auth };
export type AtlassianConfig = { jira?: ProductConfig; confluence?: ProductConfig };

/**
 * Resolve connection settings. Precedence: process env, then an env file. The env file is
 * `SDLC_ATLASSIAN_ENV` if set, else the nearest `infra/atlassian-dc/.env` walking up from `cwd` (the local DC
 * stack), else the per-user `~/.sdlc/atlassian.env` (for real instances, e.g. at work).
 *
 * Per product (JIRA_* / CONFLUENCE_*):
 *   <P>_BASE_URL                         required (Confluence Cloud: https://<site>.atlassian.net/wiki)
 *   <P>_PAT                              Data Center personal access token (Bearer)
 *   <P>_EMAIL + <P>_API_TOKEN            Cloud (Basic); ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN cover both products
 *   <P>_FLAVOR = dc | cloud              optional; default: cloud for *.atlassian.net / *.jira.com, else dc
 */
export type EnvOptions = { envFile?: string; cwd?: string };

/** Setting lookup shared by every integration: process env first, then the resolved env file (see loadConfig). */
export function envLookup(opts: EnvOptions = {}): (key: string) => string {
  const userFile = join(homedir(), '.sdlc', 'atlassian.env');
  // SDLC_ATLASSIAN_ENV=user selects the per-user file even inside a repo that has a local stack.
  const explicit = process.env.SDLC_ATLASSIAN_ENV === 'user' ? userFile : process.env.SDLC_ATLASSIAN_ENV;
  const file = opts.envFile ?? explicit ?? findLocalStackEnv(opts.cwd ?? process.cwd()) ?? (existsSync(userFile) ? userFile : undefined);
  const fromFile = file && existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return (k: string) => process.env[k] || fromFile[k] || '';
}

export function loadConfig(opts: EnvOptions = {}): AtlassianConfig {
  const get = envLookup(opts);

  const product = (p: 'JIRA' | 'CONFLUENCE'): ProductConfig | undefined => {
    const baseUrl = get(`${p}_BASE_URL`).replace(/\/+$/, '');
    if (!baseUrl) return undefined;
    const flavorVar = get(`${p}_FLAVOR`).toLowerCase();
    const flavor: Flavor = flavorVar === 'cloud' || flavorVar === 'dc' ? flavorVar : detectFlavor(baseUrl);
    const pat = get(`${p}_PAT`);
    const user = get(`${p}_EMAIL`) || get('ATLASSIAN_EMAIL');
    const apiToken = get(`${p}_API_TOKEN`) || get('ATLASSIAN_API_TOKEN');
    let auth: Auth | undefined;
    // Cloud has no PATs; DC PATs are preferred over basic auth (Confluence DC disables REST basic auth).
    if (flavor === 'dc' && pat) auth = { type: 'bearer', token: pat };
    else if (user && apiToken) auth = { type: 'basic', user, token: apiToken };
    else if (pat) auth = { type: 'bearer', token: pat };
    return auth ? { baseUrl, flavor, auth } : undefined;
  };
  return { jira: product('JIRA'), confluence: product('CONFLUENCE') };
}

export function detectFlavor(baseUrl: string): Flavor {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.endsWith('.atlassian.net') || host.endsWith('.jira.com') ? 'cloud' : 'dc';
  } catch {
    return 'dc';
  }
}

export function authHeader(auth: Auth): string {
  return auth.type === 'bearer' ? `Bearer ${auth.token}` : `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function findLocalStackEnv(start: string): string | undefined {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const candidate = join(dir, 'infra', 'atlassian-dc', '.env');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}
