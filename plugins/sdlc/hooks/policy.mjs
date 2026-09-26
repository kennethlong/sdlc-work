// Safety policy for the sdlc plugin's PreToolUse hook: pure functions, no I/O, so they can be unit-tested and
// reasoned about. Two guarantees (the reference's baseline): the agent cannot read secrets, and it cannot run a
// command that destroys a lot at once. Tool names cover Claude Code (Bash, PowerShell, Read, ...) and GitHub
// Copilot CLI (bash, powershell, view, ...), which runs the same hooks.json.

const lc = (s) => String(s ?? '').toLowerCase();

const SHELL_TOOLS = new Set(['bash', 'powershell', 'pwsh', 'shell', 'run_in_terminal', 'terminal']);
const FILE_TOOLS = new Set(['read', 'view', 'edit', 'multiedit', 'write', 'create', 'notebookedit', 'str_replace_editor', 'str_replace', 'insert']);
const SEARCH_TOOLS = new Set(['grep', 'glob', 'rg', 'search', 'find']);

// ---- secrets ----------------------------------------------------------------------------------------------------

/** Committed templates are safe to read: .env.example, atlassian.env.sample, ... */
const TEMPLATE = /\.(example|sample|template|dist|defaults?)$/i;

/**
 * Files that hold credentials: env files (`.env`, `.env.local`, `prod.env`, `~/.sdlc/atlassian.env`), private keys
 * and key stores, and the usual credential stores. Public keys (`id_rsa.pub`) and templates are fine.
 */
export function isSecretPath(p) {
  const path = String(p ?? '').replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  const base = path.split('/').pop() ?? '';
  if (!base || TEMPLATE.test(base) || base.endsWith('.pub')) return false;
  if (/^\.env(\..+)?$/i.test(base) || /\.env$/i.test(base)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(base)) return true;
  if (/^(\.netrc|_netrc|\.git-credentials|\.pgpass|credentials\.json|secrets\.(json|ya?ml))$/i.test(base)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(path) || /(^|\/)\.docker\/config\.json$/i.test(path)) return true;
  return false;
}

/** Words a shell would treat as separate arguments (good enough to spot file names). */
function words(command) {
  return String(command).split(/[\s;|&<>()`,=]+/).map((w) => w.replace(/^["'@]+|["']+$/g, '')).filter(Boolean);
}

const SECRET_VAR = /(TOKEN|SECRET|PASSW(OR)?D|PASSWD|API_?KEY|_PAT\b|^PAT\b|CREDENTIAL|PRIVATE_?KEY|AUTH)/i;

/** Commands that print the whole environment, or a secret-looking variable. */
function dumpsEnvironment(command) {
  const c = String(command);
  if (/(^|[;&|(]\s*)(printenv|env|export\s+-p|declare\s+-x|set)\s*($|[;&|>)])/im.test(c)) return 'prints every environment variable';
  if (/\b(Get-ChildItem|gci|ls|dir|Get-Item|gi)\s+env:/i.test(c)) return 'lists the environment (env: drive)';
  if (/\[(System\.)?Environment\]::GetEnvironmentVariables\s*\(/i.test(c)) return 'lists the environment';
  if (/(console\.log|JSON\.stringify|print)\s*\(\s*(process\.env|os\.environ)\s*\)/i.test(c)) return 'prints the environment';
  const printer = /\b(echo|printf|Write-(Output|Host)|cat|type)\b/i;
  const vars = [...c.matchAll(/\$\{?(env:)?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%|process\.env\.([A-Za-z_][A-Za-z0-9_]*)|os\.environ\[['"]([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((m) => m[2] ?? m[3] ?? m[4] ?? m[5]);
  const secret = vars.find((v) => SECRET_VAR.test(v));
  if (secret && (printer.test(c) || /console\.log|print\(/.test(c))) return `prints ${secret}`;
  return undefined;
}

// ---- destructive commands ---------------------------------------------------------------------------------------

/**
 * A delete target is "broad" when it is a filesystem root, a home directory or a direct child of one, the current
 * or parent directory, or a bare wildcard. Paths inside a project (`node_modules`, `dist`, `packages/x/build`,
 * `/tmp/x/y`) are not: agents clean build output all the time, and a guard that blocks that gets switched off.
 */
export function isBroadTarget(target, home = '') {
  let t = String(target ?? '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!t) return false;
  if (/^(\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%|%HOMEPATH%|~)(\/.*)?$/i.test(t)) {
    const rest = t.replace(/^[^/]*/, '').split('/').filter((s) => s && s !== '*');
    return rest.length <= 1; // ~, ~/, ~/*, ~/projects
  }
  const h = String(home).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (h && (t.toLowerCase() === h || t.toLowerCase().startsWith(`${h}/`))) {
    const rest = t.slice(h.length).split('/').filter((s) => s && s !== '*');
    return rest.length <= 1;
  }
  if (/^(\.|\.\/|\.\.|\.\.\/.*|\*|\.\/\*|\.\*|\/\*)$/.test(t) || /^\.\.(\/|$)/.test(t)) return true;
  // Absolute paths: strip the root (/, C:/, Git Bash /c/) and count what is left.
  const m = t.match(/^([A-Za-z]:\/?|\/[A-Za-z](?=\/|$)\/?|\/)(.*)$/);
  if (m) {
    const rest = m[2].split('/').filter((s) => s && s !== '*');
    return rest.length <= 1; // /, C:\, /c/Users, /etc, C:\Windows
  }
  return false;
}

const RM = /(^|[\s;&|(])(sudo\s+)?rm\s+([^;&|]*)/g;

function rmRecursiveForceBroad(command, home) {
  for (const m of String(command).matchAll(RM)) {
    const args = m[3].trim().split(/\s+/);
    const flags = args.filter((a) => a.startsWith('-'));
    const short = flags.filter((f) => /^-[a-z]+$/i.test(f)).join('');
    const recursive = /r/i.test(short) || flags.includes('--recursive');
    const force = /f/.test(short) || flags.includes('--force');
    if (flags.includes('--no-preserve-root')) return 'rm --no-preserve-root';
    if (recursive && force) {
      const target = args.filter((a) => !a.startsWith('-')).find((a) => isBroadTarget(a, home));
      if (target) return `rm -rf ${target}`;
    }
  }
  return undefined;
}

function powershellRecursiveBroad(command, home) {
  const c = String(command);
  for (const m of c.matchAll(/\b(Remove-Item|ri|rm|del|erase|rd|rmdir)\b([^;|&\n]*)/gi)) {
    const rest = m[2];
    if (!/-Recurse\b|-r\b|\/s\b/i.test(rest)) continue;
    const targets = rest.replace(/-(Recurse|Force|Confirm:\$?\w+|ErrorAction\s+\w+|r|fo?)\b/gi, ' ').replace(/\/[sq]\b/gi, ' ').replace(/-(Path|LiteralPath)\b/gi, ' ').trim().split(/\s+/);
    const target = targets.find((t) => isBroadTarget(t, home));
    if (target) return `${m[1]} -Recurse ${target}`;
  }
  return undefined;
}

const PROTECTED_BRANCHES = /^(main|master)$/i;

/**
 * `git push --force` (or `+ref`, `--delete`, `:ref`) that rewrites or deletes main/master. With no branch named,
 * the current branch decides (`currentBranch` is looked up by the caller only when needed).
 */
function forcePushToProtected(command, currentBranch) {
  for (const m of String(command).matchAll(/\bgit\s+push\b([^;&|\n]*)/g)) {
    const args = m[1].trim().split(/\s+/).filter(Boolean);
    const force = args.some((a) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror)$/.test(a) || /^-[a-z]*f[a-z]*$/.test(a));
    const del = args.some((a) => a === '--delete' || a === '-d');
    const refs = args.filter((a) => !a.startsWith('-')).slice(1); // first positional is the remote
    const dest = (r) => r.replace(/^\+/, '').split(':').pop();
    if (refs.some((r) => (r.startsWith('+') || r.startsWith(':')) && PROTECTED_BRANCHES.test(dest(r)))) return `git push ${refs.join(' ')}`;
    if (!force && !del) continue;
    if (refs.length ? refs.some((r) => PROTECTED_BRANCHES.test(dest(r))) : PROTECTED_BRANCHES.test(currentBranch?.() ?? '')) {
      return `git push ${force ? '--force' : '--delete'} to a protected branch`;
    }
  }
  return undefined;
}

const DESTRUCTIVE = [
  { rule: 'git-reset-hard', re: /\bgit\s+reset\s+([^;&|\n]*\s)?--hard\b/, what: 'git reset --hard discards uncommitted work' },
  { rule: 'git-clean', re: /\bgit\s+clean\s+([^;&|\n]*\s)?-[a-z]*f[a-z]*\b[^;&|\n]*(-[a-z]*[dx]|\s-[dx])|\bgit\s+clean\s+-[a-z]*(d[a-z]*f|f[a-z]*d|x[a-z]*f|f[a-z]*x)/i, what: 'git clean -fd/-fx deletes untracked files' },
  { rule: 'git-discard-all', re: /\bgit\s+(checkout\s+(--\s+)?\.|restore\s+(--worktree\s+)?\.)(\s|$|;)/, what: 'discards every uncommitted change' },
  { rule: 'drop-database', re: /\bDROP\s+(DATABASE|SCHEMA)\b/i, what: 'DROP DATABASE/SCHEMA' },
  { rule: 'disk', re: /(^|[\s;&|])(mkfs(\.\w+)?|diskpart|Format-Volume|Clear-Disk|Remove-Partition|Initialize-Disk)\b|\bformat\s+[A-Za-z]:|\bdd\s+[^;&|\n]*of=\/dev\/(sd|nvme|disk|hd)/i, what: 'formats or overwrites a disk' },
];

// ---- evaluation --------------------------------------------------------------------------------------------------

const deny = (rule, reason) => ({ decision: 'deny', rule, reason: `Blocked by the sdlc safety hook (${rule}): ${reason}. If it is really needed, ask the user to run it themselves.` });
const ALLOW = { decision: 'allow' };

export function pathOf(input) {
  return input?.file_path ?? input?.path ?? input?.notebook_path ?? input?.filePath ?? '';
}

/**
 * Decide one tool call. `ctx.home` is the user's home directory; `ctx.currentBranch` returns the checked-out branch
 * (only called for a force push without an explicit branch).
 */
export function evaluate(toolName, input = {}, ctx = {}) {
  const tool = lc(toolName);
  if (FILE_TOOLS.has(tool)) {
    const p = pathOf(input);
    return isSecretPath(p) ? deny('secret-file', `${p} holds credentials; read a committed template (e.g. .env.example) instead`) : ALLOW;
  }
  if (SEARCH_TOOLS.has(tool)) {
    const targets = [input.path, input.glob, input.pattern, ...(tool === 'glob' ? [] : [])].filter(Boolean);
    const hit = targets.find((t) => isSecretPath(t) || /(^|[\\/*])\.env(\b|$)(?!\.(example|sample|template))/i.test(String(t)));
    return hit ? deny('secret-file', `searching ${hit} would read credentials`) : ALLOW;
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = String(input.command ?? input.cmd ?? '');
    const secretWord = words(command).find(isSecretPath);
    if (secretWord) return deny('secret-file', `the command touches ${secretWord}, which holds credentials`);
    const dump = dumpsEnvironment(command);
    if (dump) return deny('secret-env', `the command ${dump}`);
    const rm = rmRecursiveForceBroad(command, ctx.home) ?? powershellRecursiveBroad(command, ctx.home);
    if (rm) return deny('broad-delete', `${rm} would delete far more than a build folder`);
    const push = forcePushToProtected(command, ctx.currentBranch);
    if (push) return deny('force-push', `${push} rewrites or deletes shared history`);
    const d = DESTRUCTIVE.find((x) => x.re.test(command));
    if (d) return deny(d.rule, d.what);
  }
  return ALLOW;
}

// ---- audit -------------------------------------------------------------------------------------------------------

const TOKENS = [
  /\b(ATATT[A-Za-z0-9_=-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|BBDC-[A-Za-z0-9_+/=-]{16,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,})/g,
  /((?:Bearer|Basic|token)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /((?:password|passwd|pwd|secret|token|api[_-]?key|pat)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
];

/** Redact anything token-shaped, then shorten. */
export function redact(text, max = 400) {
  let t = String(text ?? '');
  t = t.replace(TOKENS[0], '[REDACTED]').replace(TOKENS[1], '$1[REDACTED]').replace(TOKENS[2], '$1[REDACTED]');
  return t.length > max ? `${t.slice(0, max)}… (${t.length} chars)` : t;
}

/** What the audit log keeps about a call: the command or path, never file contents or edits. */
export function summarize(toolName, input = {}) {
  const tool = lc(toolName);
  if (SHELL_TOOLS.has(tool)) return { command: redact(input.command ?? input.cmd ?? '') };
  if (FILE_TOOLS.has(tool) || SEARCH_TOOLS.has(tool)) {
    const s = {};
    for (const k of ['file_path', 'path', 'notebook_path', 'pattern', 'glob']) if (input[k] !== undefined) s[k] = redact(input[k], 200);
    return s;
  }
  return { keys: Object.keys(input ?? {}).slice(0, 20) };
}
