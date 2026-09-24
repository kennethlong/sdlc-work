// Dev aid: dump the form structure of a wizard page. Usage: node src/probe.ts <url>
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('usage: node src/probe.ts <url>');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
await page.waitForSelector('form, input, button', { timeout: 60_000 }).catch(() => {});
const info = await page.evaluate(() => {
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const labelFor = (el: Element) => {
    const id = el.getAttribute('id');
    return txt(id ? document.querySelector(`label[for="${id}"]`) : el.closest('label'));
  };
  return {
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll('h1,h2,h3')].map(txt).filter(Boolean),
    fields: [...document.querySelectorAll('input,select,textarea')]
      .filter((e) => (e as HTMLInputElement).type !== 'hidden')
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        type: (e as HTMLInputElement).type,
        name: e.getAttribute('name'),
        id: e.getAttribute('id'),
        value: (e as HTMLInputElement).type === 'radio' || (e as HTMLInputElement).type === 'checkbox' ? (e as HTMLInputElement).value : undefined,
        label: labelFor(e),
      })),
    buttons: [...document.querySelectorAll('button,input[type=submit],a.aui-button')].map((b) => ({
      text: txt(b) || (b as HTMLInputElement).value,
      id: b.getAttribute('id'),
      name: b.getAttribute('name'),
    })),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
