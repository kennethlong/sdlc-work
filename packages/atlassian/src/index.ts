export { authHeader, detectFlavor, loadConfig, parseEnv, type AtlassianConfig, type Auth, type Flavor, type ProductConfig } from './config.ts';
export { AtlassianError, HttpClient } from './http.ts';
export { JiraClient, type JiraIssue, type NewIssue } from './jira.ts';
export { ConfluenceClient, type ConfluencePage } from './confluence.ts';
export { ConfluenceCloudClient } from './confluence-cloud.ts';
export { jiraWikiToMarkdown, markdownToJiraWiki, markdownToStorage, storageToMarkdown } from './markup.ts';

import { loadConfig } from './config.ts';
import { JiraClient } from './jira.ts';
import { ConfluenceClient } from './confluence.ts';
import { ConfluenceCloudClient } from './confluence-cloud.ts';

/** Clients from env / local stack config; throws with a clear message when a product isn't configured. */
export function connect(opts?: Parameters<typeof loadConfig>[0]) {
  const cfg = loadConfig(opts);
  let jira: JiraClient | undefined;
  let confluence: ConfluenceClient | undefined;
  return {
    get jira() {
      if (!cfg.jira) throw new Error('Jira not configured: set JIRA_BASE_URL plus JIRA_PAT (Data Center) or JIRA_EMAIL + JIRA_API_TOKEN (Cloud), e.g. in ~/.sdlc/atlassian.env.');
      return (jira ??= new JiraClient(cfg.jira));
    },
    get confluence() {
      if (!cfg.confluence) throw new Error('Confluence not configured: set CONFLUENCE_BASE_URL plus CONFLUENCE_PAT (Data Center) or CONFLUENCE_EMAIL + CONFLUENCE_API_TOKEN (Cloud; base URL ends in /wiki).');
      return (confluence ??= cfg.confluence.flavor === 'cloud' ? new ConfluenceCloudClient(cfg.confluence) : new ConfluenceClient(cfg.confluence));
    },
  };
}

export { waves, type Breakdown, type Engine, type EngineName, type LoadOptions, type TicketProgress, type Verification, type WorkItem, type WorkStatus } from './work.ts';
export { GsdEngine, PivEngine, resolveEngine, readSdlcConfig, type SdlcConfig } from './engines/index.ts';
export { fileBreakdown, itemLabel, storyDescription, type FilingReport } from './filing.ts';
export { StateFile, type BridgeState, type TicketState } from './state.ts';
export { DEFAULT_TRANSITIONS, syncProgress, type SyncEntry, type SyncReport, type TransitionMap } from './sync.ts';
export { acceptanceCriteria, escalateTicket, importTicket, publishRca, type ImportResult, type RcaReport } from './tickets.ts';
