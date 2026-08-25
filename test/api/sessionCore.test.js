import { describe, expect, it } from 'vitest';
import {
  allowedRequestOrigin,
  authenticated,
  createSessionToken,
  parseCookies,
  passcodeMatches,
  serviceConfiguration,
  SESSION_COOKIE,
  verifySessionToken,
} from '../../api/_lib/session.js';

describe('sesja HttpOnly', () => {
  const secret = 'test-secret-that-is-long-enough';
  const now = new Date('2026-08-25T20:00:00.000Z');

  it('tworzy i weryfikuje podpisany token z terminem ważności', () => {
    const token = createSessionToken(secret, { now, ttlSeconds: 60, nonce: 'fixed' });
    expect(verifySessionToken(token, secret, { now: new Date('2026-08-25T20:00:30.000Z') })).toBe(true);
    expect(verifySessionToken(token, secret, { now: new Date('2026-08-25T20:01:01.000Z') })).toBe(false);
    expect(verifySessionToken(`${token}x`, secret, { now })).toBe(false);
  });

  it('odczytuje token wyłącznie z właściwego cookie', () => {
    const token = createSessionToken(secret, { now, nonce: 'fixed' });
    const request = { headers: { cookie: `x=1; ${SESSION_COOKIE}=${encodeURIComponent(token)}` } };
    expect(authenticated(request, { SESSION_SECRET: secret }, { now })).toBe(true);
    expect(parseCookies(request.headers.cookie)).toMatchObject({ x: '1', [SESSION_COOKIE]: token });
  });

  it('porównuje passcode bez skrótów i rozróżnia wartości', () => {
    expect(passcodeMatches('Carlos-2027!', 'Carlos-2027!')).toBe(true);
    expect(passcodeMatches('Carlos-2027', 'Carlos-2027!')).toBe(false);
  });

  it('wymaga jawnie dozwolonego Origin dla zapisu', () => {
    const env = { APP_ORIGIN: 'https://a.example, https://b.example' };
    expect(allowedRequestOrigin({ headers: { origin: 'https://b.example' } }, env)).toBe(true);
    expect(allowedRequestOrigin({ headers: { origin: 'https://evil.example' } }, env)).toBe(false);
    expect(allowedRequestOrigin({ headers: {} }, env)).toBe(false);
  });

  it('raportuje brakujące sekrety konfiguracji', () => {
    expect(serviceConfiguration({})).toEqual({
      configured: false,
      missing: ['APP_PASSCODE', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'],
    });
    expect(serviceConfiguration({
      APP_PASSCODE: 'x', SESSION_SECRET: 'x', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'x',
      GOOGLE_PRIVATE_KEY: 'x', GOOGLE_SHEET_ID: 'x',
    })).toEqual({ configured: true, missing: [] });
  });
});
