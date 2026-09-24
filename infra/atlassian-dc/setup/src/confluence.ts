import type { Page } from 'playwright';
import { runWizard, submit, type Step } from './wizard.ts';
import { rest, type Admin, type Auth } from './rest.ts';

export async function confluenceWizard(page: Page, baseUrl: string, license: string, admin: Admin, debugDir: string) {
  const steps: Step[] = [
    {
      name: 'license',
      match: /setuplicense/,
      run: async (p) => {
        await p.locator('textarea[name=confLicenseString]').fill(license);
        await submit(p, () => p.locator('#setupTypeCustom').click());
      },
    },
    {
      name: 'deployment type (non-clustered)',
      match: /setupcluster|setupdeploymenttype/i,
      run: async (p) => {
        await p.getByLabel(/non-clustered|standalone/i).check();
        await submit(p, () => p.getByRole('button', { name: 'Next' }).click());
      },
    },
    {
      name: 'load content (empty site)',
      match: /setupdata/,
      run: (p) => submit(p, () => p.getByRole('button', { name: /empty site/i }).click()),
    },
    {
      name: 'user management (internal)',
      match: /setupusermanagementchoice/,
      run: (p) => submit(p, () => p.getByRole('button', { name: /within confluence/i }).click()),
    },
    {
      name: 'administrator account',
      match: /setupadministrator/,
      run: async (p) => {
        await p.locator('input[name=username]').fill(admin.user);
        await p.locator('input[name=fullName]').fill('Local Admin');
        await p.locator('input[name=email]').fill(admin.email);
        await p.locator('input[name=password]').fill(admin.password);
        await p.locator('input[name=confirm]').fill(admin.password);
        await submit(p, () => p.getByRole('button', { name: 'Next' }).click());
      },
    },
  ];
  await page.goto(baseUrl, { timeout: 10 * 60_000 });
  await runWizard(page, 'confluence', steps, /finishsetup|setupsuccessful|dashboard\.action|welcome/i, debugDir);
}

export async function ensureConfluenceSpace(baseUrl: string, auth: Auth, key: string, name: string) {
  const existing = await rest(baseUrl, auth, 'GET', `/rest/api/space/${key}`, undefined, [404]);
  if (existing) return false;
  await rest(baseUrl, auth, 'POST', '/rest/api/space', { key, name });
  return true;
}
