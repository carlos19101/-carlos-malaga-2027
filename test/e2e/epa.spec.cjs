const { expect, test } = require('playwright/test');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-26T12:00:00+02:00'));
});
test('dashboard i EPA blokują ten sam niejednoznaczny Plan bez utraty dystansu', async ({ page }) => {
  const data = structuredClone(tables);
  data.plan.push([...data.plan[1]]);
  await openEpa(page, data);
  await expect(page.locator('.epa-no-chart')).toContainText('Plan: 2 wpisy dla 2026-08-25');
  await expect(page.locator('.epa-run h2')).toHaveText('6,80 km');
  await expect(page.locator('.epa-execution-track')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pokaż aktualną decyzję', exact: true }).click();
  await expect(page.locator('.dashboard-last-session')).toContainText('Plan: 2 wpisy dla 2026-08-25');
  await expect(page.locator('.dashboard-last-session')).toContainText('6,80 km');
});

test('EPA kieruje do sprawdzonej decyzji i nie powtarza niezgodnego GREEN z feedu', async ({ page }) => {
  const data = structuredClone(tables);
  data.feed[1][data.feed[0].indexOf('Status')] = 'GREEN';
  data.feed[1][data.feed[0].indexOf('Decision')] = 'STARY WERDYKT GREEN — wykonaj trening';
  data.raw[1][data.raw[0].indexOf('Coach_Status')] = 'YELLOW';
  data.raw[1][data.raw[0].indexOf('Timestamp')] = '2026-08-26 20:00';
  await openEpa(page, data);
  await expect(page.locator('.epa-synthesis')).not.toContainText('STARY WERDYKT GREEN');
  await page.getByRole('button', { name: 'Pokaż aktualną decyzję', exact: true }).click();
  await expect(page.locator('.dashboard-compact-hero h1')).toHaveText('BRAK PEWNEJ DECYZJI');
  await expect(page.locator('.verifier-error')).toContainText('STATUS DECYZJI');
  await expect(page.locator('.verifier-error')).toContainText('DECYZJA WYMAGA SYNCHRONIZACJI');
  await expect(page.locator('.verifier-error')).toContainText('2026-08-26 20:00');
});

test('dashboard nie podmienia celu zapisanej analizy celem z Planu', async ({ page }) => {
  const data = structuredClone(tables);
  data.plan[1][data.plan[0].indexOf('HR_Target_Max_bpm')] = '165';
  await openEpa(page, data);
  const message = 'Cel HR w Training Log różni się od Planu';
  await expect(page.locator('.epa-no-chart')).toContainText(message);
  await page.getByRole('button', { name: 'Pokaż aktualną decyzję', exact: true }).click();
  await expect(page.locator('.dashboard-last-session')).toContainText(message);
});

function table(headers, values) {
  return [headers, headers.map((header) => values[header] ?? '')];
}

const tables = {
  feed: table([
    'Date', 'Recovery', 'Readiness', 'Sleep', 'HRV', 'HRV 7d', 'RHR', 'Weight', 'Status', 'Decision',
    'Pain', 'DOMS', 'Fatigue', 'HRmax', 'LT1', 'LT2', 'Threshold Power', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5',
    'Run km 7d', 'Run km 28d', 'Run count 7d', 'sRPE 7d', 'sRPE 28d', 'Last Run Distance',
    'Last Run Pace', 'Last Run HR Avg', 'Last Run HR Max', 'Last Run RPE', 'Phase', 'Goal A', 'Goal B',
    'Goal C', 'Last Synced', 'Weight avg 7d', 'Weight delta 7d', 'Body Battery',
  ], {
    Date: '2026-08-26', Status: 'MODIFY', Decision: 'Kontroluj obciążenie', Phase: 'Base development',
    HRV: '56', RHR: '46', Weight: '89', HRmax: '210', LT1: '169', LT2: '191',
    Z1: '135–150', Z2: '150–166', Z3: '169–180', Z4: '188–193', Z5: '194–210',
    'Last Synced': '2026-08-26 08:00',
  }),
  log: table([
    'Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'Pace', 'HR_avg',
    'HR_max', 'Power_avg', 'Power_max', 'RPE', 'sRPE', 'Pain', 'Garmin_Load', 'TE_Aerobic',
    'TE_Anaerobic', 'Cadence', 'GCT_ms', 'Notes', 'Source', 'Status', 'Session_ID',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Time_In_Target_s', 'Time_Above_Target_s',
    'Time_Below_Target_s', 'HR_Analyzed_Duration_s', 'Leg_Fatigue_0_10', 'Feedback_ID',
    'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At', 'HR_Target_Stages_JSON',
  ], {
    Date: '2026-08-25', Time: '18:55', Type: 'Bieg', Name: 'Easy base 5–6 km', Distance_km: '6.80',
    Duration_text: '51:39', Pace: '7:36/km', HR_avg: '151', HR_max: '161', RPE: '1', Pain: '0',
    Leg_Fatigue_0_10: '2', Status: 'DONE', Session_ID: '2026-08-25-run-01', HR_Target_Min_bpm: '145',
    HR_Target_Max_bpm: '158', Time_In_Target_s: '2791', Time_Above_Target_s: '141',
    Time_Below_Target_s: '167', HR_Analyzed_Duration_s: '3099',
  }),
  plan: table([
    'Data', 'Dzień', 'Rano', 'Później', 'Cel HR', 'RPE max', 'Status', 'Uwagi', 'Trening', 'Session',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Distance_Target_Min_km', 'Distance_Target_Max_km', 'HR_Target_Stages_JSON',
  ], {
    Data: '2026-08-25', Dzień: 'Wtorek', Rano: 'Easy base 5–6 km', Status: 'DONE',
    HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Distance_Target_Min_km: '5', Distance_Target_Max_km: '6',
  }),
  raw: table([
    'Date', 'Timestamp', 'Weight_kg', 'RHR_bpm', 'HRV_night_ms', 'Sleep_min', 'Sleep_score',
    'BodyBattery_gain', 'Readiness_Garmin', 'Pain_0_10', 'DOMS_0_10', 'Fatigue_0_10',
    'Coach_Status', 'Coach_Decision', 'Source', 'BodyBattery_current',
  ], {
    Date: '2026-08-26', Timestamp: '2026-08-26 08:00', Weight_kg: '89', RHR_bpm: '46',
    HRV_night_ms: '56', Coach_Status: 'MODIFY', Coach_Decision: 'Kontroluj obciążenie', Source: 'Garmin',
  }),
};

test('panel zatrzymuje fokus i oddaje go po zamknięciu', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true, configured: true, authenticated: true } }));
  await page.route('**/api/data', route => route.fulfill({ json: { ok: true, transport: 'test', tables } }));
  await page.goto('/');
  const opener = page.locator('.decision-summary-card');
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Zamknij panel' })).toBeFocused();
  for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('button', { name: 'Zamknij panel' }).click();
  await expect(opener).toBeFocused();
});

test('nieudane wylogowanie pokazuje ostrzeżenie i pozwala ponowić żądanie', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/session', route => {
    if (route.request().method() === 'DELETE') {
      attempts += 1;
      return route.fulfill({ status: attempts === 1 ? 503 : 200, json: { ok: attempts > 1 } });
    }
    return route.fulfill({ json: { ok: true, configured: true, authenticated: true } });
  });
  await page.route('**/api/data', route => route.fulfill({ json: { ok: true, transport: 'test', tables } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByText(/Nie potwierdzono wylogowania/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wyloguj', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj', exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('szkic oceny przetrwa odświeżenie danych i przeładowanie strony', async ({ page }) => {
  const draftTables = JSON.parse(JSON.stringify(tables));
  draftTables.log[1][draftTables.log[0].indexOf('RPE')] = '';
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true, configured: true, authenticated: true } }));
  await page.route('**/api/data', route => route.fulfill({ json: { ok: true, transport: 'test', tables: draftTables } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const note = page.locator('.feedback-notes textarea');
  await note.fill('Mój niewysłany szkic');
  await page.getByRole('button', { name: 'Odśwież dane', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Odśwież dane', exact: true })).toBeEnabled();
  await expect(note).toHaveValue('Mój niewysłany szkic');
  await page.reload();
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  await expect(note).toHaveValue('Mój niewysłany szkic');
});

test('odświeżanie i błąd API nie kasują alarmu niezgodności źródeł', async ({ page }) => {
  const mismatchTables = JSON.parse(JSON.stringify(tables));
  mismatchTables.feed[1][mismatchTables.feed[0].indexOf('Run km 7d')] = '999';
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true, configured: true, authenticated: true } }));
  let pendingRefresh;
  let calls = 0;
  await page.route('**/api/data', async route => {
    calls += 1;
    if (calls === 1) await route.fulfill({ json: { ok: true, transport: 'test', tables: mismatchTables } });
    else pendingRefresh = route;
  });
  await page.goto('/');
  const alarm = page.locator('.verifier-error');
  await expect(alarm).toBeVisible();
  const evidence = await alarm.textContent();
  await page.getByRole('button', { name: 'Odśwież dane', exact: true }).click();
  await expect.poll(() => Boolean(pendingRefresh)).toBe(true);
  await expect(alarm).toHaveText(evidence);
  await pendingRefresh.fulfill({ status: 503, json: { ok: false, error: 'unavailable' } });
  await expect(page.getByRole('button', { name: 'Odśwież dane', exact: true })).toBeEnabled();
  await expect(alarm).toHaveText(evidence);
});

for (const [time, expected] of [
  ['18:55', 'WYKONANIE ZAPISANE'],
  ['07:00', 'SESJA PRZED DECYZJĄ — NIE ŁĄCZYMY JEJ Z WERDYKTEM'],
  ['', 'SESJA TEGO SAMEGO DNIA — BRAK GODZINY'],
]) {
  test(`dziennik używa rzeczywistej godziny Training Log: ${time || 'brak'}`, async ({ page }) => {
    const journalTables = JSON.parse(JSON.stringify(tables));
    journalTables.log[1][journalTables.log[0].indexOf('Time')] = time;
    const rawHeaders = journalTables.raw[0];
    const decision = {
      Date: '2026-08-25', Timestamp: '2026-08-25 09:00', Source: 'Head Coach',
      Coach_Status: 'GREEN', Coach_Decision: 'Easy 5–6 km', HRV_night_ms: '60', RHR_bpm: '45',
    };
    journalTables.raw.push(rawHeaders.map((header) => decision[header] ?? ''));
    await page.route('**/api/session', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, authenticated: true }),
    }));
    await page.route('**/api/data', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, transport: 'test', tables: journalTables }),
    }));
    await page.goto('/');
    await page.getByText('Decyzje, wykonanie i reakcje', { exact: true }).click();
    const card = page.locator('.decision-journal-card').filter({ hasText: 'Easy 5–6 km' });
    await expect(card.getByText(expected, { exact: true })).toBeVisible();
    if (time === '18:55') await expect(card.getByText('reakcja następnego dnia: HRV -4 ms · RHR +1 bpm', { exact: true })).toBeVisible();
  });
}

test('EPA pokazuje fakty, pełną akademię i nie rysuje braków jako zera', async ({ page }, testInfo) => {
  await page.route('**/api/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, authenticated: true }),
  }));
  await page.route('**/api/data', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, transport: 'test', tables }),
  }));
  await page.route('**/api/strava/status', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, connected: true }),
  }));
  await page.route('**/api/strava/activities**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, activities: [{
      id: 'run-25', name: 'Evening Run', type: 'Run', sportType: 'Run', startLocal: '2026-08-25T18:55:00',
      distanceMeters: 6800, movingSeconds: 3099, averageHeartRate: 151, maxHeartRate: 161,
    }] }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'EPA', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'EPA', exact: true })).toBeVisible();
  await expect(page.getByText('6,80 km · 51:39 · HR 151/161')).toBeVisible();
  await expect(page.getByText('90,1% w celu · 145–158 bpm', { exact: true })).toBeVisible();
  await page.getByText('Metodyka EPA i case studies', { exact: true }).click();
  await expect(page.locator('.epa-person-grid button')).toHaveCount(10);
  await page.getByRole('button', { name: 'Elite Athletes · 8' }).click();
  await expect(page.locator('.epa-person-grid button')).toHaveCount(8);
  await expect(page.getByText('CASE STUDY · BRAK PARY').first()).toBeVisible();
  await expect(page.getByText(/EPA porządkuje dowody i luki/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('.mobile-nav button').filter({ hasText: 'EPA' }).click();
  await expect(page.getByRole('heading', { name: 'EPA', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('epa-mobile.png'), fullPage: true });
});

async function openEpa(page, data, activities = []) {
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true, configured: true, authenticated: true } }));
  await page.route('**/api/data', route => route.fulfill({ json: { ok: true, transport: 'test', tables: data } }));
  await page.route('**/api/strava/status', route => route.fulfill({ json: { ok: true, configured: true, connected: true } }));
  await page.route('**/api/strava/activities**', route => route.fulfill({ json: { ok: true, activities } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'EPA', exact: true }).first().click();
}

test('EPA nie podstawia starszej Stravy pod nowy bieg bez TCX', async ({ page }) => {
  const data = structuredClone(tables);
  const fields = data.log[0];
  const last = [...data.log[1]];
  const updates = { Date: '2026-08-26', Name: 'Nowy bieg', Session_ID: 'latest', Distance_km: '8.5', HR_Target_Min_bpm: '', HR_Target_Max_bpm: '', Time_In_Target_s: '', Time_Above_Target_s: '', Time_Below_Target_s: '', HR_Analyzed_Duration_s: '' };
  for (const [key, value] of Object.entries(updates)) last[fields.indexOf(key)] = value;
  data.log.push(last);
  await openEpa(page, data, [{ id: 'older', type: 'Run', startLocal: '2026-08-25T18:55:00', distanceMeters: 6800, movingSeconds: 3099 }]);
  await expect(page.locator('.epa-source-audit')).toContainText('brak pewnej pary z ostatnią sesją');
  await expect(page.locator('.epa-run h2')).toHaveText('8,50 km');
  await expect(page.locator('.epa-no-chart')).toContainText('BIEG ZAPISANY');
  await expect(page.locator('.epa-execution-track')).toHaveCount(0);
});

test('EPA pokazuje dokładny test, wiek źródła i różnicę do celu na mobile', async ({ page }) => {
  const data = structuredClone(tables);
  data.log[1][data.log[0].indexOf('Name')] = 'Test 10 km';
  data.log[1][data.log[0].indexOf('Distance_km')] = '10';
  data.log[1][data.log[0].indexOf('Duration_text')] = '45:00';
  await page.setViewportSize({ width: 390, height: 844 });
  await openEpa(page, data);
  await expect(page.locator('.epa-progress-grid')).toContainText('1:39:17');
  await expect(page.locator('.epa-progress-grid')).toContainText('Wiek wyniku: 1 dzień');
  await page.getByText('Wynik źródłowy i różnica do celu', { exact: true }).click();
  await expect(page.locator('.epa-progress-grid')).toContainText('Test 10 km: 10 km w 45:00');
  await expect(page.locator('.epa-progress-grid')).toContainText('+9:17');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('EPA zachowuje puste tygodnie, zakres dat i brak analizy po przerwie', async ({ page }) => {
  const data = structuredClone(tables);
  data.log[1][data.log[0].indexOf('Date')] = '2026-08-01';
  await openEpa(page, data);
  const period = page.locator('.epa-progress-grid article').nth(1);
  await expect(period).toContainText('2026-08-13 — 2026-08-26');
  await expect(period.locator('strong')).toHaveText('0 km');
  await expect(page.locator('.epa-week-empty')).toHaveCount(4);
  const heights = await page.locator('.epa-week-empty i').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height));
  expect(heights.every(height => height === 0)).toBe(true);
});

test('EPA odróżnia konflikt celów od brakującego pliku TCX', async ({ page }) => {
  const data = structuredClone(tables);
  data.plan[1][data.plan[0].indexOf('HR_Target_Max_bpm')] = '162';
  await openEpa(page, data);
  await expect(page.locator('.epa-brief h2')).toHaveText('Dane analizy HR wymagają sprawdzenia');
  await expect(page.locator('.epa-no-chart')).toContainText('BŁĄD ANALIZY HR');
  await expect(page.locator('.epa-execution-track')).toHaveCount(0);
});

test('EPA usuwa poprzedni odczyt Stravy po błędzie odświeżenia', async ({ page }) => {
  await openEpa(page, tables, [{ id: 'run-25', type: 'Run', startLocal: '2026-08-25T18:55:00', distanceMeters: 6800, movingSeconds: 3099, averageHeartRate: 151, maxHeartRate: 161 }]);
  await expect(page.locator('.epa-source-audit')).toContainText('6,80 km · 51:39 · HR 151/161');
  await page.route('**/api/strava/activities**', route => route.fulfill({ status: 503, json: { ok: false } }));
  await page.getByRole('button', { name: 'Odśwież Stravę' }).click();
  await expect(page.locator('.epa-source-audit')).toContainText('Nie udało się odczytać aktywności');
  await expect(page.locator('.epa-source-audit')).not.toContainText('6,80 km · 51:39 · HR 151/161');
  await expect(page.locator('.epa-run h2')).toHaveText('6,80 km');
});
