import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('PWA ma ścisłe nagłówki dokumentu na wszystkich ścieżkach Vercela', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rule = config.headers.find((item) => item.source === '/(.*)');
  const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
  expect(headers['X-Frame-Options']).toBe('DENY');
  expect(headers['Referrer-Policy']).toBe('no-referrer');
  expect(headers['X-Content-Type-Options']).toBe('nosniff');
  expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  expect(headers['Content-Security-Policy']).toContain("connect-src 'self'");
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
});

