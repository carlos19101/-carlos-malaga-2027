import { describe, expect, it, vi } from 'vitest';
import {
  STRAVA_REQUIRED_SCOPE,
  STRAVA_STATE_COOKIE,
  STRAVA_TOKEN_COOKIE,
  activeStravaCredentials,
  clearStravaTokenCookie,
  createStravaState,
  exchangeStravaCode,
  listStravaActivities,
  normalizeStravaActivity,
  openStravaCredentials,
  sealStravaCredentials,
  stravaAuthorizeUrl,
  stravaConfiguration,
  stravaStateCookie,
  stravaTokenCookie,
  verifyStravaState,
} from '../../api/_lib/strava.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

const env = {
  APP_ORIGIN: 'https://carlos.example',
  STRAVA_CLIENT_ID: '12345',
  STRAVA_CLIENT_SECRET: 'client-secret',
  STRAVA_TOKEN_SECRET: 'token-secret-that-is-long-enough-for-tests',
};

const credentials = {
  refreshToken: 'refresh-token', accessToken: 'access-token', expiresAt: 2_000_000_000,
  athleteId: '99', scope: [STRAVA_REQUIRED_SCOPE],
};

describe('Strava OAuth i prywatny token', () => {
  it('wykrywa wyłącznie brakujące sekrety Stravy', () => {
    expect(stravaConfiguration({})).toEqual({
      configured: false,
      missing: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_TOKEN_SECRET'],
    });
    expect(stravaConfiguration(env)).toEqual({ configured: true, missing: [] });
  });

  it('podpisuje stan OAuth i wiąże go z krótkim cookie callbacku', () => {
    const now = new Date('2026-08-28T10:00:00Z');
    const state = createStravaState(env.STRAVA_TOKEN_SECRET, { now, nonce: 'fixed-nonce-for-a-test' });
    expect(verifyStravaState(state, env.STRAVA_TOKEN_SECRET, { now: new Date('2026-08-28T10:05:00Z') })).toBe(true);
    expect(verifyStravaState(`${state}x`, env.STRAVA_TOKEN_SECRET, { now })).toBe(false);
    expect(verifyStravaState(state, env.STRAVA_TOKEN_SECRET, { now: new Date('2026-08-28T10:10:01Z') })).toBe(false);
    expect(stravaStateCookie(state)).toContain(`${STRAVA_STATE_COOKIE}=`);
    expect(stravaStateCookie(state)).toContain('SameSite=Lax');
  });

  it('szyfruje token w HttpOnly cookie i nie ujawnia go po uszkodzeniu', () => {
    const sealed = sealStravaCredentials(credentials, env.STRAVA_TOKEN_SECRET);
    expect(sealed).not.toContain(credentials.refreshToken);
    expect(openStravaCredentials(sealed, env.STRAVA_TOKEN_SECRET)).toMatchObject(credentials);
    expect(openStravaCredentials(`${sealed}x`, env.STRAVA_TOKEN_SECRET)).toBeNull();
    expect(stravaTokenCookie(credentials, env.STRAVA_TOKEN_SECRET)).toContain(`${STRAVA_TOKEN_COOKIE}=`);
    expect(stravaTokenCookie(credentials, env.STRAVA_TOKEN_SECRET)).toContain('SameSite=Strict');
    expect(clearStravaTokenCookie()).toContain('Max-Age=0');
  });

  it('prosi wyłącznie o odczyt prywatnych aktywności i poprawny callback', () => {
    const url = new URL(stravaAuthorizeUrl(env, 'state-value'));
    expect(url.searchParams.get('client_id')).toBe('12345');
    expect(url.searchParams.get('redirect_uri')).toBe('https://carlos.example/api/strava/callback');
    expect(url.searchParams.get('scope')).toBe(STRAVA_REQUIRED_SCOPE);
  });
});

describe('Strava dane aktywności', () => {
  it('wymienia code na dane tylko przy przyznanym activity:read_all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      refresh_token: 'new-refresh', access_token: 'new-access', expires_at: 2_000_000_000,
      athlete: { id: 42 }, scope: 'read activity:read_all',
    }));
    await expect(exchangeStravaCode('authorization-code', env, fetchImpl)).resolves.toMatchObject({
      athleteId: '42', refreshToken: 'new-refresh', scope: expect.arrayContaining([STRAVA_REQUIRED_SCOPE]),
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://www.strava.com/oauth/token');

    await expect(exchangeStravaCode('authorization-code', env, vi.fn().mockResolvedValue(jsonResponse(200, {
      refresh_token: 'x', access_token: 'y', expires_at: 2_000_000_000, athlete: { id: 1 }, scope: 'activity:read',
    })))).rejects.toThrow('strava-scope-not-granted');
  });

  it('nie odświeża ważnego tokenu oraz filtruje dane do bezpiecznego podsumowania', async () => {
    const now = new Date('2026-08-28T10:00:00Z');
    const valid = { ...credentials, expiresAt: 2_000_000_000 };
    await expect(activeStravaCredentials(valid, env, vi.fn(), { now })).resolves.toMatchObject({ refreshed: false, credentials: valid });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [{
      id: 123, name: 'Poranny bieg', type: 'Run', sport_type: 'Run', start_date: '2026-08-28T06:00:00Z',
      start_date_local: '2026-08-28T08:00:00Z', distance: 6800.5, moving_time: 2500, elapsed_time: 2700,
      average_speed: 2.72, average_heartrate: 151.4, max_heartrate: 161, total_elevation_gain: 41,
      map: { polyline: 'nie-zwracaj' }, description: 'nie-zwracaj',
    }]));
    const result = await listStravaActivities(valid, env, fetchImpl, { now, limit: 10 });
    expect(result).toMatchObject({ refreshed: false, activities: [expect.objectContaining({ id: '123', distanceMeters: 6800.5, averageHeartRate: 151.4 })] });
    expect(result.activities[0]).not.toHaveProperty('map');
    expect(normalizeStravaActivity({})).toBeNull();
  });

  it('zachowuje nowy token także wtedy, gdy odczyt aktywności zawiedzie po odświeżeniu', async () => {
    const expired = { ...credentials, accessToken: 'expired-access', expiresAt: 1 };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        refresh_token: 'rotated-refresh', access_token: 'fresh-access', expires_at: 2_000_000_000,
        athlete: { id: 99 }, scope: STRAVA_REQUIRED_SCOPE,
      }))
      .mockResolvedValueOnce(jsonResponse(503, {}));
    await expect(listStravaActivities(expired, env, fetchImpl, { now: new Date('2026-08-28T10:00:00Z') }))
      .rejects.toMatchObject({ message: 'strava-activities-503', credentials: expect.objectContaining({ refreshToken: 'rotated-refresh' }) });
  });
});
