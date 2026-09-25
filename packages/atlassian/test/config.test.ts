import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authHeader, detectFlavor, loadConfig } from '../src/config.ts';

const dirs: string[] = [];
const envFile = (lines: string[]) => {
  const d = mkdtempSync(join(tmpdir(), 'sdlc-cfg-'));
  dirs.push(d);
  const f = join(d, 'test.env');
  writeFileSync(f, lines.join('\n'));
  return f;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('config', () => {
  it('detects Cloud by host, overridable', () => {
    expect(detectFlavor('https://acme.atlassian.net')).toBe('cloud');
    expect(detectFlavor('https://acme.atlassian.net/wiki')).toBe('cloud');
    expect(detectFlavor('https://jira.acme.internal')).toBe('dc');
    expect(loadConfig({ envFile: envFile(['JIRA_BASE_URL=https://jira.acme.internal', 'JIRA_FLAVOR=cloud', 'JIRA_EMAIL=a@b.c', 'JIRA_API_TOKEN=t']) }).jira?.flavor).toBe('cloud');
  });

  it('uses PAT bearer auth for DC and email + API token basic auth for Cloud', () => {
    const cfg = loadConfig({
      envFile: envFile([
        'JIRA_BASE_URL=https://jira.acme.internal/',
        'JIRA_PAT=dc-pat',
        'CONFLUENCE_BASE_URL=https://acme.atlassian.net/wiki',
        'ATLASSIAN_EMAIL=me@acme.com',
        'ATLASSIAN_API_TOKEN=cloud-token',
      ]),
    });
    expect(cfg.jira).toEqual({ baseUrl: 'https://jira.acme.internal', flavor: 'dc', auth: { type: 'bearer', token: 'dc-pat' } });
    expect(cfg.confluence).toEqual({ baseUrl: 'https://acme.atlassian.net/wiki', flavor: 'cloud', auth: { type: 'basic', user: 'me@acme.com', token: 'cloud-token' } });
    expect(authHeader(cfg.confluence!.auth)).toBe('Basic ' + Buffer.from('me@acme.com:cloud-token').toString('base64'));
  });

  it('is unconfigured without credentials', () => {
    expect(loadConfig({ envFile: envFile(['JIRA_BASE_URL=https://acme.atlassian.net']) }).jira).toBeUndefined();
  });
});
