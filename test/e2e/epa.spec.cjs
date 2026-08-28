const { expect, test } = require('playwright/test');

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
    'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At',
  ], {
    Date: '2026-08-25', Time: '18:55', Type: 'Bieg', Name: 'Easy base 5–6 km', Distance_km: '6.80',
    Duration_text: '51:39', Pace: '7:36/km', HR_avg: '151', HR_max: '161', RPE: '1', Pain: '0',
    Leg_Fatigue_0_10: '2', Status: 'DONE', Session_ID: '2026-08-25-run-01', HR_Target_Min_bpm: '145',
    HR_Target_Max_bpm: '158', Time_In_Target_s: '2791', Time_Above_Target_s: '141',
    Time_Below_Target_s: '167', HR_Analyzed_Duration_s: '3099',
  }),
  plan: table([
    'Data', 'Dzień', 'Rano', 'Później', 'Cel HR', 'RPE max', 'Status', 'Uwagi', 'Trening', 'Session',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Distance_Target_Min_km', 'Distance_Target_Max_km',
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

test('EPA pokazuje fakty, pełną akademię i nie rysuje braków jako zera', async ({ page }) => {
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
  await expect(page.getByText(/90,1% w celu 145–158 bpm/)).toBeVisible();
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
});
