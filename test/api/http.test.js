import { expect, it } from 'vitest';
import { redirect } from '../../api/_lib/strava.js';

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

