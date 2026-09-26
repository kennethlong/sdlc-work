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
 * Review + PR (GitHub or Bitbucket Data Center, from the origin remote):
 *   sdlc-atl review-scope [--base B]                           what a review covers (base...HEAD), as JSON
 *   sdlc-atl pr [--base B] [--draft] [--title T] [--dry-run]    open or update the PR for this branch, link Jira
 *   sdlc-atl publish-review FILE [--gate]                      post a review file to the PR (+ Bitbucket annotations, Jira)
 * Both:
 *   sdlc-atl sync [--quiet]                                    move issues forward, publish verification reports
 *   sdlc-atl page pull PAGE_ID [--out FILE]                    Confluence page -> markdown (e.g. a PRD)
 *   sdlc-atl page push FILE --space KEY [--title T] [--parent ID]   markdown -> Confluence page (create/update)
 *   sdlc-atl hooks install|uninstall|status                    git post-commit hook that runs sync automatically
 *   sdlc-atl init [--engine E] [--epic KEY] [--prd ID] [--space KEY]   write .sdlc/config.json
 *   sdlc-atl whoami
 * Common options: --root DIR (default .), --engine gsd|piv, --dry-run, --json, --env FILE, --space KEY
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hookInstalled, installHook, selfCommand, uninstallHook, withLock } from './automation.ts';
import { ensureRulesFiles } from './rules.ts';
import { ConfluenceClient } from './confluence.ts';
import { connect } from './index.ts';
import { resolveEngine, readSdlcConfig } from './engines/index.ts';
import { fileBreakdown, type FilingReport } from './filing.ts';
import { StateFile } from './state.ts';
import { syncProgress, type SyncEntry, type SyncReport } from './sync.ts';
import { escalateTicket, importTicket, publishRca } from './tickets.ts';
import { reviewScope } from './git.ts';
import { resolveHost } from './hosts/index.ts';
import { openPr, publishReview, resolveKey } from './pr.ts';
import { breakdownWarnings, waves } from './work.ts';

const USAGE = `sdlc-atl: Jira/Confluence/PR steps for the sdlc skills.

Track A (PRD -> epic -> stories)
  breakdown                                    show the work breakdown the engine sees
  file-breakdown --epic KEY [--prd PAGE_ID]    file it as stories under the epic + a breakdown page
Track B (one ticket)
  import KEY                                   write the ticket brief .sdlc/tickets/KEY.md
  publish-rca KEY [--file docs/rca/KEY.md]     publish a bug's RCA to Confluence and the bug
  escalate KEY --epic EPIC                     promote a ticket to Track A
Review and PR (GitHub or Bitbucket Data Center, from the origin remote)
  review-scope [--base B]                      what a review covers (base...HEAD), as JSON
  pr [--base B] [--draft] [--title T] [--branch B] [--dry-run]    open or update the PR, link Jira
  publish-review FILE [--gate] [--branch B] [--pr ID]             post a review to the PR (+ annotations, Jira)
Both
  sync [--quiet] [--dry-run]                   move issues forward, publish verification reports
  page pull PAGE_ID [--out FILE]               Confluence page -> markdown
  page push FILE --space KEY [--title T] [--parent ID]            markdown -> Confluence page
  hooks install|uninstall|status               git post-commit hook that runs sync automatically
  init [--engine gsd|piv] [--epic KEY] [--prd ID] [--space KEY]   .sdlc/config.json + AGENTS.md/CLAUDE.md
  whoami                                       check the Jira and Confluence connection

Common options: --root DIR, --engine gsd|piv, --dry-run, --json, --env FILE, --space KEY
Credentials: ~/.sdlc/atlassian.env (set up with \`node setup.mjs\` in the sdlc-work clone).`;

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const [command, ...rest] = argv;
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
    out: { type: 'string' },
    title: { type: 'string' },
    parent: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    base: { type: 'string' },
    draft: { type: 'boolean', default: false },
    gate: { type: 'boolean', default: false },
    key: { type: 'string' },
    branch: { type: 'string' },
    pr: { type: 'string' },
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
          ...breakdownWarnings(b.items).map((w) => `  warning: ${w}`),
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
      const result = await withLock(root, async () => {
        const c = clients();
        let confluence;
        try {
          confluence = c.confluence;
        } catch {
          confluence = undefined; // reports are skipped without Confluence; transitions still sync
        }
        const state = new StateFile(root);
        return syncProgress({
          jira: c.jira,
          confluence,
          breakdown: state.data.epic ? await resolveEngine(root, opt.engine).loadBreakdown(root, { issueKeys: issueKeysOf(state) }) : undefined,
          engineFor: (name) => resolveEngine(root, opt.engine ?? name, { fallback: true }),
          root,
          state,
          transitions: cfg.jira?.transitions,
          hold: cfg.jira?.hold,
          confluenceSpace: opt.space ?? cfg.confluence?.space,
          dryRun: opt['dry-run'],
          doneWhen: cfg.jira?.doneWhen,
          prState: cfg.jira?.doneWhen === 'merged' ? async (id) => (await resolveHost(root, { envFile: opt.env }).getPr(id))?.state : undefined,
        });
      });
      if (result === 'locked') {
        if (!opt.quiet) console.log('sync already running (.sdlc/sync.lock); skipped');
        break;
      }
      if (opt.quiet) {
        // Hook mode: one timestamped line per change, nothing when nothing changed.
        const changes = [...result.items, ...result.tickets].filter((i) => i.transition.action === 'moved' || ['created', 'updated'].includes(i.report?.action ?? ''));
        for (const i of changes) console.log(`${new Date().toISOString()} ${i.key} ${i.status}: ${i.transition.action === 'moved' ? `-> ${i.transition.to}` : ''} ${i.report ? `report ${i.report.action}` : ''}`.trim());
      } else out(result, () => formatSync(result, opt['dry-run']!));
      // Errors go to stderr in every mode (the hook's log keeps them), and fail the command.
      for (const i of [...result.items, ...result.tickets].filter((x) => x.error)) console.error(`${new Date().toISOString()} ${i.key}: sync failed: ${i.error}`);
      if (result.errors) process.exitCode = 1;
      break;
    }

    case 'review-scope': {
      const s = reviewScope(root, opt.base ?? cfg.git?.base, opt.branch);
      // A validated key (configured projects, else a Jira lookup), not just the first look-alike in the branch name.
      let jira;
      try {
        jira = clients().jira;
      } catch {
        jira = undefined;
      }
      s.key = await resolveKey({ texts: [s.branch, ...s.commits], projects: cfg.jira?.projects, jira });
      out(s, () => JSON.stringify(s, null, 2));
      break;
    }

    case 'pr': {
      const c = clients();
      const optional = <T,>(f: () => T) => {
        try {
          return f();
        } catch {
          return undefined; // Jira/Confluence are optional for PRs
        }
      };
      const r = await openPr({
        root,
        host: resolveHost(root, { envFile: opt.env }),
        jira: optional(() => c.jira),
        confluence: optional(() => c.confluence),
        state: new StateFile(root),
        base: opt.base ?? cfg.git?.base,
        title: opt.title,
        key: opt.key?.toUpperCase(),
        draft: opt.draft,
        dryRun: opt['dry-run'],
        reviewStatus: cfg.jira?.transitions?.review,
        branch: opt.branch,
        projects: cfg.jira?.projects,
      });
      for (const w of r.warnings ?? []) console.error(`warning: ${w}`);
      out(r, () => `${r.action}: ${r.pr?.url ?? '(new PR)'}\n  title: ${r.title}${r.key ? `\n  jira: ${r.key}` : ''}${opt['dry-run'] ? `\n--- body ---\n${r.body}` : ''}`);
      break;
    }

    case 'publish-review': {
      const file = positionals[0];
      if (!file) throw new Error('publish-review FILE [--gate]');
      let jira;
      try {
        jira = clients().jira;
      } catch {
        jira = undefined;
      }
      const r = await publishReview({ root, host: resolveHost(root, { envFile: opt.env }), jira, file: resolve(file), base: opt.base ?? cfg.git?.base, branch: opt.branch, prId: opt.pr, projects: cfg.jira?.projects });
      out(r, () =>
        [
          `review ${r.verdict}: ${Object.entries(r.counts).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ') || 'no findings'}`,
          `  PR comment ${r.comment}: ${r.pr.url}`,
          `  line annotations: ${r.annotations ? 'published (Code Insights)' : 'not supported by this host (summary comment only)'}`,
          `  jira: ${r.jiraCommented ? 'commented' : 'no change'}`,
        ].join('\n'),
      );
      if (opt.gate && r.blocking) {
        console.error(`gate: ${r.blocking} blocking (critical/high) finding(s)`);
        process.exit(2);
      }
      break;
    }

    case 'page': {
      const [sub, arg] = positionals;
      const c = clients();
      if (sub === 'pull') {
        if (!arg) throw new Error('page pull PAGE_ID [--out FILE]');
        const page = await c.confluence.getPage(arg);
        if (!page) throw new Error(`Confluence page ${arg} not found`);
        const md = `<!-- source: ${c.confluence.pageUrl(page)} (page ${page.id}, v${page.version?.number}) -->\n\n# ${page.title}\n\n${ConfluenceClient.markdown(page)}\n`;
        if (opt.out) {
          mkdirSync(dirname(resolve(opt.out)), { recursive: true });
          writeFileSync(resolve(opt.out), md);
          console.log(`${page.title} -> ${opt.out}`);
        } else process.stdout.write(md);
      } else if (sub === 'push') {
        if (!arg) throw new Error('page push FILE --space KEY [--title T] [--parent PAGE_ID]');
        const spaceKey = opt.space ?? cfg.confluence?.space;
        if (!spaceKey) throw new Error('page push needs --space KEY (or confluence.space in .sdlc/config.json)');
        let md = readFileSync(resolve(arg), 'utf8').replace(/^﻿/, '').replace(/^<!-- source: [^\n]*-->\n+/, '');
        const h1 = md.match(/^#\s+(.+)\n+/);
        const title = opt.title ?? h1?.[1]?.trim() ?? basename(arg, '.md');
        if (h1 && !opt.title) md = md.slice(h1[0].length); // the H1 becomes the page title
        const { page, action } = await c.confluence.upsertPage({ spaceKey, title, markdown: md, parentId: opt.parent });
        out({ id: page.id, url: c.confluence.pageUrl(page), action }, () => `${title}: ${action} ${c.confluence.pageUrl(page)} (page ${page.id})`);
      } else throw new Error('page pull|push');
      break;
    }

    case 'hooks': {
      const sub = positionals[0] ?? 'status';
      if (sub === 'install') {
        // Prefer the stable user install (~/.sdlc/bin) over this copy: a plugin's own path changes on update.
        const stable = join(homedir(), '.sdlc', 'bin', 'sdlc-atl.mjs');
        const r = installHook(root, existsSync(stable) ? selfCommand(stable) : selfCommand());
        console.log(`post-commit hook ${r.action}: ${r.path}\n  commits touching planning artifacts now run \`sync\` in the background (log: .sdlc/sync.log)`);
      } else if (sub === 'uninstall') console.log(uninstallHook(root) ? 'post-commit hook removed' : 'no sdlc-atl hook installed');
      else console.log(hookInstalled(root) ? 'post-commit hook installed' : 'no sdlc-atl hook (run: sdlc-atl hooks install)');
      break;
    }

    case 'init': {
      const file = join(root, '.sdlc', 'config.json');
      const merged = {
        ...cfg,
        ...(opt.engine ? { engine: opt.engine } : {}),
        ...(opt.epic ? { epic: opt.epic.toUpperCase() } : {}),
        ...(opt.prd ? { prdPageId: opt.prd } : {}),
        ...(opt.space ? { confluence: { ...cfg.confluence, space: opt.space } } : {}),
      };
      if (merged.engine) resolveEngine(root, merged.engine); // validate the name
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
      console.log(`${file}:\n${JSON.stringify(merged, null, 2)}`);
      // One rules file for every agent: AGENTS.md, imported by CLAUDE.md.
      for (const r of ensureRulesFiles(root)) console.log(`${r.file}: ${r.action}${r.note ? ` (${r.note})` : ''}`);
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
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
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
