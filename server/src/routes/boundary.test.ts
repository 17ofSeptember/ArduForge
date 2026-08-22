/**
 * AUDIT Pass 1 item 3 — every API boundary, fed the inputs a client should
 * never send. The bar: a specific status, a JSON body, and nothing about the
 * server's own filesystem in the reply.
 *
 * This drives the real app from createApp(), not a fixture that re-declares
 * the middleware, because the bug this pass found lived in the gap between the
 * body parser and the routes — exactly the part a fixture would omit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '@/app.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Every error body this API produces has this shape; the tests assert it. */
interface ApiError {
  readonly ok?: boolean;
  readonly error?: string;
}

function asApiError(text: string): ApiError {
  return JSON.parse(text) as ApiError;
}

async function post(path: string, body: string, contentType = 'application/json') {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text: await res.text() };
}

/** Every route that accepts a body. Health and boards are GET-only. */
const BODY_ROUTES = [
  '/api/compile',
  '/api/upload',
  '/api/libraries/check',
  '/api/libraries/install',
  '/api/firmata/upload',
] as const;

describe('malformed request bodies', () => {
  it.each(BODY_ROUTES)('%s answers unparseable JSON with a JSON 400', async (path) => {
    const res = await post(path, '{files:');
    expect(res.status).toBe(400);
    expect(res.contentType).toContain('application/json');
    expect(() => asApiError(res.text)).not.toThrow();
    expect(asApiError(res.text).error).toMatch(/not valid JSON/i);
  });

  it.each(BODY_ROUTES)('%s answers a bare JSON literal with a JSON 400', async (path) => {
    // `null` is valid JSON but not an object; express.json rejects it outright.
    const res = await post(path, 'null');
    expect(res.status).toBe(400);
    expect(res.contentType).toContain('application/json');
    expect(() => asApiError(res.text)).not.toThrow();
  });

  it('answers an oversized body with a JSON 413, not an HTML page', async () => {
    const huge = JSON.stringify({ files: [{ name: 'a.ino', content: 'x'.repeat(5_000_000) }] });
    const res = await post('/api/compile', huge);
    expect(res.status).toBe(413);
    expect(res.contentType).toContain('application/json');
    expect(asApiError(res.text).error).toMatch(/larger than/i);
  });

  it('never leaks a filesystem path or a stack frame in an error body', async () => {
    const probes: [string, string][] = [
      ['/api/compile', '{files:'],
      ['/api/compile', 'null'],
      ['/api/compile', JSON.stringify({ files: [{ name: 'a.ino', content: 'x'.repeat(5_000_000) }] })],
      ['/api/upload', '}{'],
      ['/api/libraries/install', 'not json'],
      ['/api/firmata/upload', '[[[['],
    ];
    for (const [path, body] of probes) {
      const res = await post(path, body);
      expect(res.text, `${path} leaked a path`).not.toMatch(/\/Users\/|\/home\/|node_modules/);
      expect(res.text, `${path} leaked a stack frame`).not.toMatch(/\bat [A-Za-z_$][\w$]*\s*\(/);
      expect(res.text, `${path} answered with HTML`).not.toMatch(/<!DOCTYPE|<html/i);
    }
  });

  it('answers an unknown route with JSON', async () => {
    const res = await fetch(base + '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(asApiError(await res.text()).error).toBe('Not found');
  });
});

describe('schema-rejected bodies still reach zod', () => {
  it('rejects an empty object with the field-level message', async () => {
    const res = await post('/api/compile', '{}');
    expect(res.status).toBe(400);
    expect(asApiError(res.text).ok).toBe(false);
  });

  it.each([
    ['wrong types', '{"files":123,"fqbn":false}'],
    ['null fields', '{"files":null,"fqbn":null}'],
    ['empty array', '{"files":[],"fqbn":"arduino:avr:uno"}'],
    ['empty fqbn', '{"files":[{"name":"a.ino","content":""}],"fqbn":""}'],
    ['deep nesting', `{"files":${'['.repeat(500)}${']'.repeat(500)},"fqbn":"arduino:avr:uno"}`],
  ])('rejects %s with a 400 and a message', async (_label, body) => {
    const res = await post('/api/compile', body);
    expect(res.status).toBe(400);
    expect(typeof asApiError(res.text).error).toBe('string');
  });

  it('rejects a sketch file name that escapes the sketch directory', async () => {
    const res = await post(
      '/api/compile',
      '{"files":[{"name":"../../evil.ino","content":"x"}],"fqbn":"arduino:avr:uno"}',
    );
    expect(res.status).toBe(400);
    expect(asApiError(res.text).error).toMatch(/not a valid file name/i);
  });

  it('rejects an fqbn carrying shell metacharacters', async () => {
    const res = await post(
      '/api/compile',
      '{"files":[{"name":"a.ino","content":"x"}],"fqbn":"a;rm -rf /"}',
    );
    expect(res.status).toBe(400);
    expect(asApiError(res.text).error).toMatch(/invalid characters/i);
  });

  it('treats a non-JSON content type as an absent body rather than crashing', async () => {
    const res = await post('/api/libraries/install', 'name=x', 'text/plain');
    expect(res.status).toBe(400);
    expect(res.contentType).toContain('application/json');
  });
});
