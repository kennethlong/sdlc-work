import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClient } from '../src/http.ts';

// Scripted responses per path: each request to a path takes the next status (the last one repeats).
const script: Record<string, number[]> = {};
const hits: Record<string, number> = {};
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url!.split('?')[0]!;
    const n = (hits[path] = (hits[path] ?? 0) + 1);
    if (path === '/slow') return void setTimeout(() => res.end('{}'), 2_000);
    const seq = script[path] ?? [200];
    const status = seq[Math.min(n, seq.length) - 1]!;
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0.01' });
    res.end(status === 403 ? '{"errorMessages":["You will not be able to create new issues until you renew your license"]}' : '{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const client = (timeoutMs?: number) => new HttpClient(base, { type: 'bearer', token: 't' }, { timeoutMs });

describe('HttpClient retries', () => {
  it('retries a GET on 503', async () => {
    script['/get503'] = [503, 200];
    expect(await client().get('/get503')).toEqual({ ok: true });
    expect(hits['/get503']).toBe(2);
  });

  it('does not repeat a POST on 503 (it may already have created the issue)', async () => {
    script['/post503'] = [503, 200];
    await expect(client().post('/post503', {})).rejects.toThrow(/-> 503/);
    expect(hits['/post503']).toBe(1);
  });

  it('retries a POST on 429 (rate limited: nothing was created)', async () => {
    script['/post429'] = [429, 200];
    expect(await client().post('/post429', {})).toEqual({ ok: true });
    expect(hits['/post429']).toBe(2);
  });
});

describe('HttpClient errors', () => {
  it('explains a 401 as a credential problem, naming the instance', async () => {
    script['/auth'] = [401];
    await expect(client().get('/auth')).rejects.toThrow(new RegExp(`authentication failed for ${base.replace(/\./g, '\\.')}.*expired`));
  });

  it('keeps the server message for a 403 that has one', async () => {
    script['/lic'] = [403];
    await expect(client().post('/lic', {})).rejects.toThrow(/renew your license$/);
  });

  it('times out with a readable message instead of hanging', async () => {
    const c = new HttpClient(base, { type: 'bearer', token: 't' }, { timeoutMs: 200, retries: 0 });
    await expect(c.get('/slow')).rejects.toThrow(/no response within 0\.2s/);
  });

  it('says what a refused connection means', async () => {
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r())); // nothing listens there now
    const c = new HttpClient(`http://127.0.0.1:${port}`, { type: 'bearer', token: 't' }, { retries: 0 });
    await expect(c.get('/x')).rejects.toThrow(/connection refused/);
  });
});
