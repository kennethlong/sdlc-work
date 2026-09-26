import { describe, expect, it } from 'vitest';
import { remoteUrls } from './live-guard.ts';

describe('live-test guard', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k] ?? '';

  it('treats the local stack as local', () => {
    expect(remoteUrls(env({ JIRA_BASE_URL: 'http://jira.localhost:8080', CONFLUENCE_BASE_URL: 'http://localhost:8090', BITBUCKET_BASE_URL: 'http://127.0.0.1:7990' }))).toEqual([]);
  });

  it('flags work and Cloud instances', () => {
    expect(remoteUrls(env({ JIRA_BASE_URL: 'https://jira.example.com', CONFLUENCE_BASE_URL: 'https://x.atlassian.net/wiki' }))).toEqual([
      'JIRA_BASE_URL=https://jira.example.com',
      'CONFLUENCE_BASE_URL=https://x.atlassian.net/wiki',
    ]);
  });

  it('does not let a lookalike host pass as local', () => {
    expect(remoteUrls(env({ JIRA_BASE_URL: 'https://localhost.evil.com' }))).toHaveLength(1);
  });
});
