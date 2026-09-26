// Getting-started wizard: `node setup.mjs` from a clone of sdlc-work. Sets up this machine for the AI tools the
// developer uses (GitHub Copilot CLI / VS Code, Codex, Claude Code): prerequisites, the sdlc-atl CLI, skills, the
// Jira/Confluence MCP server per tool, and live-tested credentials in ~/.sdlc/atlassian.env. Safe to re-run.
// Plain JavaScript on purpose: it must start on an old Node to tell you to install a new one.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  AGENTS, MCP_NAME, MIN_NODE, PREREQS, isCloud, mask, mergeEnv, networkReason, nodeMajor, normaliseUrl, parseEnv, portSkill, portText, probe, tokenHelp,
} from './lib.mjs';

const MCP_ATLASSIAN_VERSION = '0.23.1'; // keep in step with scripts/mcp-atlassian.mjs
const repo = fileURLToPath(new URL('../..', import.meta.url));
const plugin = join(repo, 'plugins', 'sdlc');
const home = homedir();
const win = platform() === 'win32';
const envFile = join(home, '.sdlc', 'atlassian.env');

const USAGE = `sdlc-work setup: get this machine ready for the sdlc skills.

  node setup.mjs                 interactive setup (safe to re-run)
  node setup.mjs --check         report what is set up and working; change nothing
  node setup.mjs --uninstall     remove the CLI, skills and MCP registrations (keeps ~/.sdlc/atlassian.env)

Options:
  --agents copilot,vscode,codex,claude   which AI tools to set up (default: ask; detected ones preselected)
  -y, --yes                      accept the defaults without asking (installs missing prerequisites)
  --skip-prereqs                 don't check or install prerequisites
  --skip-credentials             don't ask for Jira/Confluence/Bitbucket tokens
  --no-path                      don't add the CLI to your PATH
  --bin-dir DIR                  where the CLI goes (default ~/.sdlc/bin)
  --skill-dirs DIR[,DIR]         where skills go (default ~/.agents/skills: Copilot CLI, VS Code and Codex read it)`;

const { values: opt } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    uninstall: { type: 'boolean', default: false },
    yes: { type: 'boolean', short: 'y', default: false },
    agents: { type: 'string' },
    'skip-prereqs': { type: 'boolean', default: false },
    'skip-credentials': { type: 'boolean', default: false },
    'no-path': { type: 'boolean', default: false },
    'bin-dir': { type: 'string' },
    'skill-dirs': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});
if (opt.help) {
  console.log(USAGE);
  process.exit(0);
}

const binDir = opt['bin-dir'] ?? join(home, '.sdlc', 'bin');
const skillDirs = (opt['skill-dirs'] ?? join(home, '.agents', 'skills')).split(',').map((s) => s.trim().replace(/^~(?=$|[\\/])/, home)).filter(Boolean);
// SDLC_SETUP_INTERACTIVE=1 forces prompts with piped stdin (tests).
const interactive = (process.stdin.isTTY || process.env.SDLC_SETUP_INTERACTIVE === '1') && !opt.yes;

// ---- output ---------------------------------------------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`  ${c(32, '✓')} ${s}`);
const warn = (s) => console.log(`  ${c(33, '!')} ${s}`);
const bad = (s) => console.log(`  ${c(31, '✗')} ${s}`);
const info = (s) => console.log(`    ${c(2, s)}`);
const step = (n, s) => console.log(`\n${c(1, n === '' ? s : `${n}. ${s}`)}`);
const summary = [];
const record = (status, what, note = '') => summary.push({ status, what, note });

// ---- prompts --------------------------------------------------------------------------------------------------

// One readline interface for the whole run (several would each buffer stdin and lose piped answers).
// Lines are queued: piped input arrives all at once, before the questions are asked.
let rl;
let muted = false;
let closed = false;
const lines = [];
const waiting = [];
function prompt(text) {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => {
      if (!muted && write) write(s);
    };
    rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
    rl.on('close', () => {
      closed = true;
      while (waiting.length) waiting.shift()(''); // end of input: take the defaults
    });
  }
  process.stdout.write(text);
  if (lines.length) return Promise.resolve(lines.shift());
  if (closed) return Promise.resolve('');
  return new Promise((res) => waiting.push(res));
}

function ask(question, def = '') {
  if (!interactive) return Promise.resolve(def);
  return prompt(`  ${question}${def ? c(2, ` [${def}]`) : ''} `).then((a) => a.trim() || def);
}

async function confirm(question, def = true) {
  if (!interactive) return def;
  const a = (await ask(`${question} ${def ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
  return a ? a.startsWith('y') : def;
}

/** Hidden input for tokens (nothing echoed). */
async function askSecret(question) {
  if (!interactive) return '';
  const p = prompt(`  ${question} `);
  muted = true; // the question is already written; hide the typed characters
  const a = await p;
  muted = false;
  process.stdout.write('\n');
  return a.trim();
}

// ---- processes ------------------------------------------------------------------------------------------------

/** Quote for cmd.exe + CommandLineToArgvW (npm shims like copilot.cmd need a shell on Windows). */
function winArg(a) {
  if (a !== '' && !/[\s"&|<>^()%!]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function run(cmd, args = [], { inherit = false, timeout = 120_000, env } = {}) {
  const o = { encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], timeout, env: env ?? process.env, windowsHide: true };
  const r = win
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cmd, ...args].map(winArg).join(' ')}"`], { ...o, windowsVerbatimArguments: true })
    : spawnSync(cmd, args, o);
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const has = (cmd, ...args) => run(cmd, args.length ? args : ['--version'], { timeout: 30_000 }).ok;

/** Make a freshly installed tool visible to this process (installers only update PATH for new terminals). */
function refreshPath() {
  const extra = win
    ? [join(home, '.local', 'bin'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI')]
    : [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  if (win) {
    const r = run('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"]);
    if (r.ok) extra.push(...r.out.split(';'));
  }
  const parts = new Set((process.env.PATH ?? '').split(delimiter));
  for (const p of extra) if (p && !parts.has(p)) process.env.PATH = `${process.env.PATH}${delimiter}${p}`;
}

// ---- 1. prerequisites -----------------------------------------------------------------------------------------

async function prerequisites() {
  step(1, 'Prerequisites');
  for (const p of PREREQS) {
    const present = p.id === 'node' ? nodeMajor() >= MIN_NODE : has(...p.check);
    if (present) {
      ok(`${p.name}${p.id === 'node' ? ` (${process.versions.node})` : ''}`);
      record('ok', p.name);
      continue;
    }
    const missing = p.id === 'node' ? `${p.name}: this is Node ${process.versions.node}` : `${p.name}: not found`;
    (p.required ? bad : warn)(`${missing}; needed for ${p.for}`);
    const cmd = p.install[platform()];
    if (opt.check || !cmd) {
      info(cmd ? `install: ${cmd}` : `install: ${p.manual}`);
      record(p.required ? 'fail' : 'warn', p.name, cmd ?? p.manual);
      continue;
    }
    if (!(await confirm(`Install ${p.name} now (${cmd.split(' ').slice(0, 2).join(' ')})?`, p.required))) {
      info(`later: ${cmd}`);
      record(p.required ? 'fail' : 'skip', p.name, cmd);
      continue;
    }
    const r = run(cmd.split(' ')[0], cmd.split(' ').slice(1), { inherit: true, timeout: 900_000 });
    refreshPath();
    const now = p.id === 'node' ? false : has(...p.check);
    if (p.id === 'node' && r.ok) {
      warn('Node installed: open a new terminal and run node setup.mjs again (this one still runs the old Node).');
      record('warn', p.name, 're-run setup in a new terminal');
      return false;
    }
    if (now) {
      ok(`${p.name} installed`);
      record('ok', p.name, 'installed');
    } else {
      bad(`${p.name} did not install${r.ok ? ' (or is not on PATH yet: open a new terminal)' : ''}. Manual: ${p.manual}`);
      record(p.required ? 'fail' : 'warn', p.name, `manual: ${p.manual}`);
    }
  }
  return nodeMajor() >= MIN_NODE;
}

// ---- 2. which AI tools ----------------------------------------------------------------------------------------

async function chooseAgents() {
  step(2, 'Your AI coding tools');
  const detected = AGENTS.map((a) => ({ ...a, found: has(...a.detect) }));
  detected.forEach((a, i) => console.log(`  ${i + 1}) ${a.name}${a.found ? c(32, '  (installed)') : c(2, '  (not found)')}`));
  let ids;
  if (opt.agents !== undefined) ids = opt.agents.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); // "" = none
  else {
    const def = detected.map((a, i) => (a.found ? i + 1 : 0)).filter(Boolean).join(',');
    const a = await ask('Which do you use? Numbers, comma-separated:', def || '1');
    ids = a.split(/[\s,]+/).map((n) => detected[Number(n) - 1]?.id).filter(Boolean);
  }
  const chosen = detected.filter((a) => ids.includes(a.id));
  for (const a of chosen) if (!a.found) warn(`${a.name} is not installed; its MCP registration will be skipped (install it and re-run setup).`);
  return chosen;
}

// ---- 3. install -----------------------------------------------------------------------------------------------

function addToPath() {
  if (opt['no-path']) return;
  if (win) {
    const ps = `$d='${binDir.replace(/'/g, "''")}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains $d)) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User'); 'added' } else { 'present' }`;
    const r = run('powershell', ['-NoProfile', '-Command', ps]);
    if (r.out.includes('added')) info('added to your user PATH (new terminals pick it up)');
  } else {
    const line = `export PATH="${binDir}:$PATH" # sdlc-work`;
    for (const rc of ['.zshrc', '.bashrc', '.profile'].map((f) => join(home, f)).filter(existsSync)) {
      if (!readFileSync(rc, 'utf8').includes('# sdlc-work')) appendFileSync(rc, `\n${line}\n`);
    }
  }
  if (!(process.env.PATH ?? '').split(delimiter).includes(binDir)) process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;
}

function installCli() {
  mkdirSync(binDir, { recursive: true });
  for (const f of readdirSync(join(plugin, 'bin')).filter((f) => f.endsWith('.mjs'))) copyFileSync(join(plugin, 'bin', f), join(binDir, f));
  writeFileSync(join(binDir, 'sdlc-atl.cmd'), '@node "%~dp0sdlc-atl.mjs" %*\r\n');
  writeFileSync(join(binDir, 'sdlc-atl'), '#!/bin/sh\nexec node "$(dirname "$0")/sdlc-atl.mjs" "$@"\n');
  if (!win) chmodSync(join(binDir, 'sdlc-atl'), 0o755);
  addToPath();
  ok(`sdlc-atl CLI -> ${binDir}`);
  record('ok', 'sdlc-atl CLI', binDir);
}

const skillNames = () => readdirSync(join(plugin, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

/** Every file a skill ships (SKILL.md plus templates beside it), with SKILL.md ported for other agents. */
function skillFiles(n) {
  const src = join(plugin, 'skills', n);
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(src, rel), { withFileTypes: true })) {
      const r = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(r);
      else {
        const text = readFileSync(join(src, r), 'utf8');
        out.push({ rel: r, text: r === 'SKILL.md' ? portSkill(text, n) : r.endsWith('.md') ? portText(text) : text });
      }
    }
  };
  walk('');
  return out;
}

function installSkills() {
  for (const dir of skillDirs) {
    for (const n of skillNames()) {
      const target = join(dir, `sdlc-${n}`);
      rmSync(target, { recursive: true, force: true }); // drop files a skill no longer ships
      for (const f of skillFiles(n)) {
        mkdirSync(dirname(join(target, f.rel)), { recursive: true });
        writeFileSync(join(target, f.rel), f.text);
      }
    }
    ok(`${skillNames().length} skills -> ${dir} (as sdlc-<name>)`);
    record('ok', 'skills', dir);
  }
}

function skillsCurrent() {
  return skillDirs.every((dir) =>
    skillNames().every((n) => skillFiles(n).every((f) => existsSync(join(dir, `sdlc-${n}`, f.rel)) && readFileSync(join(dir, `sdlc-${n}`, f.rel), 'utf8') === f.text)),
  );
}

const mcpServer = () => join(binDir, 'mcp-atlassian.mjs');
const vscodeMcpFile = () =>
  win ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Code', 'User', 'mcp.json')
    : platform() === 'darwin' ? join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      : join(home, '.config', 'Code', 'User', 'mcp.json');

/** Per-tool: register the MCP server (or, for Claude Code, install the plugin, which brings its own). */
const REGISTER = {
  copilot: {
    add: () => (run('copilot', ['mcp', 'remove', MCP_NAME]), run('copilot', ['mcp', 'add', MCP_NAME, '--', 'node', mcpServer()])),
    present: () => run('copilot', ['mcp', 'get', MCP_NAME]).ok,
    remove: () => run('copilot', ['mcp', 'remove', MCP_NAME]),
  },
  codex: {
    add: () => (run('codex', ['mcp', 'remove', MCP_NAME]), run('codex', ['mcp', 'add', MCP_NAME, '--', 'node', mcpServer()])),
    present: () => run('codex', ['mcp', 'get', MCP_NAME]).ok,
    remove: () => run('codex', ['mcp', 'remove', MCP_NAME]),
  },
  vscode: {
    add: () => run('code', ['--add-mcp', JSON.stringify({ name: MCP_NAME, type: 'stdio', command: 'node', args: [mcpServer()] })]),
    present: () => existsSync(vscodeMcpFile()) && readFileSync(vscodeMcpFile(), 'utf8').includes(`"${MCP_NAME}"`),
    remove: () => ({ ok: false, out: `remove "${MCP_NAME}" from ${vscodeMcpFile()} (VS Code: "MCP: Open User Configuration")` }),
  },
  claude: {
    add: () => {
      const listed = run('claude', ['plugin', 'marketplace', 'list']).out.includes('sdlc-work');
      const m = listed ? run('claude', ['plugin', 'marketplace', 'update', 'sdlc-work']) : run('claude', ['plugin', 'marketplace', 'add', repo]);
      if (!m.ok) return m;
      // install is a no-op when already installed; update picks up a new version from the marketplace.
      const installed = run('claude', ['plugin', 'list']).out.includes('sdlc@sdlc-work');
      return installed ? run('claude', ['plugin', 'update', 'sdlc@sdlc-work']) : run('claude', ['plugin', 'install', 'sdlc@sdlc-work']);
    },
    present: () => run('claude', ['plugin', 'list']).out.includes('sdlc@sdlc-work'),
    remove: () => run('claude', ['plugin', 'uninstall', 'sdlc@sdlc-work']),
  },
};

function registerAgents(agents) {
  for (const a of agents) {
    if (!a.found) {
      record('skip', a.name, 'not installed');
      continue;
    }
    const r = REGISTER[a.id].add();
    const what = a.id === 'claude' ? 'plugin sdlc@sdlc-work (skills /sdlc:*, MCP included)' : `MCP server "${MCP_NAME}"`;
    if (r.ok || REGISTER[a.id].present()) {
      ok(`${a.name}: ${what}`);
      record('ok', a.name, what);
    } else {
      bad(`${a.name}: could not add the ${what}: ${r.out.split('\n').slice(-2).join(' ')}`);
      record('fail', a.name, r.out.split('\n').at(-1));
    }
  }
}

// ---- 4. credentials -------------------------------------------------------------------------------------------

async function check(product, baseUrl, env) {
  const cloud = isCloud(baseUrl);
  const email = env[`${product.toUpperCase()}_EMAIL`] || env.ATLASSIAN_EMAIL;
  const apiToken = env[`${product.toUpperCase()}_API_TOKEN`] || env.ATLASSIAN_API_TOKEN;
  const token = product === 'bitbucket' ? env.BITBUCKET_TOKEN : env[`${product.toUpperCase()}_PAT`];
  const authorization = cloud && email && apiToken ? `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}` : token ? `Bearer ${token}` : '';
  if (!authorization) return { ok: false, text: 'no token set' };
  const url = probe(product, baseUrl);
  try {
    const res = await fetch(url, { headers: { Authorization: authorization, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: true, text: body.displayName ?? body.name ?? body.username ?? 'token accepted' };
    }
    const hint = res.status === 401 ? 'token wrong or expired' : res.status === 403 ? 'forbidden: the account lacks access, or tokens are disabled here' : `HTTP ${res.status}`;
    return { ok: false, text: hint, status: res.status };
  } catch (e) {
    const why = networkReason(e);
    return { ok: false, text: why.text, kind: why.kind, url, authorization };
  }
}

/** Behind a TLS-inspecting proxy: does Node trust the OS certificate store (Node 22.15+/23.8+)? */
function worksWithSystemCa(url, authorization) {
  const script = "fetch(process.env.P_URL,{headers:{Authorization:process.env.P_AUTH}}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))";
  const r = spawnSync(process.execPath, ['--use-system-ca', '-e', script], { env: { ...process.env, P_URL: url, P_AUTH: authorization }, timeout: 30_000 });
  return r.status === 0;
}

function persistNodeOption(flag) {
  if (win) {
    run('powershell', ['-NoProfile', '-Command', `$v=[Environment]::GetEnvironmentVariable('NODE_OPTIONS','User'); if (-not ("$v" -like '*${flag}*')) { [Environment]::SetEnvironmentVariable('NODE_OPTIONS', ("$v ${flag}").Trim(), 'User') }`]);
  } else {
    for (const rc of ['.zshrc', '.bashrc', '.profile'].map((f) => join(home, f)).filter(existsSync)) {
      if (!readFileSync(rc, 'utf8').includes(flag)) appendFileSync(rc, `\nexport NODE_OPTIONS="$NODE_OPTIONS ${flag}" # sdlc-work\n`);
    }
  }
}

const PRODUCTS = [
  { id: 'jira', name: 'Jira', required: true },
  { id: 'confluence', name: 'Confluence', required: true },
  { id: 'bitbucket', name: 'Bitbucket Data Center', required: false },
];

async function credentials() {
  step(4, 'Jira, Confluence and Bitbucket');
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const env = parseEnv(text);
  const updates = {};
  const shadowed = Object.keys(env).filter((k) => process.env[k] && process.env[k] !== env[k]);
  if (shadowed.length) warn(`These are also set in your environment and win over the file: ${shadowed.join(', ')}`);

  for (const p of PRODUCTS) {
    const K = p.id.toUpperCase();
    let base = env[`${K}_BASE_URL`]?.replace(/\/+$/, '');
    const before = summary.length;
    for (let attempt = 0; attempt < 3; attempt++) {
      const merged = { ...env, ...updates };
      if (base) {
        const r = await check(p.id, base, merged);
        if (r.ok) {
          ok(`${p.name}: ${r.text} @ ${base}`);
          record('ok', p.name, base);
          break;
        }
        bad(`${p.name} @ ${base}: ${r.text}`);
        if (r.kind === 'tls') await explainTls(r);
        if (opt.check || !interactive) {
          record('fail', p.name, r.text);
          break;
        }
      } else if (opt.check || !interactive) {
        (p.required ? bad : warn)(`${p.name}: not configured`);
        record(p.required ? 'fail' : 'skip', p.name, 'not configured');
        break;
      } else if (!p.required && !(await confirm(`Set up ${p.name} (pull requests and code review)?`, false))) {
        record('skip', p.name, 'not configured');
        break;
      }
      // Ask (again).
      const url = normaliseUrl(await ask(`${p.name} URL:`, base ?? (p.id === 'confluence' && isCloud(updates.JIRA_BASE_URL ?? env.JIRA_BASE_URL ?? '') ? normaliseUrl(updates.JIRA_BASE_URL ?? env.JIRA_BASE_URL, 'confluence') : '')), p.id);
      if (!url) {
        record(p.required ? 'fail' : 'skip', p.name, 'no URL given');
        break;
      }
      base = updates[`${K}_BASE_URL`] = url;
      info(tokenHelp(p.id, url));
      if (isCloud(url)) {
        const email = await ask('Atlassian account email:', merged.ATLASSIAN_EMAIL ?? '');
        const current = merged.ATLASSIAN_API_TOKEN;
        const tok = await askSecret(`API token${current ? ` (Enter keeps ${mask(current)})` : ''}:`);
        updates.ATLASSIAN_EMAIL = email;
        if (tok) updates.ATLASSIAN_API_TOKEN = tok;
      } else {
        const key = p.id === 'bitbucket' ? 'BITBUCKET_TOKEN' : `${K}_PAT`;
        const current = merged[key];
        const tok = await askSecret(`${p.id === 'bitbucket' ? 'HTTP access token' : 'Personal access token'}${current ? ` (Enter keeps ${mask(current)})` : ''}:`);
        if (tok) updates[key] = tok;
      }
    }
    if (summary.length === before) record(p.required ? 'fail' : 'warn', p.name, 'still failing after 3 tries');
  }

  if (Object.keys(updates).length && !opt.check) {
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, mergeEnv(text || '# sdlc-work credentials (per user). Keep private; never commit.\n', updates));
    restrict(envFile);
    ok(`saved to ${envFile} (readable only by you)`);
  }

  if (has('gh')) {
    const r = run('gh', ['auth', 'status']);
    if (r.ok) ok('GitHub: gh is logged in');
    else if (!opt.check && (await confirm('GitHub: log in with gh now (for GitHub pull requests)?', false))) run('gh', ['auth', 'login'], { inherit: true, timeout: 600_000 });
    else info('GitHub PRs later: gh auth login');
  }
}

function restrict(file) {
  if (win) run('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`]);
  else chmodSync(file, 0o600);
}

async function explainTls(r) {
  info('Node does not trust the certificate the server presented. Behind a company proxy that is normal; fix it once:');
  if (nodeMajor() >= 22 && worksWithSystemCa(r.url, r.authorization)) {
    info('It works when Node uses the operating system certificate store (--use-system-ca).');
    if (!opt.check && (await confirm('Add --use-system-ca to NODE_OPTIONS for your user?', true))) {
      persistNodeOption('--use-system-ca');
      process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --use-system-ca`.trim();
      info('Set. Open a new terminal (and restart your editor) so every tool picks it up, then re-run setup to verify.');
      record('warn', 'TLS', 'NODE_OPTIONS=--use-system-ca set; re-run in a new terminal');
      return;
    }
  }
  info('Otherwise: export your company root certificate as PEM and set NODE_EXTRA_CA_CERTS=<path to .pem>.');
  info('The MCP server (Python) also needs it: REQUESTS_CA_BUNDLE=<same .pem>, and UV_NATIVE_TLS=1 for uv downloads.');
}

// ---- 5. extras ------------------------------------------------------------------------------------------------

async function extras() {
  step(5, 'Extras');
  // Warm the MCP server once: proves PyPI is reachable (proxies!) and makes the first editor start fast.
  if (has('uvx')) {
    const r = run('uvx', [`mcp-atlassian@${MCP_ATLASSIAN_VERSION}`, '--help'], { timeout: 300_000 });
    if (r.ok) {
      ok(`MCP server mcp-atlassian ${MCP_ATLASSIAN_VERSION} is downloadable and runs`);
      record('ok', 'MCP server package');
    } else {
      bad(`uvx could not fetch/run mcp-atlassian: ${r.out.split('\n').slice(-2).join(' ')}`);
      info('Behind a proxy: set HTTPS_PROXY, and UV_NATIVE_TLS=1 if TLS is inspected; or ask for a PyPI mirror (UV_INDEX_URL).');
      record('fail', 'MCP server package', 'uvx could not fetch mcp-atlassian');
    }
  }
  const gsd = ['.claude', '.codex', '.copilot', '.config/opencode'].some((d) => existsSync(join(home, d, 'gsd-core')));
  if (gsd) ok('GSD Core is installed (gsd planning engine available)');
  else if (!opt.check && (await confirm('Install GSD Core for the "gsd" planning engine? (optional; the "piv" engine needs nothing)', false))) {
    run('npx', ['-y', '@opengsd/gsd-core@latest'], { inherit: true, timeout: 900_000 });
  } else info('GSD Core not installed: repos can use the "piv" engine, or install later with npx @opengsd/gsd-core');
}

// ---- uninstall ------------------------------------------------------------------------------------------------

async function uninstall() {
  step(1, 'Uninstall');
  for (const dir of skillDirs) for (const n of skillNames()) rmSync(join(dir, `sdlc-${n}`), { recursive: true, force: true });
  ok('skills removed');
  const only = opt.agents?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const a of AGENTS) {
    if (opt.agents !== undefined && !only.includes(a.id)) continue;
    if (!has(...a.detect) || !REGISTER[a.id].present()) continue;
    if (a.id === 'claude' && !(await confirm('Also uninstall the Claude Code plugin sdlc@sdlc-work?', true))) continue;
    const r = REGISTER[a.id].remove();
    (r.ok ? ok : warn)(`${a.name}: ${r.ok ? 'removed' : r.out}`);
  }
  rmSync(binDir, { recursive: true, force: true });
  if (win && !opt['no-path']) {
    run('powershell', ['-NoProfile', '-Command', `$d='${binDir.replace(/'/g, "''")}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', ((($p -split ';') | Where-Object { $_ -and $_ -ne $d }) -join ';'), 'User')`]);
  }
  ok(`CLI removed (${binDir}); kept ${envFile}`);
}

// ---- main -----------------------------------------------------------------------------------------------------

async function main() {
  console.log(c(1, `sdlc-work setup${opt.check ? ' --check (no changes)' : ''}`));
  if (!existsSync(join(plugin, 'bin', 'sdlc-atl.mjs'))) throw new Error(`Run this from a clone of sdlc-work (missing ${join(plugin, 'bin')}).`);
  if (opt.uninstall) return uninstall();

  const nodeOk = opt['skip-prereqs'] ? nodeMajor() >= MIN_NODE : await prerequisites();
  if (!nodeOk) return report();

  const agents = await chooseAgents();
  step(3, 'Install');
  if (opt.check) {
    const cli = existsSync(join(binDir, 'sdlc-atl.mjs'));
    (cli ? ok : bad)(`sdlc-atl CLI ${cli ? `in ${binDir}` : 'not installed'}`);
    record(cli ? 'ok' : 'fail', 'sdlc-atl CLI');
    const cur = skillsCurrent();
    (cur ? ok : warn)(`skills ${cur ? 'installed and current' : 'missing or outdated (re-run setup)'}`);
    record(cur ? 'ok' : 'warn', 'skills');
    for (const a of agents.filter((x) => x.found)) {
      const p = REGISTER[a.id].present();
      (p ? ok : bad)(`${a.name}: ${p ? 'configured' : 'not configured'}`);
      record(p ? 'ok' : 'fail', a.name);
    }
  } else {
    installCli();
    if (agents.some((a) => a.skills) || !agents.length) installSkills();
    registerAgents(agents);
  }

  if (!opt['skip-credentials']) await credentials();
  await extras();
  report();
}

function report() {
  step('', 'Summary');
  const icon = { ok: c(32, '✓'), warn: c(33, '!'), fail: c(31, '✗'), skip: c(2, '-') };
  for (const s of summary) console.log(`  ${icon[s.status]} ${s.what}${s.note ? c(2, `  ${s.note}`) : ''}`);
  const failed = summary.filter((s) => s.status === 'fail').length;
  console.log(
    failed
      ? `\n${c(31, `${failed} problem(s) above.`)} Fix them and run node setup.mjs again (or --check to re-test).`
      : `\n${c(32, 'Ready.')} In a repo, start with the setup skill: /sdlc:setup in Claude Code, or ask Copilot/Codex to "use the sdlc-setup skill".\n  Open a new terminal first so PATH changes apply.`,
  );
  process.exitCode = failed ? 1 : 0;
}

main()
  .finally(() => rl?.close())
  .catch((e) => {
  console.error(c(31, `\nsetup failed: ${e.message}`));
  process.exit(1);
});
