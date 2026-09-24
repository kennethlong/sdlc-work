/**
 * Atlassian's published DC test ("timebomb") licenses: 10 users, valid 3 hours from when applied.
 * The page embeds its markdown source with escaped newlines; each key is a code block under a bold
 * "10 user <Product> license, expires in <ttl>" heading.
 */
export const TIMEBOMB_URL =
  'https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/';

export type Product = 'Jira Software Data Center' | 'Confluence Data Center';

export async function fetchTimebombLicenses(): Promise<Map<string, string>> {
  const html = await (await fetch(TIMEBOMB_URL)).text();
  const start = html.indexOf('Data Center host product licenses');
  if (start < 0) throw new Error(`Timebomb page layout changed: section not found at ${TIMEBOMB_URL}`);
  const section = html.slice(start).split('\\\\n').join('\n').split('\\n').join('\n');
  const found = new Map<string, string>();
  const re = /\*\*10 user ([^*]+?) license, expires in [^*]+?\*\*\s*```[^\n]*\n([\s\S]*?)```/g;
  for (const m of section.matchAll(re)) {
    const product = m[1].trim();
    if (!found.has(product)) found.set(product, m[2].replace(/[\\\s]/g, ''));
  }
  return found;
}

export async function timebombKey(product: Product): Promise<string> {
  const key = (await fetchTimebombLicenses()).get(product);
  if (!key) throw new Error(`No '${product}' key on ${TIMEBOMB_URL}`);
  return key;
}
