export { loadConfig, parseEnv, type AtlassianConfig, type ProductConfig } from './config.ts';
export { AtlassianError, HttpClient } from './http.ts';
export { JiraClient, type JiraIssue, type NewIssue } from './jira.ts';
export { ConfluenceClient, type ConfluencePage } from './confluence.ts';
export { jiraWikiToMarkdown, markdownToJiraWiki, markdownToStorage, storageToMarkdown } from './markup.ts';

import { loadConfig } from './config.ts';
import { JiraClient } from './jira.ts';
import { ConfluenceClient } from './confluence.ts';

/** Clients from env / local stack config; throws with a clear message when a product isn't configured. */
export function connect(opts?: Parameters<typeof loadConfig>[0]) {
  const cfg = loadConfig(opts);
  let jira: JiraClient | undefined;
  let confluence: ConfluenceClient | undefined;
  return {
    get jira() {
      if (!cfg.jira) throw new Error('Jira not configured: set JIRA_BASE_URL and JIRA_PAT (or run infra/atlassian-dc/dc.ps1 up).');
      return (jira ??= new JiraClient(cfg.jira));
    },
    get confluence() {
      if (!cfg.confluence) throw new Error('Confluence not configured: set CONFLUENCE_BASE_URL and CONFLUENCE_PAT.');
      return (confluence ??= new ConfluenceClient(cfg.confluence));
    },
  };
}
