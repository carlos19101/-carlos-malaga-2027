import { describe, expect, it } from 'vitest';
import {
  allowedRequestOrigin,
  authenticated,
  createPasscodeVerifier,
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

  it('weryfikuje passcode przez wersjonowany scrypt bez przechowywania sekretu', async () => {
    const passcode = 'Carlos-2027-passcode!';
    const verifier = await createPasscodeVerifier(passcode, { salt: Buffer.alloc(16, 7) });
    expect(verifier).toMatch(/^scrypt-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain(passcode);
    expect(await passcodeMatches(passcode, verifier)).toBe(true);
    expect(await passcodeMatches('Carlos-2027-wrong!', verifier)).toBe(false);
  });

  it('odrzuca uszkodzony weryfikator i niebezpieczną długość passcode', async () => {
    await expect(createPasscodeVerifier('za-krotki')).rejects.toThrow('passcode-must-have-20-to-256-characters');
    expect(await passcodeMatches('Carlos-2027-passcode!', 'scrypt-v1$broken$broken')).toBe(false);
    expect(await passcodeMatches('x'.repeat(257), 'scrypt-v1$broken$broken')).toBe(false);
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
      missing: ['APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'],
    });
    expect(serviceConfiguration({
      APP_PASSCODE_SCRYPT: 'x', SESSION_SECRET: 'x', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'x',
      GOOGLE_PRIVATE_KEY: 'x', GOOGLE_SHEET_ID: 'x',
    })).toEqual({ configured: true, missing: [] });
  });
});
