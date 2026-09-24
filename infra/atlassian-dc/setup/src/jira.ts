import type { Page } from 'playwright';
import { runWizard, submit, type Step } from './wizard.ts';
import { rest, type Admin, type Auth } from './rest.ts';

export async function jiraWizard(page: Page, baseUrl: string, license: string, admin: Admin, debugDir: string) {
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  const steps: Step[] = [
    {
      name: 'application properties',
      match: /Set up application properties/i,
      run: (p) => submit(p, next),
    },
    {
      name: 'administrator account',
      match: /Set up administrator account/i,
      run: async (p) => {
        await p.locator('input[name=fullname]').fill('Local Admin');
        await p.locator('input[name=email]').fill(admin.email);
        await p.locator('input[name=username]').fill(admin.user);
        await p.locator('input[name=password]').fill(admin.password);
        await p.locator('input[name=confirm]').fill(admin.password);
        await submit(p, next);
      },
    },
    {
      name: 'email notifications (later)',
      match: /email notifications/i,
      run: async (p) => {
        await p.locator('#jira-setupwizard-email-notifications-disabled').check();
        await submit(p, () => p.getByRole('button', { name: 'Finish' }).click());
      },
    },
    // Broadest pattern last.
    {
      name: 'license',
      match: /license/i,
      run: async (p) => {
        await p.locator('textarea').first().fill(license);
        await submit(p, next);
      },
    },
  ];
  await page.goto(baseUrl, { timeout: 10 * 60_000 });
  await runWizard(page, 'jira', steps, /Dashboard|WelcomeToJIRA|Onboarding|login\.jsp|Welcome to Jira/i, debugDir);
}

export async function ensureJiraProject(baseUrl: string, auth: Auth, lead: string, key: string, name: string) {
  const existing = await rest(baseUrl, auth, 'GET', `/rest/api/2/project/${key}`, undefined, [404]);
  if (existing) return false;
  await rest(baseUrl, auth, 'POST', '/rest/api/2/project', {
    key,
    name,
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-scrum-template',
    lead,
  });
  return true;
}
