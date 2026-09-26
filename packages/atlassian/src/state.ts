import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lockSync } from './lock.ts';

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

const MAPS = ['items', 'tickets', 'prs'] as const;

/**
 * Several sdlc-atl processes can hold the state at once (a background hook sync while `pr` runs), each for a
 * while. So `save()` never writes its whole in-memory copy: under a short lock it re-reads the file and applies
 * only what this process changed since it loaded (per map entry and per scalar), then replaces the file
 * atomically (temp file + rename). Concurrent writers therefore don't erase each other's entries.
 */
export class StateFile {
  readonly path: string;
  data: BridgeState;
  private base: BridgeState;

  constructor(root: string) {
    this.path = join(root, '.sdlc', 'atlassian.json');
    this.data = this.read();
    this.base = structuredClone(this.data);
  }

  private read(): BridgeState {
    const data = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as BridgeState) : { items: {} };
    data.items ??= {};
    return data;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const release = lockSync(`${this.path}.lock`);
    try {
      const merged = mergeState(this.base, this.data, this.read());
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n');
      renameSync(tmp, this.path);
      this.data = merged;
      this.base = structuredClone(merged);
    } finally {
      release();
    }
  }
}

/** Three-way merge: start from `disk` and apply the changes between `base` (as loaded) and `mine`. */
export function mergeState(base: BridgeState, mine: BridgeState, disk: BridgeState): BridgeState {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const out = structuredClone(disk) as BridgeState & Record<string, unknown>;
  const b = base as BridgeState & Record<string, unknown>;
  const m = mine as BridgeState & Record<string, unknown>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(m)])) {
    if ((MAPS as readonly string[]).includes(k)) continue;
    if (!same(b[k], m[k])) {
      if (m[k] === undefined) delete out[k];
      else out[k] = structuredClone(m[k]);
    }
  }
  for (const map of MAPS) {
    const bm = (base[map] ?? {}) as Record<string, unknown>;
    const mm = (mine[map] ?? {}) as Record<string, unknown>;
    const om = { ...((out[map] ?? {}) as Record<string, unknown>) };
    for (const k of new Set([...Object.keys(bm), ...Object.keys(mm)])) {
      if (same(bm[k], mm[k])) continue;
      if (mm[k] === undefined) delete om[k];
      else om[k] = structuredClone(mm[k]);
    }
    if (map === 'items' || Object.keys(om).length || out[map]) (out as Record<string, unknown>)[map] = om;
  }
  return out;
}
