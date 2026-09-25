import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `.sdlc/atlassian.json`: which Jira issue / Confluence page each work item maps to. Engine-neutral. */
export type BridgeState = {
  epic?: string;
  breakdownPageId?: string;
  items: Record<string, { issueKey: string; verificationPageId?: string }>;
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
