/**
 * Unattended setup of the local Jira + Confluence DC stack. Idempotent: safe to re-run.
 *   - runs each app's first-run wizard (license, admin account) if it is still in FIRST_RUN
 *   - creates the SDLC project and space if missing
 *   - creates admin Personal Access Tokens if .env has none
 * Everything generated (admin passwords, license keys, PATs) is written to the .env file.
 *
 * Usage: node src/setup.ts [--env ../.env] [--headed] [--only jira|confluence]
 */
import { chromium, type Browser } from 'playwright';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EnvFile } from './env.ts';
import { timebombKey, type Product } from './licenses.ts';
import { appState, createPat, createPatViaLogin, type Admin, type Auth } from './rest.ts';
import { jiraWizard, ensureJiraProject } from './jira.ts';
import { confluenceWizard, ensureConfluenceSpace } from './confluence.ts';

const { values: args } = parseArgs({
  options: {
    env: { type: 'string', default: resolve(import.meta.dirname, '../../.env') },
    headed: { type: 'boolean', default: false },
    only: { type: 'string' },
  },
});

const env = new EnvFile(resolve(args.env!));
const debugDir = join(dirname(env.path), 'setup-debug');

type App = {
  name: 'jira' | 'confluence';
  prefix: 'JIRA' | 'CONFLUENCE';
  port: string;
  product: Product;
  wizard: typeof jiraWizard;
  createPat: (browser: Browser, baseUrl: string, admin: Admin) => Promise<string>;
  ensureContainer: (baseUrl: string, auth: Auth, admin: Admin) => Promise<boolean>;
  containerLabel: string;
};

const apps: App[] = [
  {
    name: 'jira',
    prefix: 'JIRA',
    port: env.get('JIRA_PORT', '8080'),
    product: 'Jira Software Data Center',
    wizard: jiraWizard,
    createPat: (_b, u, a) => createPat(u, a, 'sdlc-work'),
    ensureContainer: (u, auth, a) => ensureJiraProject(u, auth, a.user, 'SDLC', 'SDLC Sandbox'),
    containerLabel: 'project SDLC',
  },
  {
    name: 'confluence',
    prefix: 'CONFLUENCE',
    port: env.get('CONFLUENCE_PORT', '8090'),
    product: 'Confluence Data Center',
    wizard: confluenceWizard,
    createPat: (b, u, a) => createPatViaLogin(b, u, a, 'sdlc-work'),
    ensureContainer: (u, auth) => ensureConfluenceSpace(u, auth, 'SDLC', 'SDLC Sandbox'),
    containerLabel: 'space SDLC',
  },
];

function adminFor(prefix: string): Admin {
  if (!env.get(`${prefix}_ADMIN_USER`)) env.set(`${prefix}_ADMIN_USER`, 'admin');
  if (!env.get(`${prefix}_ADMIN_PASSWORD`)) {
    env.set(`${prefix}_ADMIN_PASSWORD`, randomBytes(18).toString('base64url'));
  }
  return { user: env.get(`${prefix}_ADMIN_USER`), password: env.get(`${prefix}_ADMIN_PASSWORD`), email: 'admin@example.com' };
}

const browser = await chromium.launch({ headless: !args.headed });
try {
  for (const app of apps.filter((a) => !args.only || a.name === args.only)) {
    // *.localhost keeps the two apps' JSESSIONID cookies apart and matches the base URL users browse to.
    const baseUrl = `http://${app.name}.localhost:${app.port}`;
    const admin = adminFor(app.prefix);
    const state = await appState(`http://localhost:${app.port}`);
    console.log(`${app.name}: ${state} at ${baseUrl}`);

    if (state === 'FIRST_RUN') {
      let license = env.get(`${app.prefix}_LICENSE_KEY`);
      if (!license) {
        license = await timebombKey(app.product);
        env.set(`${app.prefix}_LICENSE_KEY`, license);
        console.log(`  ${app.name}: using Atlassian 3-hour test license`);
      }
      const page = await browser.newPage();
      await app.wizard(page, baseUrl, license, admin, debugDir);
      await page.close();
      console.log(`  ${app.name}: wizard complete`);
    } else if (state !== 'RUNNING') {
      throw new Error(`${app.name} is ${state}; start the stack first (./dc.ps1 up)`);
    }

    if (!env.get(`${app.prefix}_PAT`)) {
      env.set(`${app.prefix}_PAT`, await app.createPat(browser, baseUrl, admin));
      console.log(`  ${app.name}: created personal access token -> .env ${app.prefix}_PAT`);
    }
    const auth: Auth = { token: env.get(`${app.prefix}_PAT`) };
    if (await app.ensureContainer(baseUrl, auth, admin)) console.log(`  ${app.name}: created ${app.containerLabel}`);
    env.set(`${app.prefix}_BASE_URL`, baseUrl);
  }
} finally {
  await browser.close();
}
console.log('Done.');
