import type { Browser } from 'playwright';

export type Admin = { user: string; password: string; email: string };
/** Basic auth (Jira allows it) or a Personal Access Token (Confluence 10 disables REST basic auth). */
export type Auth = { admin: Admin } | { token: string };

function authHeader(auth: Auth): string {
  return 'token' in auth
    ? `Bearer ${auth.token}`
    : 'Basic ' + Buffer.from(`${auth.admin.user}:${auth.admin.password}`).toString('base64');
}

/**
 * JSON REST call. Returns the parsed body, or undefined when the status is one of `tolerate`
 * (e.g. 404 for "does not exist yet").
 */
export async function rest(
  baseUrl: string,
  auth: Auth,
  method: string,
  path: string,
  body?: unknown,
  tolerate: number[] = [],
): Promise<any> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      Authorization: authHeader(auth),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (tolerate.includes(res.status)) return undefined;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

const PAT_BODY = (name: string, days: number) => ({ name, expirationDuration: days });

/** Create a Personal Access Token for the admin via REST basic auth (Jira). */
export async function createPat(baseUrl: string, admin: Admin, name: string, days = 90): Promise<string> {
  const r = await rest(baseUrl, { admin }, 'POST', '/rest/pat/latest/tokens', PAT_BODY(name, days));
  return rawToken(r);
}

/**
 * Create a Personal Access Token from a logged-in browser session (Confluence, where REST basic auth is
 * disabled). Logs in through the normal login form, then calls the PAT endpoint with the session cookie.
 */
export async function createPatViaLogin(browser: Browser, baseUrl: string, admin: Admin, name: string, days = 90) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login.action`);
    await page.locator('input[name=os_username], #username-field').first().fill(admin.user);
    await page.locator('input[name=os_password], #password-field').first().fill(admin.password);
    await Promise.all([page.waitForURL((u) => !u.pathname.includes('login')), page.locator('#login-button, #loginButton').first().click()]);
    // Call from inside the page so it is a same-origin browser request (cookie auth + Origin header);
    // Confluence's XSRF check rejects out-of-page requests even with X-Atlassian-Token.
    const res = await page.evaluate(async (body) => {
      const r = await fetch('/rest/pat/latest/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
        body: JSON.stringify(body),
      });
      return { status: r.status, text: await r.text() };
    }, PAT_BODY(name, days));
    if (res.status >= 300) throw new Error(`PAT creation -> ${res.status}: ${res.text.slice(0, 300)}`);
    return rawToken(JSON.parse(res.text));
  } finally {
    await context.close();
  }
}

function rawToken(r: any): string {
  if (!r?.rawToken) throw new Error(`PAT response had no rawToken: ${JSON.stringify(r).slice(0, 200)}`);
  return r.rawToken;
}

export async function appState(baseUrl: string): Promise<string> {
  try {
    const r = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(5000) });
    return ((await r.json()) as { state: string }).state;
  } catch {
    return 'DOWN';
  }
}
