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
  /** Files the item is expected to touch (spec "Files touched"), for the parallel-work overlap check. */
  files?: string[];
  /** Jira issue type for this item (spec "Type:" line, e.g. Task for chores); default Story. */
  issueType?: string;
};

export type Breakdown = {
  engine: EngineName;
  title: string;
  overview: string;
  items: WorkItem[];
};

export type EngineName = 'gsd' | 'piv';

export type LoadOptions = {
  /** Item id -> filed Jira key, so engines can also recognise artifacts named after the key (e.g. "sdlc-5-…"). */
  issueKeys?: Record<string, string>;
};

/** Progress of a Track B ticket (a single Jira story/bug worked outside any breakdown). */
export type TicketProgress = { status: WorkStatus; verification?: Verification; artifacts: string[] };

export interface Engine {
  readonly name: EngineName;
  /** True if `root` holds this engine's planning artifacts. */
  detect(root: string): boolean;
  loadBreakdown(root: string, opts?: LoadOptions): Promise<Breakdown>;
  /** Progress of the work done for one Jira key (Track B), found via the engine's artifacts that name the key. */
  ticketProgress(root: string, key: string): Promise<TicketProgress>;
  /** What to run next for an imported ticket, shown in the ticket brief. */
  nextSteps(key: string, summary: string, isBug: boolean): string[];
}

/**
 * Group items into execution waves: each wave's items depend only on earlier waves. Unknown dependency ids are
 * ignored (e.g. a phase from a finished milestone). Items caught in a dependency cycle (dependencies come from
 * human-written text, so this happens) go into one final wave; `strict` throws instead. See `cyclicItems`.
 */
export function waves(items: WorkItem[], opts: { strict?: boolean } = {}): WorkItem[][] {
  const ids = new Set(items.map((i) => i.id));
  const placed = new Set<string>();
  const out: WorkItem[][] = [];
  let remaining = items;
  while (remaining.length) {
    const wave = remaining.filter((i) => i.dependsOn.every((d) => !ids.has(d) || placed.has(d)));
    if (!wave.length) {
      if (opts.strict) throw new Error(`Dependency cycle among: ${remaining.map((i) => i.id).join(', ')}`);
      out.push(remaining);
      break;
    }
    wave.forEach((i) => placed.add(i.id));
    out.push(wave);
    remaining = remaining.filter((i) => !placed.has(i.id));
  }
  return out;
}

/** Ids that can't be ordered (in or behind a dependency cycle); empty when the graph is acyclic. */
export function cyclicItems(items: WorkItem[]): string[] {
  try {
    waves(items, { strict: true });
    return [];
  } catch {
    const ordered = new Set(waves(items).slice(0, -1).flat().map((i) => i.id));
    return items.filter((i) => !ordered.has(i.id)).map((i) => i.id);
  }
}

/**
 * Items in the same wave run in parallel (separate worktrees or developers); if they expect to touch the same
 * file they will conflict. One warning per overlapping pair. Paths match exactly or as a directory prefix.
 */
export function fileOverlaps(items: WorkItem[]): string[] {
  const norm = (f: string) => f.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  const touches = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const out: string[] = [];
  for (const [n, wave] of waves(items).entries()) {
    for (let i = 0; i < wave.length; i++) {
      for (let j = i + 1; j < wave.length; j++) {
        const a = wave[i]!, b = wave[j]!;
        const shared = (a.files ?? []).filter((fa) => (b.files ?? []).some((fb) => touches(norm(fa), norm(fb))));
        if (shared.length) {
          out.push(`Wave ${n + 1}: ${a.id} and ${b.id} both touch ${shared.join(', ')}; make one depend on the other or split the shared change out`);
        }
      }
    }
  }
  return out;
}

/** Everything worth warning about before filing: dependency cycles and file overlaps within a wave. */
export function breakdownWarnings(items: WorkItem[]): string[] {
  const cyclic = cyclicItems(items);
  return [
    ...(cyclic.length ? [`Dependency cycle (check the plan's dependencies); filed in a final wave: ${cyclic.join(', ')}`] : []),
    ...fileOverlaps(items),
  ];
}
