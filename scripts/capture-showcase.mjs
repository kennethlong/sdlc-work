// Capture the marketing screenshots (docs/marketing/screens) from the local DC stack after scripts/seed-showcase.ts.
// Usage: node scripts/capture-showcase.mjs [name-prefix]   (needs infra/atlassian-dc/setup's node_modules)
import { chromium } from '../infra/atlassian-dc/setup/node_modules/playwright/index.mjs';
import { envLookup } from '../packages/atlassian/src/index.ts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));

const env = envLookup({ cwd: repo });
const out = join(repo, 'docs/marketing/screens');
mkdirSync(out, { recursive: true });
const only = process.argv[2];
const browser = await chromium.launch();
const viewport = { width: 1400, height: 860 };
let user = env('JIRA_ADMIN_USER') || 'admin';
const pw = { jira: env('JIRA_ADMIN_PASSWORD'), bb: env('BITBUCKET_ADMIN_PASSWORD') || env('JIRA_ADMIN_PASSWORD') };
let password = pw.jira;
const cf = { user: env('CONFLUENCE_ADMIN_USER'), pw: env('CONFLUENCE_ADMIN_PASSWORD') };

const HIDE = `.aui-flag,#aui-flag-container,.aui-blanket,#aui-message-bar,.aui-banner,.ghx-flag-container,
  #announcement-banner,.license-banner,#license-banner,.hopscotch-bubble,[class*=blanket],[class*=Blanket],
  [role=dialog],[aria-modal=true],aui-inline-dialog,.aui-inline-dialog,[id^=inline-dialog],.jira-help-tip,.helptip-container,[class*=spotlight],[class*=onboarding],[class*=Onboarding] {display:none !important}`;

// Remove any fixed, near-full-viewport overlay (onboarding modals, backdrops) left after hiding dialogs.
const stripOverlays = () => {
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) el.remove();
  }
};

async function settle(page, ms) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
  for (const t of ['Got it', 'OK, got it', 'Skip', 'Dismiss', 'Close'])
    for (const b of await page.getByRole('button', { name: t, exact: true }).all()) await b.click({ timeout: 1500 }).catch(() => {});
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.evaluate(stripOverlays).catch(() => {});
  await page.waitForTimeout(600);
}

async function login(page, url) {
  await page.goto(url, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.locator('input[name=os_username], #username-field, #login-form-username, input[name=username]').first().fill(user);
  await page.locator('input[name=os_password], #password-field, #login-form-password, input[name=password]').first().fill(password);
  await Promise.all([page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 60000 }), page.locator('#login-button, #loginButton, #login-form-submit, button[type=submit], input[type=submit]').locator('visible=true').first().click()]);
}

const shots = [];
async function shot(page, name, url, opts = {}) {
  if (only && !name.startsWith(only)) return;
  try {
    await page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' });
    if (opts.selector) await page.waitForSelector(opts.selector, { timeout: 90000 });
    await settle(page, opts.wait ?? 3500);
    if (opts.prepare) await opts.prepare(page);
    await page.evaluate(() => document.activeElement?.blur()).catch(() => {});
    await page.mouse.move(5, 700);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: !!opts.fullPage });
    shots.push(`${name}: ok`);
  } catch (e) {
    shots.push(`${name}: FAILED ${String(e.message).split(String.fromCharCode(10))[0]}`);
    await page.screenshot({ path: `${out}/_debug-${name}.png` }).catch(() => {});
  }
}

async function app(prefixes, loginUrl, fn) {
  if (only && !prefixes.some((p) => p.startsWith(only))) return;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await login(page, loginUrl);
    await fn(page);
  } catch (e) {
    shots.push(`${prefixes.join(',')}: LOGIN FAILED ${String(e.message).split(String.fromCharCode(10))[0]}`);
    await page.screenshot({ path: `${out}/_debug-login-${prefixes[0]}.png` }).catch(() => {});
  }
  await ctx.close();
}

const J = 'http://jira.localhost:8080', C = 'http://confluence.localhost:8090', B = 'http://bitbucket.localhost:7990';

await app(['1', '2'], `${J}/login.jsp`, async (page) => {
  await shot(page, '1-jira-board', `${J}/secure/RapidBoard.jspa?rapidView=1`, { selector: '.ghx-issue', wait: 3000 });
  await shot(page, '2-jira-story', `${J}/browse/SDLC-2`, { selector: '#summary-val', wait: 3000 });
});

user = cf.user; password = cf.pw;
await app(['3', '4', '5'], `${C}/login.action`, async (page) => {
  await shot(page, '3-confluence-breakdown', `${C}/pages/viewpage.action?pageId=294919`);
  await shot(page, '4-confluence-verification', `${C}/display/SDLC/Verification%3A+SDLC-2+CSV+export+endpoint`);
  await shot(page, '5-confluence-rca', `${C}/pages/viewpage.action?pageId=294928`);
});

user = env('BITBUCKET_ADMIN_USER') || env('JIRA_ADMIN_USER') || 'admin'; password = pw.bb;
await app(['6', '7'], `${B}/login`, async (page) => {
  await shot(page, '6-bitbucket-pr-review', `${B}/projects/SDLC/repos/sandbox/pull-requests/1/overview`, { wait: 5000, fullPage: true });
  await shot(page, '7-bitbucket-annotations', `${B}/projects/SDLC/repos/sandbox/pull-requests/1/diff`, { wait: 6000 });
});

await browser.close();
console.log(shots.join('\n'));
