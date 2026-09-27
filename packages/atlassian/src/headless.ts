/**
 * Headless "work this ticket" for Data Center (D-6, W-1..W-3): what a CI job does for a labelled story.
 *
 *   claim (assign to the bot, In Progress, `ai-ready` -> `ai-running`, comment with the build link)
 *   -> branch `feature/KEY-slug` -> import the brief -> run the AI agent headless (Copilot CLI, Claude Code or Codex)
 *   -> questions?  post them, label `ai-needs-info`, stop (a human reply makes it eligible again)
 *   -> gate: commits + a passing execution report -> push, draft PR, review, verification page, review status
 *   -> otherwise comment why, label `ai-failed`.
 *
 * Never merges, never pushes the base branch, never moves the story to Done: people review the draft PR.
 * Not in the reference (it stops at a local PR); Atlassian's equivalent (Rovo Dev) is Cloud-only.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfluenceClient } from './confluence.ts';
import { slugify } from './engines/piv.ts';
import type { SdlcConfig } from './engines/index.ts';
import { defaultBase, git } from './git.ts';
import type { GitHost } from './hosts/types.ts';
import { JiraClient, type JiraIssue } from './jira.ts';
import { openPr, publishReview } from './pr.ts';
import type { StateFile } from './state.ts';
import { syncProgress } from './sync.ts';
import { acceptanceCriteria, importTicket } from './tickets.ts';
import type { Engine } from './work.ts';

export const LABELS = { ready: 'ai-ready', running: 'ai-running', needsInfo: 'ai-needs-info', failed: 'ai-failed', done: 'ai-done', skipped: 'ai-skipped' } as const;
const OURS: string[] = Object.values(LABELS);

export type AgentName = 'copilot' | 'claude' | 'codex';

/** `.sdlc/config.json` "work". */
export type WorkConfig = {
  enabled?: boolean;
  agent?: AgentName;
  /** Custom agent command; `{prompt}` is replaced by the prompt, `{promptFile}` by a file holding it. */
  agentCommand?: string[];
  /** Poll query; default: this repo's projects, label ai-ready (or ai-needs-info with a reply), not Done. */
  jql?: string;
  issueTypes?: string[];
  maxPoints?: number;
  components?: string[];
  timeoutMinutes?: number;
  /** Stories worked per poll (one at a time). */
  maxPerRun?: number;
  /** How long a claim settles before it is re-read (two runners racing for one story: the last write wins). */
  claimSettleSeconds?: number;
  /** Ask for acceptance criteria before any agent run when the story has none (default true). */
  requireAcceptanceCriteria?: boolean;
};

/** busy: another runner holds the story (it is left alone). */
export type WorkOutcome = 'pr' | 'needs-info' | 'failed' | 'skipped' | 'disabled' | 'busy';

/** Issue property holding the current run's claim: invisible in the UI, same API on Data Center and Cloud. */
export const CLAIM_PROPERTY = 'sdlc.work.claim';
export type Claim = { id: string; at: string; build?: string };

/** A claim older than the run's time limit plus a margin belongs to a runner that died; it may be taken over. */
export function claimIsStale(claim: Claim | undefined, cfg: WorkConfig = {}, now = Date.now()): boolean {
  if (!claim?.at) return true;
  return now - Date.parse(claim.at) > ((cfg.timeoutMinutes ?? 45) + 15) * 60_000;
}

/**
 * Claim a story for this run. Jira has no compare-and-set, so: re-read fresh state (never trust poll results, which
 * may be minutes old), write our claim, wait, read it back. Racing runners overwrite each other and only the last
 * write survives, so exactly one sees its own id; the others back off.
 */
export async function claimStory(jira: JiraClient, key: string, cfg: WorkConfig, build?: string): Promise<{ ok: true; claim: Claim } | { ok: false; reason: string }> {
  const fresh = await jira.getIssue(key, 'labels,status');
  if (!fresh) return { ok: false, reason: 'issue not found' };
  const held = await jira.getIssueProperty<Claim>(key, CLAIM_PROPERTY);
  if (held && !claimIsStale(held, cfg)) return { ok: false, reason: `another run holds it since ${held.at}${held.build ? ` (${held.build})` : ''}` };
  if (!held && ((fresh.fields.labels ?? []) as string[]).includes(LABELS.running)) return { ok: false, reason: `labelled ${LABELS.running} by a run without a claim; remove the label to retry` };
  const claim: Claim = { id: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, at: new Date().toISOString(), ...(build ? { build } : {}) };
  await jira.setIssueProperty(key, CLAIM_PROPERTY, claim);
  await new Promise((r) => setTimeout(r, (cfg.claimSettleSeconds ?? 5) * 1000));
  const now = await jira.getIssueProperty<Claim>(key, CLAIM_PROPERTY);
  if (now?.id !== claim.id) return { ok: false, reason: `another run claimed it at the same time${now?.build ? ` (${now.build})` : ''}` };
  return { ok: true, claim };
}
export type WorkResult = { key: string; outcome: WorkOutcome; reason?: string; prUrl?: string; branch?: string };

export type AgentRun = { code: number | null; output: string; timedOut: boolean };
/** piv runs plan, execute, report as separate calls; gsd runs one call. */
export type WorkPhase = 'plan' | 'execute' | 'report' | 'single';
export type AgentRunner = (opts: { root: string; prompt: string; promptFile: string; phase: WorkPhase; timeoutMs: number; log: string }) => Promise<AgentRun>;

/** Where the piv engine expects this ticket's plan and execution report (see engines/piv.ts nextSteps). */
export function pivPaths(key: string, summary: string) {
  const slug = `${key.toLowerCase()}-${slugify(summary) || 'work'}`;
  return { plan: `.claude/plans/${slug}.md`, report: `.claude/execution-reports/${slug}.md` };
}

/** One narrow instruction per piv phase; the runner checks the result before the next. */
export function phasePrompt(phase: 'plan' | 'execute' | 'report', key: string, p: { plan: string; report: string }): string {
  const head = `Jira story ${key}, unattended in CI: nobody is watching, never wait for input.`;
  if (phase === 'plan')
    return [
      `${head} Step 1 of 3: triage and plan. Write no code.`,
      `1. Read .sdlc/tickets/${key}.md: description, acceptance criteria and the conversation so far (answers to earlier questions are there).`,
      `2. If it is too unclear to implement safely (missing or contradictory acceptance criteria, unknown external details), or bigger than one ticket: write numbered, specific questions (each with the assumption you would otherwise make) to .sdlc/work/${key}-questions.md and stop.`,
      `3. Otherwise use the sdlc-prime and sdlc-plan skills (/sdlc:prime, /sdlc:plan in Claude Code) to write the implementation plan to ${p.plan}, with a "Ticket: ${key}" line under the title. Change no other file.`,
    ].join('\n');
  if (phase === 'execute')
    return [
      `${head} Step 2 of 3: implement.`,
      `Implement the plan in ${p.plan} with the sdlc-execute skill: follow its steps and run each step's check.`,
      `Commit the changes with the sdlc-commit skill (Jira key in the message). Do not push, and do not write the execution report yet.`,
    ].join('\n');
  return [
    `${head} Step 3 of 3: validate and report.`,
    `Run the sdlc-validate skill (the repo's full quality gate), then write the execution report to ${p.report} with the sdlc-report skill: a "Ticket: ${key}" line and a "Validation Results" list with ✓ or ✗ only for checks you actually ran.`,
    `Commit the report with the sdlc-commit skill. Do not push.`,
  ].join('\n');
}

export type WorkDeps = {
  jira: JiraClient;
  confluence?: ConfluenceClient;
  host: GitHost;
  engine: Engine;
  state: StateFile;
  root: string;
  config: SdlcConfig & { work?: WorkConfig };
  /** Defaults to spawning the configured agent CLI. */
  runAgent?: AgentRunner;
  /** Link to the CI build, shown in Jira comments (Jenkins sets BUILD_URL). */
  buildUrl?: string;
  log?: (line: string) => void;
};

export function workDisabled(cfg: WorkConfig | undefined, env = process.env): string | undefined {
  if (/^(off|0|false|no)$/i.test(env.SDLC_WORK ?? '')) return 'SDLC_WORK=off';
  if (cfg?.enabled === false) return '.sdlc/config.json work.enabled is false';
  return undefined;
}

/** Why a story may not be worked unattended (empty = eligible). */
export function ineligibility(issue: JiraIssue, cfg: WorkConfig = {}, points?: number): string[] {
  const f = issue.fields;
  const out: string[] = [];
  const types = cfg.issueTypes ?? ['Story', 'Task', 'Bug'];
  if (f.issuetype && !types.some((t) => t.toLowerCase() === f.issuetype!.name.toLowerCase())) out.push(`type ${f.issuetype.name} is not one of ${types.join(', ')}`);
  if (f.status?.statusCategory?.key === 'done') out.push(`already ${f.status.name}`);
  if (cfg.maxPoints !== undefined && points !== undefined && points > cfg.maxPoints) out.push(`${points} story points is more than ${cfg.maxPoints}`);
  if (cfg.components?.length) {
    const have = ((f.components ?? []) as { name: string }[]).map((c) => c.name.toLowerCase());
    if (!cfg.components.some((c) => have.includes(c.toLowerCase()))) out.push(`no component from ${cfg.components.join(', ')}`);
  }
  return out;
}

/** The instruction handed to the agent. Short on purpose (Windows command lines are limited); the brief has the rest. */
export function workPrompt(key: string, engine: Pick<Engine, 'name'> = { name: 'piv' }, summary = ''): string {
  // Headless agents shortcut straight to code (seen with Copilot CLI): name the skills and the exact evidence the
  // runner checks, and say that work without it is rejected.
  const slug = `${key.toLowerCase()}-${slugify(summary) || '<slug>'}`;
  const loop =
    engine.name === 'gsd'
      ? `run it as a GSD quick task whose description starts with "${key}:" (/gsd-quick --validate), pointing the planner at the brief; its verification must pass.`
      : `invoke the skills in order: sdlc-prime ${key}, sdlc-plan ${key}, sdlc-execute, sdlc-validate, sdlc-report (/sdlc:<name> in Claude Code). Required files, committed with the code: the plan .claude/plans/${slug}.md (with a "Ticket: ${key}" line) and the execution report .claude/execution-reports/${slug}.md (with "Ticket: ${key}" and the ✓/✗ "Validation Results" of checks you actually ran).`;
  return [
    `Work Jira story ${key} unattended in CI. Nobody is watching: never wait for input.`,
    `1. Read .sdlc/tickets/${key}.md: description, acceptance criteria and the conversation so far (answers to earlier questions are there).`,
    `2. If it is too unclear to implement safely (missing or contradictory acceptance criteria, unknown external details), or bigger than one ticket, write no code: write numbered, specific questions (each with the assumption you would otherwise make) to .sdlc/work/${key}-questions.md and stop.`,
    `3. Otherwise, as a hands-off run (no stopping for plan approval), ${loop}`,
    `4. The runner rejects work without that evidence, even if the code is right: do not skip planning or the report, however small the change.`,
    `5. Commit everything with the sdlc-commit skill (Jira key in the message). Do not push, open a PR or change Jira: the runner does that.`,
    `6. End with a two-line summary.`,
  ].join('\n');
}

/** Command line for an agent CLI (headless, full tool access inside the CI workspace, no pushing). */
export function agentCommand(cfg: WorkConfig, prompt: string, promptFile: string, phase: WorkPhase = 'single'): string[] {
  if (cfg.agentCommand?.length) return cfg.agentCommand.map((a) => a.replace('{prompt}', prompt).replace('{promptFile}', promptFile).replace('{phase}', phase));
  switch (cfg.agent ?? 'copilot') {
    case 'copilot':
      return ['copilot', '-p', prompt, '--allow-all-tools', '--no-ask-user', '--deny-tool', 'shell(git push)'];
    case 'claude':
      return ['claude', '-p', prompt, '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Skill', '--disallowedTools', 'Bash(git push:*)'];
    case 'codex':
      return ['codex', 'exec', '--full-auto', prompt];
  }
}

const winArg = (a: string) => (a !== '' && !/[\s"&|<>^()%!]/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`);

/** Spawn the agent CLI with a time limit; output goes to the log file and is returned. */
export function spawnAgent(cfg: WorkConfig): AgentRunner {
  return ({ root, prompt, promptFile, phase, timeoutMs, log }) =>
    new Promise((resolve) => {
      const [cmd, ...args] = agentCommand(cfg, prompt, promptFile, phase);
      const env = { ...process.env, SDLC_WORK_PHASE: phase };
      const win = process.platform === 'win32';
      // npm shims (copilot.cmd, codex.cmd) need a shell on Windows.
      const child = win
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cmd!, ...args].map(winArg).join(' ')}"`], { cwd: root, env, windowsVerbatimArguments: true, windowsHide: true })
        : spawn(cmd!, args, { cwd: root, env });
      let output = '';
      const onData = (d: Buffer) => {
        output += d.toString();
        writeFileSync(`${log}.${phase}`, output); // live view while a phase runs
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output, timedOut });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ code: -1, output: `${output}\n${e.message}`, timedOut });
      });
    });
}

async function storyPoints(jira: JiraClient, issue: JiraIssue): Promise<number | undefined> {
  for (const name of ['Story Points', 'Story point estimate']) {
    try {
      const id = await jira.fieldId(name);
      const v = issue.fields[id];
      if (typeof v === 'number') return v;
    } catch {
      /* field not on this instance */
    }
  }
  return undefined;
}

const tail = (s: string, n = 12) => s.trim().split('\n').slice(-n).join('\n');

/** Work one story end to end. */
export async function workTicket(key: string, deps: WorkDeps, opts: { force?: boolean } = {}): Promise<WorkResult> {
  const { jira, root, config } = deps;
  const cfg = config.work ?? {};
  const log = deps.log ?? (() => {});
  const build = deps.buildUrl ? ` ([build](${deps.buildUrl}))` : '';
  const off = workDisabled(cfg);
  if (off) return { key, outcome: 'disabled', reason: off };

  const issue = await jira.getIssue(key, '*navigable,comment');
  if (!issue) throw new Error(`Issue ${key} not found`);

  // Claim first: two jobs whose queries overlap must never both work (or both comment on) the same story.
  const claimed = await claimStory(jira, key, cfg, deps.buildUrl);
  if (!claimed.ok) {
    log(`${key}: busy, ${claimed.reason}`);
    return { key, outcome: 'busy', reason: claimed.reason };
  }
  const release = async () => {
    const current = await jira.getIssueProperty<Claim>(key, CLAIM_PROPERTY).catch(() => undefined);
    if (current?.id === claimed.claim.id) await jira.deleteIssueProperty(key, CLAIM_PROPERTY).catch(() => undefined);
  };
  try {
    return await workClaimed(key, issue, deps, opts);
  } finally {
    await release();
  }
}

async function workClaimed(key: string, issue: JiraIssue, deps: WorkDeps, opts: { force?: boolean }): Promise<WorkResult> {
  const { jira, root, config } = deps;
  const cfg = config.work ?? {};
  const log = deps.log ?? (() => {});
  const build = deps.buildUrl ? ` ([build](${deps.buildUrl}))` : '';
  if (!opts.force) {
    const why = ineligibility(issue, cfg, cfg.maxPoints !== undefined ? await storyPoints(jira, issue) : undefined);
    if (why.length) {
      await jira.addComment(key, `🤖 Not picked up for an unattended AI run: ${why.join('; ')}. Remove the \`${LABELS.ready}\` label or change the story and add it again.`);
      await jira.editLabels(key, [LABELS.skipped], [LABELS.ready]);
      return { key, outcome: 'skipped', reason: why.join('; ') };
    }
  }

  // Claim.
  const me = await jira.myself();
  await jira.editLabels(key, [LABELS.running], [LABELS.ready, LABELS.needsInfo, LABELS.failed, LABELS.skipped]);
  await jira.assign(key, me).catch(() => log('could not assign (permission?); continuing'));
  await jira.moveTo(key, config.jira?.transitions?.executing ?? 'In Progress', { category: 'indeterminate' }).catch(() => undefined);
  await jira.addComment(key, `🤖 Started an unattended AI run${build}. I'll open a draft pull request, or ask here if something is unclear.`);

  const branchName = `feature/${key}-${slugify(String(issue.fields.summary ?? ''), 32)}`;
  const fail = async (reason: string): Promise<WorkResult> => {
    await jira.addComment(key, `🤖 The AI run stopped: ${reason}${build}`).catch(() => undefined);
    await jira.editLabels(key, [LABELS.failed], [LABELS.running]).catch(() => undefined);
    return { key, outcome: 'failed', reason, branch: branchName };
  };

  try {
    // Branch (reuse the story's branch after a clarification round).
    // Our own state and logs live in .sdlc/; anything else uncommitted would be carried into the story's branch.
    const dirty = git(root, 'status', '--porcelain').split('\n').filter((l) => l.trim() && !/(^|\s)"?\.sdlc\//.test(l.trim()));
    if (dirty.length) return await fail(`the workspace has uncommitted changes (${dirty.length} file(s)); run this in a clean CI clone`);
    const base = defaultBase(root, config.git?.base);
    git(root, 'fetch', '--quiet', 'origin');
    const remoteBranch = git(root, 'ls-remote', '--heads', 'origin', branchName).trim();
    git(root, 'checkout', '--quiet', '--force', '-B', branchName, remoteBranch ? `origin/${branchName}` : `origin/${base}`);
    const startSha = git(root, 'rev-parse', 'HEAD').trim();

    await importTicket({ jira, root, key, engine: deps.engine, state: deps.state });

    // No acceptance criteria and nobody has answered yet: ask, deterministically, before spending an agent run.
    // (Left to the agent, whether a vague story gets questions depends on the model's judgement that day.)
    if (cfg.requireAcceptanceCriteria !== false && !acceptanceCriteria(JiraClient.descriptionMarkdown(issue)).length) {
      const me = await jira.myself();
      const comments = ((issue.fields.comment?.comments ?? []) as { author: { name?: string; accountId?: string }; body: string }[]);
      // Proceed only on answers to our question; an unrelated comment is not acceptance criteria.
      const isMe = (a: { name?: string; accountId?: string }) => (me.accountId && a.accountId === me.accountId) || (!!me.name && a.name === me.name);
      const asked = comments.some((c) => isMe(c.author) && c.body.includes('need a few answers'));
      if (!asked || !answered(comments, me)) {
        const reporter = issue.fields.reporter?.displayName ?? issue.fields.reporter?.name;
        await jira.addComment(
          key,
          `🤖 Before I build this I need a few answers${reporter ? ` (${reporter})` : ''}. Reply here; the next run picks the story up again.

` +
            'This story has no acceptance criteria. Please add them to the description (a list under an "Acceptance criteria" heading) or reply with them: what should be true when it is done, and how would you check it?',
        );
        await jira.editLabels(key, [LABELS.needsInfo], [LABELS.running]);
        return { key, outcome: 'needs-info', reason: 'no acceptance criteria', branch: branchName };
      }
    }

    const workDir = join(root, '.sdlc', 'work');
    mkdirSync(workDir, { recursive: true });
    const questions = join(workDir, `${key}-questions.md`);
    rmSync(questions, { force: true });
    const summary = String(issue.fields.summary ?? '');
    const runner = deps.runAgent ?? spawnAgent(cfg);
    const deadline = Date.now() + (cfg.timeoutMinutes ?? 45) * 60_000;
    const logFile = join(workDir, `${key}.log`);
    let output = '';
    const agent = async (phase: WorkPhase, prompt: string) => {
      const promptFile = join(workDir, `${key}-${phase}-prompt.md`);
      writeFileSync(promptFile, prompt);
      log(`${key} ${phase}: running ${cfg.agentCommand ? 'custom agent' : (cfg.agent ?? 'copilot')} (${branchName})`);
      const run = await runner({ root, prompt, promptFile, phase, timeoutMs: Math.max(60_000, deadline - Date.now()), log: logFile });
      output += `\n===== ${phase} =====\n${run.output}`;
      writeFileSync(logFile, output);
      return run;
    };
    const outOfTime = () => fail(`the agent ran out of time (${cfg.timeoutMinutes ?? 45} min). Last output:\n\n\`\`\`\n${tail(output)}\n\`\`\``);
    const askedQuestions = async (): Promise<WorkResult | undefined> => {
      if (!existsSync(questions) || !readFileSync(questions, 'utf8').trim()) return undefined;
      const reporter = issue.fields.reporter?.displayName ?? issue.fields.reporter?.name;
      await jira.addComment(key, `🤖 Before I build this I need a few answers${reporter ? ` (${reporter})` : ''}. Reply here; the next run picks the story up again.\n\n${readFileSync(questions, 'utf8').trim()}`);
      await jira.editLabels(key, [LABELS.needsInfo], [LABELS.running]);
      return { key, outcome: 'needs-info', branch: branchName };
    };
    const commitIfChanged = (paths: string[], message: string) => {
      const existing = paths.filter((p) => existsSync(join(root, p)));
      if (!existing.length) return;
      git(root, 'add', '--', ...existing);
      if (git(root, 'diff', '--cached', '--name-only').trim()) git(root, 'commit', '--quiet', '-m', message);
    };

    if (deps.engine.name === 'gsd') {
      // GSD's quick task plans, executes and verifies on its own: one call.
      const run = await agent('single', workPrompt(key, deps.engine, summary));
      const asked = await askedQuestions();
      if (asked) return asked;
      if (run.timedOut) return await outOfTime();
    } else {
      // piv: the runner drives the loop in three narrow calls and checks the evidence after each. One "do the whole
      // process" prompt is not enough: headless agents skip straight to code on small tickets.
      const p = pivPaths(key, summary);
      const plan = await agent('plan', phasePrompt('plan', key, p));
      const asked = await askedQuestions();
      if (asked) return asked;
      if (plan.timedOut) return await outOfTime();
      if (!existsSync(join(root, p.plan))) return await fail(`no plan was written to \`${p.plan}\` (exit ${plan.code}). Last output:\n\n\`\`\`\n${tail(plan.output)}\n\`\`\``);
      commitIfChanged([p.plan], `docs(${key}): implementation plan`);
      await jira.addComment(key, `🤖 Plan written (\`${p.plan}\`); implementing it now.`).catch(() => undefined);

      const beforeCode = git(root, 'rev-parse', 'HEAD').trim();
      const exec = await agent('execute', phasePrompt('execute', key, p));
      if (exec.timedOut) return await outOfTime();
      if (!Number(git(root, 'rev-list', '--count', `${beforeCode}..HEAD`).trim())) {
        return await fail(`the agent made no commits implementing the plan (exit ${exec.code}). Last output:\n\n\`\`\`\n${tail(exec.output)}\n\`\`\``);
      }

      const report = await agent('report', phasePrompt('report', key, p));
      if (report.timedOut) return await outOfTime();
      commitIfChanged([p.report], `docs(${key}): execution report`);
    }
    const commits = Number(git(root, 'rev-list', '--count', `${startSha}..HEAD`).trim());
    if (!commits) return await fail(`the agent made no commits. Last output:\n\n\`\`\`\n${tail(output)}\n\`\`\``);

    // Gate: the engine's verdict for this key must be a pass.
    const progress = await deps.engine.ticketProgress(root, key);
    const v = progress.verification;
    if (progress.status !== 'complete' || v?.status !== 'passed') {
      git(root, 'push', '--quiet', '-u', 'origin', branchName);
      return await fail(`validation did not pass (${v ? `${v.status}${v.score ? `, ${v.score}` : ''}` : 'no execution report'}). The work so far is on branch \`${branchName}\`.`);
    }

    // Ship for review.
    git(root, 'push', '--quiet', '-u', 'origin', branchName);
    const pr = await openPr({ root, host: deps.host, jira, confluence: deps.confluence, state: deps.state, base, key, draft: true, projects: config.jira?.projects });
    const reviewFile = join(root, '.sdlc', 'reviews', `${branchName.replace(/\//g, '-')}.md`);
    if (existsSync(reviewFile)) await publishReview({ root, host: deps.host, jira, file: reviewFile, base, projects: config.jira?.projects }).catch((e) => log(`review not published: ${(e as Error).message}`));
    const sync = await syncProgress({
      jira, confluence: deps.confluence, state: deps.state, root, engineFor: () => deps.engine, only: [key],
      transitions: config.jira?.transitions, hold: config.jira?.hold, confluenceSpace: config.confluence?.space,
      doneWhen: 'merged', prState: async () => 'open', // verified, but not Done until the PR is merged
    }).catch(() => undefined);
    await jira.moveTo(key, config.jira?.transitions?.review ?? 'In Review').catch(() => undefined);
    const report = sync?.tickets.find((t) => t.key === key)?.report?.url;
    await jira.editLabels(key, [LABELS.done], [LABELS.running]);
    await jira.addComment(
      key,
      [
        `🤖 Ready for review: [draft pull request](${pr.pr?.url})${build}.`,
        `Validation: **${v.status}**${v.score ? ` (${v.score})` : ''}${report ? ` · [verification report](${report})` : ''}. ${commits} commit(s) on \`${branchName}\`.`,
        'Nothing is merged: review the PR, then mark it ready.',
      ].join('\n\n'),
    );
    return { key, outcome: 'pr', prUrl: pr.pr?.url, branch: branchName };
  } catch (e) {
    return await fail((e as Error).message.slice(0, 500));
  }
}

/**
 * Default poll query: this repo's projects; ready or waiting-for-info stories that aren't running, plus running ones
 * untouched for longer than a run may take (a dead runner; the claim check decides). Not Done.
 */
export function defaultJql(config: SdlcConfig & { work?: WorkConfig }): string {
  const projects = config.jira?.projects?.length ? `project in (${config.jira.projects.join(', ')}) AND ` : '';
  const staleMinutes = (config.work?.timeoutMinutes ?? 45) + 15;
  return `${projects}statusCategory != Done AND ((labels in (${LABELS.ready}, ${LABELS.needsInfo}) AND labels not in (${LABELS.running})) OR (labels = ${LABELS.running} AND updated <= "-${staleMinutes}m")) ORDER BY priority DESC, created ASC`;
}

/** A story waiting for answers is ready again once someone other than the bot commented after the bot's question. */
export function answered(comments: { author: { name?: string; accountId?: string }; body: string }[], me: { name?: string; accountId?: string }): boolean {
  const isMe = (a: { name?: string; accountId?: string }) => (me.accountId && a.accountId === me.accountId) || (!!me.name && a.name === me.name);
  const lastQuestion = comments.map((c, i) => (isMe(c.author) && c.body.includes('need a few answers') ? i : -1)).filter((i) => i >= 0).at(-1);
  if (lastQuestion === undefined) return true;
  return comments.slice(lastQuestion + 1).some((c) => !isMe(c.author));
}

/** Find eligible stories and work them one at a time. */
export async function pollAndWork(deps: WorkDeps): Promise<WorkResult[]> {
  const cfg = deps.config.work ?? {};
  const off = workDisabled(cfg);
  if (off) return [{ key: '-', outcome: 'disabled', reason: off }];
  const jql = cfg.jql ?? defaultJql(deps.config);
  const found = await deps.jira.search(jql, { fields: ['labels', 'summary'], limit: 20 });
  const me = await deps.jira.myself();
  const results: WorkResult[] = [];
  for (const issue of found) {
    if (results.filter((r) => r.outcome !== 'busy').length >= (cfg.maxPerRun ?? 1)) break; // busy ones don't count
    const labels = (issue.fields.labels ?? []) as string[];
    if (labels.includes(LABELS.needsInfo) && !labels.includes(LABELS.ready) && !answered(await deps.jira.comments(issue.key), me)) continue;
    // Each run needs a clean workspace on the base branch; a previous story's branch is left behind in CI.
    results.push(await workTicket(issue.key, deps));
  }
  return results;
}

export const isOurLabel = (l: string) => OURS.includes(l);

/**
 * Keep polling without a CI server: a terminal, a Windows scheduled task, a service. `makeDeps` is called every round,
 * so config changes and the kill switch apply without a restart. Stops when `signal` aborts (after the current story).
 */
export async function watchAndWork(
  makeDeps: () => WorkDeps,
  everyMinutes: number,
  opts: { signal?: AbortSignal; onResults?: (r: WorkResult[]) => void; onError?: (e: Error) => void; maxRounds?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<number> {
  const sleep =
    opts.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
      }));
  let rounds = 0;
  while (!opts.signal?.aborted) {
    rounds++;
    try {
      const results = await pollAndWork(makeDeps()); // not inside `onResults?.(...)`: that would skip the poll
      opts.onResults?.(results);
    } catch (e) {
      opts.onError?.(e as Error); // e.g. Jira unreachable for a moment: try again next round
    }
    if (opts.maxRounds !== undefined && rounds >= opts.maxRounds) break;
    if (!opts.signal?.aborted) await sleep(everyMinutes * 60_000, opts.signal);
  }
  return rounds;
}
