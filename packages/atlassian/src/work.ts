/** Engine-neutral work breakdown: what gets filed as tickets, whatever engine planned it. */

/**
 * Lifecycle of a work item, in order. `needs_attention` = verified with gaps or needing a human check.
 * `complete` = verified (passed), or marked done in the plan.
 */
export type WorkStatus = 'not_started' | 'discussed' | 'planned' | 'executing' | 'needs_attention' | 'complete';

export type Verification = {
  /** Engine's verdict, e.g. GSD: passed | gaps_found | human_needed. */
  status: string;
  score?: string;
  verifiedAt?: string;
  /** Report body (markdown, front matter stripped). */
  markdown: string;
  /** Repo-relative path of the report. */
  path: string;
};

export type WorkItem = {
  /** Engine-local id, stable across re-runs (GSD: phase number, e.g. "2" or "2.1"). */
  id: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  requirements: string[];
  /** Ids of items this one depends on. */
  dependsOn: string[];
  status: WorkStatus;
  /** Where the item lives in the repo, for the ticket's "Source" line (e.g. ".planning/ROADMAP.md#phase-2"). */
  source: string;
  /** Latest verification report, if the item has been verified (pass or fail). */
  verification?: Verification;
};

export type Breakdown = {
  engine: EngineName;
  title: string;
  overview: string;
  items: WorkItem[];
};

export type EngineName = 'gsd' | 'piv';

export interface Engine {
  readonly name: EngineName;
  /** True if `root` holds this engine's planning artifacts. */
  detect(root: string): boolean;
  loadBreakdown(root: string): Promise<Breakdown>;
}

/**
 * Group items into execution waves: each wave's items depend only on earlier waves. Unknown dependency ids are
 * ignored (e.g. a phase from a finished milestone). Throws on cycles.
 */
export function waves(items: WorkItem[]): WorkItem[][] {
  const ids = new Set(items.map((i) => i.id));
  const placed = new Set<string>();
  const out: WorkItem[][] = [];
  let remaining = items;
  while (remaining.length) {
    const wave = remaining.filter((i) => i.dependsOn.every((d) => !ids.has(d) || placed.has(d)));
    if (!wave.length) throw new Error(`Dependency cycle among: ${remaining.map((i) => i.id).join(', ')}`);
    wave.forEach((i) => placed.add(i.id));
    out.push(wave);
    remaining = remaining.filter((i) => !placed.has(i.id));
  }
  return out;
}
