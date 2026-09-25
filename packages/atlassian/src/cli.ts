#!/usr/bin/env node
/**
 * sdlc-atl: deterministic Jira/Confluence steps for the SDLC toolset.
 *
 * Track A (PRD -> epic -> stories):
 *   sdlc-atl breakdown                                         show the work breakdown the engine sees
 *   sdlc-atl file-breakdown --epic KEY [--prd PAGE_ID]         file it as stories under the epic + breakdown page
 * Track B (one ticket):
 *   sdlc-atl import KEY                                        write the ticket brief .sdlc/tickets/KEY.md
 *   sdlc-atl publish-rca KEY [--file docs/rca/KEY.md]          publish a bug's RCA to Confluence + the bug
 *   sdlc-atl escalate KEY --epic EPIC                          promote to Track A
 * Both:
 *   sdlc-atl sync                                              move issues forward, publish verification reports
 *   sdlc-atl whoami
 * Common options: --root DIR (default .), --engine gsd|piv, --dry-run, --json, --env FILE, --space KEY
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { connect } from './index.ts';
import { resolveEngine, readSdlcConfig } from './engines/index.ts';
import { fileBreakdown, type FilingReport } from './filing.ts';
import { StateFile } from './state.ts';
import { syncProgress, type SyncEntry, type SyncReport } from './sync.ts';
import { escalateTicket, importTicket, publishRca } from './tickets.ts';
import { cyclicItems, waves } from './work.ts';

const [command, ...rest] = process.argv.slice(2);
const { values: opt, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    root: { type: 'string', default: '.' },
    engine: { type: 'string' },
    epic: { type: 'string' },
    prd: { type: 'string' },
    space: { type: 'string' },
    file: { type: 'string' },
    'issue-type': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    env: { type: 'string' },
  },
});

const root = resolve(opt.root!);
const cfg = readSdlcConfig(root);
const out = (data: unknown, text: () => string) => console.log(opt.json ? JSON.stringify(data, null, 2) : text());
const clients = () => connect({ envFile: opt.env });
const keyArg = () => {
  const key = positionals[0]?.toUpperCase();
  if (!key || !/^[A-Z][A-Z0-9]*-\d+$/.test(key)) throw new Error(`${command} needs a Jira key, e.g. sdlc-atl ${command} PROJ-12`);
  return key;
};
/** Filed Jira keys by item id, so engines can match artifacts named after the key. */
const issueKeysOf = (state: StateFile) => Object.fromEntries(Object.entries(state.data.items).map(([id, v]) => [id, v.issueKey]));

try {
  switch (command) {
    case 'whoami': {
      const c = clients();
      const [j, cf] = await Promise.allSettled([c.jira.myself(), c.confluence.currentUser()]);
      console.log(`jira:       ${j.status === 'fulfilled' ? `${j.value.name} @ ${c.jira.baseUrl}` : j.reason.message}`);
      console.log(`confluence: ${cf.status === 'fulfilled' ? `${cf.value.username} @ ${c.confluence.baseUrl}` : cf.reason.message}`);
      break;
    }

    case 'breakdown': {
      const b = await resolveEngine(root, opt.engine).loadBreakdown(root, { issueKeys: issueKeysOf(new StateFile(root)) });
      out(b, () =>
        [
          `${b.title} (${b.engine}, ${b.items.length} items)`,
          ...waves(b.items).map((w, n) => `  Wave ${n + 1}: ${w.map((i) => `[${i.id}] ${i.title} (${i.status})`).join(' | ')}`),
          ...cyclicItems(b.items).map((id) => `  warning: ${id} is in a dependency cycle (placed in the last wave)`),
        ].join('\n'),
      );
      break;
    }

    case 'file-breakdown': {
      const epicKey = opt.epic ?? cfg.epic;
      if (!epicKey) throw new Error('--epic KEY is required (or set "epic" in .sdlc/config.json)');
      const prdPageId = opt.prd ?? cfg.prdPageId;
      const c = clients();
      const state = new StateFile(root);
      const report = await fileBreakdown({
        jira: c.jira,
        confluence: prdPageId ? c.confluence : undefined,
        breakdown: await resolveEngine(root, opt.engine).loadBreakdown(root, { issueKeys: issueKeysOf(state) }),
        epicKey,
        prdPageId,
        state,
        issueType: opt['issue-type'] ?? cfg.jira?.issueType,
        dryRun: opt['dry-run'],
      });
      out(report, () => formatFiling(report, opt['dry-run']!));
      break;
    }

    case 'sync': {
      const c = clients();
      let confluence;
      try {
        confluence = c.confluence;
      } catch {
        confluence = undefined; // reports are skipped without Confluence; transitions still sync
      }
      const state = new StateFile(root);
      const report = await syncProgress({
        jira: c.jira,
        confluence,
        breakdown: state.data.epic ? await resolveEngine(root, opt.engine).loadBreakdown(root, { issueKeys: issueKeysOf(state) }) : undefined,
        engineFor: (name) => resolveEngine(root, opt.engine ?? name, { fallback: true }),
        root,
        state,
        transitions: cfg.jira?.transitions,
        confluenceSpace: opt.space ?? cfg.confluence?.space,
        dryRun: opt['dry-run'],
      });
      out(report, () => formatSync(report, opt['dry-run']!));
      break;
    }

    case 'import': {
      const r = await importTicket({ jira: clients().jira, root, key: keyArg(), engine: resolveEngine(root, opt.engine, { fallback: true }), state: new StateFile(root) });
      out(r, () => `${r.key} (${r.type}) "${r.summary}" -> ${r.brief}${r.epic ? `\n  already in epic ${r.epic}: consider Track A (file-breakdown) instead` : ''}`);
      break;
    }

    case 'publish-rca': {
      const key = keyArg();
      const spaceKey = opt.space ?? cfg.confluence?.space;
      if (!spaceKey) throw new Error('Which Confluence space? Pass --space KEY or set confluence.space in .sdlc/config.json');
      const c = clients();
      const r = await publishRca({ jira: c.jira, confluence: c.confluence, root, key, spaceKey, file: opt.file, state: new StateFile(root) });
      out(r, () => [`RCA ${key}: ${r.page.action} ${r.page.url}${r.commented ? ' (commented on the bug)' : ''}`, ...r.warnings.map((w) => `  warning: ${w}`)].join('\n'));
      break;
    }

    case 'escalate': {
      const key = keyArg();
      if (!opt.epic) throw new Error('escalate needs --epic EPIC');
      await escalateTicket({ jira: clients().jira, key, epic: opt.epic.toUpperCase(), state: new StateFile(root) });
      console.log(`${key} escalated to ${opt.epic.toUpperCase()} (Track A). Next: PRD + ticket breakdown, then file-breakdown.`);
      break;
    }

    default:
      console.error('usage: sdlc-atl <breakdown | file-breakdown | import | publish-rca | escalate | sync | whoami> [options]  (see src/cli.ts)');
      process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`sdlc-atl: ${(e as Error).message}`);
  process.exit(1);
}

function formatFiling(r: FilingReport, dryRun: boolean): string {
  const lines = [`${dryRun ? '[dry run] ' : ''}Epic ${r.epic}:`];
  for (const i of r.items) lines.push(`  ${(i.key ?? '-').padEnd(10)} ${i.action.padEnd(13)} wave ${i.wave}  [${i.id}] ${i.title}`);
  const newLinks = r.links.filter((l) => l.action !== 'existing');
  if (newLinks.length) lines.push(`  links: ${newLinks.map((l) => `${l.from} blocks ${l.to} (${l.action})`).join(', ')}`);
  if (r.page) lines.push(`  page: ${r.page.title} (${r.page.action})${r.page.url ? ` ${r.page.url}` : ''}`);
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

function formatSync(r: SyncReport, dryRun: boolean): string {
  const row = (i: SyncEntry) => {
    const move = i.transition.action === 'none' ? '' : ` -> ${i.transition.to} (${i.transition.action})`;
    const rep = i.report ? `  report: ${i.report.action}${i.report.url ? ' ' + i.report.url : ''}` : '';
    return `  ${i.key!.padEnd(10)} ${i.status.padEnd(15)} ${i.jiraStatus ?? '?'}${move}${rep}`;
  };
  const lines = [`${dryRun ? '[dry run] ' : ''}Progress:`, ...r.items.map(row)];
  if (r.tickets.length) lines.push('Tickets:', ...r.tickets.map(row));
  if (r.unfiled.length) lines.push(`  not filed yet: ${r.unfiled.join(', ')} (run file-breakdown)`);
  return lines.join('\n');
}
