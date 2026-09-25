import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `.sdlc/atlassian.json`: which Jira issue / Confluence page each work item maps to. Engine-neutral. */
export type BridgeState = {
  epic?: string;
  breakdownPageId?: string;
  items: Record<string, { issueKey: string; verificationPageId?: string }>;
  /** Track B tickets imported with `sdlc-atl import`, by Jira key. */
  tickets?: Record<string, TicketState>;
  /** PRs opened with `sdlc-atl pr`, by branch. */
  prs?: Record<string, { id: string; url: string; host: string; repo: string; key?: string }>;
};

export type TicketState = {
  type?: string;
  summary?: string;
  engine?: string;
  verificationPageId?: string;
  rcaPageId?: string;
  escalatedTo?: string;
};

export class StateFile {
  readonly path: string;
  data: BridgeState;

  constructor(root: string) {
    this.path = join(root, '.sdlc', 'atlassian.json');
    this.data = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as BridgeState) : { items: {} };
    this.data.items ??= {};
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n');
  }
}
