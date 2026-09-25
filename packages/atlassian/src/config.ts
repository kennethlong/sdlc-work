import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type ProductConfig = { baseUrl: string; token: string };
export type AtlassianConfig = { jira?: ProductConfig; confluence?: ProductConfig };

/**
 * Resolve connection settings. Precedence: process env, then an env file. The env file is
 * `SDLC_ATLASSIAN_ENV` if set, else the nearest `infra/atlassian-dc/.env` walking up from `cwd` (the local DC
 * stack), else the per-user `~/.sdlc/atlassian.env` (for real instances, e.g. at work).
 * Variables: JIRA_BASE_URL, JIRA_PAT, CONFLUENCE_BASE_URL, CONFLUENCE_PAT.
 */
export function loadConfig(opts: { envFile?: string; cwd?: string } = {}): AtlassianConfig {
  const userFile = join(homedir(), '.sdlc', 'atlassian.env');
  const file =
    opts.envFile ?? process.env.SDLC_ATLASSIAN_ENV ?? findLocalStackEnv(opts.cwd ?? process.cwd()) ?? (existsSync(userFile) ? userFile : undefined);
  const fromFile = file && existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const get = (k: string) => process.env[k] || fromFile[k] || '';

  const product = (prefix: 'JIRA' | 'CONFLUENCE'): ProductConfig | undefined => {
    const baseUrl = get(`${prefix}_BASE_URL`);
    const token = get(`${prefix}_PAT`);
    return baseUrl && token ? { baseUrl, token } : undefined;
  };
  return { jira: product('JIRA'), confluence: product('CONFLUENCE') };
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
