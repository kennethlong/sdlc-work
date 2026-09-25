#!/usr/bin/env node
/**
 * sdlc-atl: deterministic Jira/Confluence steps for the SDLC toolset.
 *
 *   sdlc-atl whoami
 *   sdlc-atl breakdown [--root .] [--engine gsd]                         show the work breakdown that would be filed
 *   sdlc-atl file-breakdown --epic KEY [--prd PAGE_ID] [--dry-run] ...   file it as stories + publish under the PRD
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { connect } from './index.ts';
import { resolveEngine, readSdlcConfig } from './engines/index.ts';
import { fileBreakdown, type FilingReport } from './filing.ts';
import { StateFile } from './state.ts';
import { waves } from './work.ts';

const [command, ...rest] = process.argv.slice(2);
const { values: opt } = parseArgs({
  args: rest,
  options: {
    root: { type: 'string', default: '.' },
    engine: { type: 'string' },
    epic: { type: 'string' },
    prd: { type: 'string' },
    'issue-type': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    env: { type: 'string' },
  },
});

const root = resolve(opt.root!);
const out = (data: unknown, text: () => string) => console.log(opt.json ? JSON.stringify(data, null, 2) : text());

try {
  switch (command) {
    case 'whoami': {
      const c = connect({ envFile: opt.env });
      const [j, cf] = await Promise.allSettled([c.jira.myself(), c.confluence.currentUser()]);
      console.log(`jira:       ${j.status === 'fulfilled' ? `${j.value.name} @ ${c.jira.baseUrl}` : j.reason.message}`);
      console.log(`confluence: ${cf.status === 'fulfilled' ? `${cf.value.username} @ ${c.confluence.baseUrl}` : cf.reason.message}`);
      break;
    }
    case 'breakdown': {
      const b = await resolveEngine(root, opt.engine).loadBreakdown(root);
      out(b, () =>
        [
          `${b.title} (${b.engine}, ${b.items.length} items)`,
          ...waves(b.items).map((w, n) => `  Wave ${n + 1}: ${w.map((i) => `[${i.id}] ${i.title} (${i.status})`).join(' | ')}`),
        ].join('\n'),
      );
      break;
    }
    case 'file-breakdown': {
      const cfg = readSdlcConfig(root);
      const epicKey = opt.epic ?? cfg.epic;
      if (!epicKey) throw new Error('--epic KEY is required (or set "epic" in .sdlc/config.json)');
      const prdPageId = opt.prd ?? cfg.prdPageId;
      const c = connect({ envFile: opt.env });
      const report = await fileBreakdown({
        jira: c.jira,
        confluence: prdPageId ? c.confluence : undefined,
        breakdown: await resolveEngine(root, opt.engine ?? cfg.engine).loadBreakdown(root),
        epicKey,
        prdPageId,
        state: new StateFile(root),
        issueType: opt['issue-type'],
        dryRun: opt['dry-run'],
      });
      out(report, () => formatReport(report, opt['dry-run']!));
      break;
    }
    default:
      console.error('usage: sdlc-atl <whoami | breakdown | file-breakdown> [options]   (see src/cli.ts header)');
      process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`sdlc-atl: ${(e as Error).message}`);
  process.exit(1);
}

function formatReport(r: FilingReport, dryRun: boolean): string {
  const lines = [`${dryRun ? '[dry run] ' : ''}Epic ${r.epic}:`];
  for (const i of r.items) lines.push(`  ${(i.key ?? '-').padEnd(10)} ${i.action.padEnd(13)} wave ${i.wave}  [${i.id}] ${i.title}`);
  const newLinks = r.links.filter((l) => l.action !== 'existing');
  if (newLinks.length) lines.push(`  links: ${newLinks.map((l) => `${l.from} blocks ${l.to} (${l.action})`).join(', ')}`);
  if (r.page) lines.push(`  page: ${r.page.title} (${r.page.action})${r.page.url ? ` ${r.page.url}` : ''}`);
  return lines.join('\n');
}
