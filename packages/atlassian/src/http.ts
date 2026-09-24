/** Error from an Atlassian REST call, with the server's messages flattened into `message`. */
export class AtlassianError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} -> ${status}: ${describe(body)}`);
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

export type Query = Record<string, string | number | boolean | undefined>;

export type RequestOptions = {
  query?: Query;
  body?: unknown;
  /** Statuses returned as `undefined` instead of throwing (e.g. 404 for "not found"). */
  tolerate?: number[];
  contentType?: string;
};

/** Minimal JSON REST client for a DC product: PAT bearer auth, XSRF bypass, retry on 429/503. */
export class HttpClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly retries: number;

  constructor(baseUrl: string, token: string, retries = 3) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.retries = retries;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'X-Atlassian-Token': 'no-check',
          ...(opts.body !== undefined ? { 'Content-Type': opts.contentType ?? 'application/json' } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });

      if ((res.status === 429 || res.status === 503) && attempt < this.retries) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (opts.tolerate?.includes(res.status)) return undefined as T;

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      if (!res.ok) throw new AtlassianError(method, path, res.status, parsed);
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
