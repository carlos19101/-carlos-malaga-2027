import { describe, expect, it } from 'vitest';
import { isInvalidRequestError, readJson } from '../../api/_lib/http.js';
import { redirect } from '../../api/_lib/strava.js';

describe('readJson', () => {
  it('przyjmuje wyłącznie obiekt JSON', async () => {
    await expect(readJson({ body: { sessionId: 'run-1' } })).resolves.toEqual({ sessionId: 'run-1' });
    await expect(readJson({ body: '[1,2,3]' })).rejects.toThrow('invalid-json-object');
    await expect(readJson({ body: 'null' })).rejects.toThrow('invalid-json-object');
    await expect(readJson({ body: '"tekst"' })).rejects.toThrow('invalid-json-object');
  });

  it('odrzuca zbyt duże żądanie według Content-Length przed parsowaniem', async () => {
    await expect(readJson({ headers: { 'content-length': '17' }, body: '{' }, 16)).rejects.toThrow('payload-too-large');
  });

  it('rozpoznaje błąd składni i nieprawidłowy typ jako błąd żądania', async () => {
    const syntax = await readJson({ body: '{' }).catch((error) => error);
    const type = await readJson({ body: [] }).catch((error) => error);
    expect(isInvalidRequestError(syntax)).toBe(true);
    expect(isInvalidRequestError(type)).toBe(true);
  });
});

it('redirect Stravy nie daje się cacheować ani osadzać w ramce', () => {
  const headers = {};
  const response = {
    setHeader: (name, value) => { headers[name] = value; },
    end: () => {},
  };
  redirect(response, 'https://carlos.example/?strava=connected');
  expect(response.statusCode).toBe(302);
  expect(headers).toMatchObject({
    Location: 'https://carlos.example/?strava=connected',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
});
