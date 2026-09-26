import { authHeader, type Auth } from './config.ts';

/** Error from an Atlassian REST call, with the server's messages flattened into `message`. */
export class AtlassianError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown, baseUrl?: string) {
    super(`${method} ${path} -> ${status}: ${describe(body)}${authHint(status, body, baseUrl)}`);
    this.name = 'AtlassianError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

function describe(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
    const parts = [...(b.errorMessages ?? []), ...Object.entries(b.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
    if (b.message) parts.push(b.message);
    if (parts.length) return parts.join('; ');
  }
  return String(body ?? '').slice(0, 300);
}

/** 401/403 are almost always a credential problem; say which one and what to do. */
function authHint(status: number, body: unknown, baseUrl?: string): string {
  const where = baseUrl ? ` for ${baseUrl}` : '';
  if (status === 401) return ` (authentication failed${where}: the token is missing, wrong or expired; create a new one and update ~/.sdlc/atlassian.env)`;
  if (status === 403 && describe(body).length < 3) return ` (forbidden${where}: the account or token lacks permission for this)`;
  return '';
}

/** Network-level failure (no HTTP response): timeouts, DNS, refused connections, TLS inspection. */
export class NetworkError extends Error {
  constructor(method: string, url: URL, cause: unknown, timeoutMs: number) {
    super(`${method} ${url.origin}${url.pathname} failed: ${networkReason(cause, timeoutMs)}`, { cause });
    this.name = 'NetworkError';
  }
}

function networkReason(cause: unknown, timeoutMs: number): string {
  const e = cause as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `no response within ${timeoutMs / 1000}s (VPN or proxy? set SDLC_HTTP_TIMEOUT_MS to wait longer)`;
  const code = e?.cause?.code ?? '';
  if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code))
    return `TLS certificate not trusted (${code}). Behind a TLS-inspecting proxy, point NODE_EXTRA_CA_CERTS at your company root certificate (PEM).`;
  if (code === 'ENOTFOUND') return 'host not found (check the URL, VPN or DNS)';
  if (code === 'ECONNREFUSED') return 'connection refused (is the server up and the port right?)';
  if (code === 'ECONNRESET') return 'connection reset (proxy or firewall?)';
  return `${e?.cause?.message ?? e?.message ?? String(cause)}${code ? ` (${code})` : ''}`;
}

/** Methods safe to repeat: a repeated POST can create a duplicate issue, comment or link. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

export type Query = Record<string, string | number | boolean | undefined>;

export type RequestOptions = {
  query?: Query;
  body?: unknown;
  /** Statuses returned as `undefined` instead of throwing (e.g. 404 for "not found"). */
  tolerate?: number[];
  contentType?: string;
};

const DEFAULT_TIMEOUT_MS = Number(process.env.SDLC_HTTP_TIMEOUT_MS) || 60_000;

/**
 * Minimal JSON REST client: Bearer (DC PAT) or Basic (Cloud email + API token), XSRF bypass, a per-request
 * timeout. Retries 429 for every method, but 503 and network failures only for idempotent methods.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly retries: number;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  /** `headers` replace the Atlassian defaults (Accept JSON + XSRF bypass), e.g. for GitHub's API. */
  constructor(baseUrl: string, auth: Auth, opts: { retries?: number; headers?: Record<string, string>; timeoutMs?: number } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authorization = authHeader(auth);
    this.retries = opts.retries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.headers = opts.headers ?? { Accept: 'application/json', 'X-Atlassian-Token': 'no-check' };
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const idempotent = IDEMPOTENT.has(method.toUpperCase());
    const backoff = (attempt: number, retryAfter?: string | null) => new Promise((r) => setTimeout(r, Number(retryAfter) * 1000 || 500 * 2 ** attempt));
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: this.authorization,
            ...this.headers,
            ...(opts.body !== undefined ? { 'Content-Type': opts.contentType ?? 'application/json' } : {}),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        text = await res.text();
      } catch (e) {
        if (idempotent && attempt < this.retries) {
          await backoff(attempt);
          continue;
        }
        throw new NetworkError(method, url, e, this.timeoutMs);
      }

      if ((res.status === 429 || (res.status === 503 && idempotent)) && attempt < this.retries) {
        await backoff(attempt, res.headers.get('retry-after'));
        continue;
      }
      if (opts.tolerate?.includes(res.status)) return undefined as T;

      const parsed = text ? safeJson(text) : undefined;
      if (!res.ok) throw new AtlassianError(method, path, res.status, parsed, this.baseUrl);
      return parsed as T;
    }
  }

  get<T>(path: string, query?: Query, tolerate?: number[]) {
    return this.request<T>('GET', path, { query, tolerate });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body });
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
