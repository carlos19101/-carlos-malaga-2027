const { expect, test } = require('playwright/test');

async function routeSession(page, payload, status = 200) {
  await page.route('**/api/session', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, body: '{}' });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

test('nie pokazuje dashboardu ani nie szuka publicznego arkusza bez prywatnej konfiguracji', async ({ page }) => {
  const publicRequests = [];
  page.on('request', (request) => {
    if (/docs\.google\.com|gviz/i.test(request.url())) publicRequests.push(request.url());
  });
  await routeSession(page, { ok: true, configured: false, authenticated: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prywatny endpoint nie jest skonfigurowany' })).toBeVisible();
  await expect(page.getByText('Ta aplikacja nie ma publicznego fallbacku.')).toBeVisible();
  expect(publicRequests).toEqual([]);
});

test('prosi o passcode przed każdym prywatnym odczytem danych', async ({ page }) => {
  let privateDataCalls = 0;
  await routeSession(page, { ok: true, configured: true, authenticated: false });
  await page.route('**/api/data', async (route) => {
    privateDataCalls += 1;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'authentication-required' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prywatny dostęp' })).toBeVisible();
  await expect(page.getByLabel('PASSCODE')).toBeVisible();
  expect(privateDataCalls).toBe(0);
});

test('przy nieznanym stanie endpointu zamyka dostęp zamiast pokazywać starą kopię', async ({ page }) => {
  await routeSession(page, { ok: false, error: 'session-unavailable' }, 503);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nie można sprawdzić sesji' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible();
});
