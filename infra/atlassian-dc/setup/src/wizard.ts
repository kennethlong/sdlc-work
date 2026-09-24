import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** `match` is tested against "<url> | <page headings>": Jira swaps wizard pages without changing the URL. */
export type Step = { match: RegExp; name: string; run: (page: Page) => Promise<void> };

// License and DB-initialisation steps can take minutes on first boot.
const LONG = Number(process.env.SETUP_STEP_TIMEOUT_MS ?? 10 * 60_000);

export async function fingerprint(page: Page): Promise<string> {
  const headings = await page
    .locator('h1:visible, h2:visible')
    .allInnerTexts()
    .catch(() => [] as string[]);
  return `${page.url()} | ${headings.map((h) => h.trim()).join(' / ')}`;
}

/**
 * Drive a setup wizard: repeatedly identify the current page and run its step, until `done` matches.
 * An unrecognized page stops the run with a screenshot + form dump for diagnosis.
 */
export async function runWizard(page: Page, product: string, steps: Step[], done: RegExp, debugDir: string) {
  page.setDefaultTimeout(LONG);
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForLoadState('domcontentloaded');
    await page.locator('h1:visible, h2:visible').first().waitFor({ timeout: LONG }).catch(() => {});
    const fp = await fingerprint(page);
    if (done.test(fp)) return;
    const step = steps.find((s) => s.match.test(fp));
    if (!step) throw await diagnose(page, product, `no step matches: ${fp}`, debugDir);
    if (fp === last) throw await diagnose(page, product, `step '${step.name}' did not advance`, debugDir);
    console.log(`  ${product}: ${step.name}`);
    last = fp;
    try {
      await step.run(page);
    } catch (e) {
      throw await diagnose(page, product, `step '${step.name}' failed: ${(e as Error).message.split('\n')[0]}`, debugDir);
    }
  }
  throw await diagnose(page, product, 'wizard did not finish within 40 steps', debugDir);
}

/** Click a submit control, then wait until the page (URL or headings) has moved on. */
export async function submit(page: Page, click: () => Promise<void>) {
  const before = await fingerprint(page);
  await click();
  const deadline = Date.now() + LONG;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const errors = await page.locator('.error:visible, .aui-message-error:visible').allInnerTexts().catch(() => []);
    if (errors.some((e) => e.trim())) throw new Error(`form error: ${errors.join(' | ')}`);
    if ((await fingerprint(page).catch(() => before)) !== before) return;
  }
  throw new Error(`page did not change within ${LONG / 1000}s after submitting`);
}

async function diagnose(page: Page, product: string, reason: string, debugDir: string) {
  mkdirSync(debugDir, { recursive: true });
  const shot = join(debugDir, `${product}-failure.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const form = await page
    .evaluate(() =>
      [...document.querySelectorAll('input,select,textarea,button')]
        .filter((e) => (e as HTMLInputElement).type !== 'hidden' && (e as HTMLElement).offsetParent !== null)
        .map((e) => `${e.tagName.toLowerCase()} name=${e.getAttribute('name')} id=${e.id} ${(e.textContent ?? '').trim().slice(0, 40)}`)
        .join('\n    '),
    )
    .catch(() => '');
  return new Error(`${product} setup stopped: ${reason}\n  screenshot: ${shot}\n  visible fields:\n    ${form}`);
}
