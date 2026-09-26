import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain JS module (the wizard must run on old Node versions)
import { isCloud, mask, mergeEnv, networkReason, normaliseUrl, parseEnv, portSkill, probe } from '../../../scripts/setup/lib.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));

describe('setup wizard: env file', () => {
  it('parses KEY=VALUE, ignoring comments and quotes', () => {
    expect(parseEnv('# c\nJIRA_BASE_URL=https://j\nexport JIRA_PAT="abc"\n\nBAD LINE')).toEqual({ JIRA_BASE_URL: 'https://j', JIRA_PAT: 'abc' });
  });

  it('updates in place, keeps comments and unrelated keys, appends new ones, removes undefined', () => {
    const text = '# mine\nJIRA_PAT=old\nOTHER=1\nCONFLUENCE_PAT=x\n';
    expect(mergeEnv(text, { JIRA_PAT: 'new', BITBUCKET_TOKEN: 't', CONFLUENCE_PAT: undefined })).toBe('# mine\nJIRA_PAT=new\nOTHER=1\nBITBUCKET_TOKEN=t\n');
  });

  it('never shows a whole secret', () => {
    expect(mask('')).toBe('(not set)');
    expect(mask('short')).toBe('•••••');
    expect(mask('ABCDEFGHIJKLMNOP')).toBe('ABCD…MNOP (16 chars)');
  });
});

describe('setup wizard: URLs and probes', () => {
  it('normalises pasted URLs', () => {
    expect(normaliseUrl('jira.acme.com/secure/Dashboard.jspa', 'jira')).toBe('https://jira.acme.com');
    expect(normaliseUrl('https://acme.atlassian.net/', 'confluence')).toBe('https://acme.atlassian.net/wiki');
    expect(normaliseUrl('https://wiki.acme.com/confluence/display/ENG/Home', 'confluence')).toBe('https://wiki.acme.com/confluence');
  });

  it('knows Cloud from Data Center and what to call', () => {
    expect(isCloud('https://acme.atlassian.net')).toBe(true);
    expect(isCloud('https://jira.acme.com')).toBe(false);
    expect(probe('bitbucket', 'https://bb')).toBe('https://bb/rest/api/1.0/projects?limit=1');
  });

  it('recognises TLS inspection', () => {
    expect(networkReason({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }).kind).toBe('tls');
    expect(networkReason({ cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } }).kind).toBe('tls');
    expect(networkReason({ cause: { code: 'ENOTFOUND' } }).kind).toBe('dns');
  });
});

describe('setup wizard: porting skills to other agents', () => {
  const skill = (n: string) => readFileSync(`${repo}/plugins/sdlc/skills/${n}/SKILL.md`, 'utf8');

  it('renames, uses the CLI on PATH, and names the arguments', () => {
    const t = portSkill(skill('fix'), 'fix');
    expect(t).toMatch(/^name: sdlc-fix$/m);
    expect(t).toContain('docs/rca/<jira-bug-key>.md');
    expect(t).toContain('/sdlc-rca <jira-bug-key>');
    expect(t).not.toMatch(/\$1|\$ARGUMENTS|CLAUDE_PLUGIN_ROOT|\/sdlc:/);
  });

  it('leaves no Claude-only syntax in any skill', () => {
    const all = readdirSync(`${repo}/plugins/sdlc/skills`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(all.length).toBeGreaterThanOrEqual(16);
    for (const n of all) {
      expect(portSkill(skill(n), n), n).not.toMatch(/\$\d|\$ARGUMENTS|CLAUDE_PLUGIN_ROOT|\/sdlc:[a-z]/);
    }
  });

  it('pins the same mcp-atlassian version as the MCP launcher', () => {
    const v = (f: string, re: RegExp) => readFileSync(`${repo}/${f}`, 'utf8').match(re)?.[1];
    expect(v('scripts/setup/main.mjs', /MCP_ATLASSIAN_VERSION = '([\d.]+)'/)).toBe(v('scripts/mcp-atlassian.mjs', /MCP_ATLASSIAN_VERSION \?\? '([\d.]+)'/));
  });
});
