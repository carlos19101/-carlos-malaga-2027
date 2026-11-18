const { test, expect } = require('playwright/test');
// Entirely synthetic measurements: tests never access or write the real Sheet.
const morning = date => ({ Date: date, HRV_orthostatic_rMSSD_ms: '60', HR_lying_bpm: '52', HR_standing_bpm: '70', Sleep_min: '465', Wellbeing: 'GOOD', Symptom_Dizziness: 'NO', Symptom_Palpitations: 'NO', Symptom_Chest_Pain: 'NO', Symptom_Illness: 'NO', Checkin_Saved_At: `${date}T07:00:00Z`, RHR_bpm: '49', Sleep_score: '84' });
const run = (date, km, duration) => ({ Date: date, Time: '10:00', Session_ID: `test-run-${date}`, Type: 'Bieg', Name: 'Bieg testowy', Distance: String(km), Duration: duration, Status: 'DONE', RPE: '3', sRPE: '150', HR_avg: '150', HR_max: '165' });
const fixture = { raw: [13,14,15,16,17].map(day => morning(`2026-11-${day}`)), log: [run('2026-10-01',10,'55:00'),run('2026-10-15',10,'53:00'),run('2026-10-28',12,'70:00'),run('2026-11-10',10,'51:00'),run('2026-11-17',14,'82:00')] };
async function open(page, data = fixture, date = '2026-11-17') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { SHEET_CONTRACTS } = await import('../../src/schema.js');
  const names = {feed:'APP_FEED',raw:'Raw_Data',log:'Training Log',plan:'Plan'};
  const tables = Object.fromEntries(Object.entries(names).map(([key,name]) => { const rows=data[key]||[]; const headers=[...new Set([...SHEET_CONTRACTS[name].map(f=>f.label),...rows.flatMap(r=>Object.keys(r))])]; return [key,rows.length ? [headers,...rows.map(r=>headers.map(h=>r[h]??''))] : []]; }));
  const errors=[], writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{ if(r.url().includes('/api/')&&r.method()!=='GET')writes.push(r.url()); });
  await page.clock.setFixedTime(new Date(`${date}T09:00:00+01:00`));
  await page.route('**/api/session',r=>r.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data',r=>r.fulfill({json:{ok:true,tables}}));
  await page.route('**/api/strava/status',r=>r.fulfill({json:{ok:true,configured:true,connected:false}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dziś',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:data.raw?.length ? 'Poznajemy Twoją normę' : 'Zacznij od pomiaru'})).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Visible on every QA screenshot: these are routed test values, never live readings.
  await page.evaluate(() => {
    const label=document.createElement('div');
    label.textContent='PODGLĄD · DANE TESTOWE';
    label.style.cssText='position:fixed;top:0;left:0;right:0;z-index:1000;text-align:center;font:10px sans-serif;background:#26354c;color:white;padding:3px;pointer-events:none';
    document.body.append(label);
  });
  return {errors,writes};
}
test.use({ viewport:{width:390,height:844}, reducedMotion:'reduce', serviceWorkers:'block' });
test('glass Today, Progress and empty states at 390px, without production writes',async({page})=>{
  const {errors,writes}=await open(page);
  await expect(page.locator('.glass-decision')).toContainText('5/7');
  await expect(page.locator('.morning-checkin')).toContainText('60');
  await page.screenshot({path:'test-results/glass-today-390.png',fullPage:true});
  await page.screenshot({path:'test-results/glass-today-viewport-390.png'});
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Postęp'}).click();
  await expect(page.getByRole('heading',{name:'Postęp',exact:true})).toBeVisible();
  await expect(page.locator('.glass-chart-readout')).toContainText('51:00');
  await page.getByRole('button',{name:'Długi bieg',exact:true}).click();
  await expect(page.locator('.glass-chart-readout')).toContainText('14 km');
  await page.locator('.glass-chart-picker button').first().click();
  await expect(page.locator('.glass-chart-readout')).toContainText('10 km');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path:'test-results/glass-progress-390.png',fullPage:true});
  await page.screenshot({path:'test-results/glass-progress-viewport-390.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=390)).toBe(true);
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});
test('empty data never displays a zero score, forecast or false load',async({page})=>{
  const {errors,writes}=await open(page,{});
  await expect(page.locator('.glass-decision .glass-ring')).toContainText('—');
  await expect(page.getByLabel('Liczba godzin snu')).toHaveValue('');
  await page.screenshot({path:'test-results/glass-empty-390.png',fullPage:true});
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Postęp'}).click();
  await expect(page.getByRole('heading',{name:'Jeszcze bez wykresu'})).toBeVisible();
  await expect(page.locator('.glass-gauge strong')).toHaveText('—');
  await expect(page.locator('.chart-line')).toHaveCount(0);
  await page.screenshot({path:'test-results/glass-progress-empty-viewport-390.png'});
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('progress preserves run dates, exact distance and sleep source; fixed nav in viewport',async({page})=>{
  const {errors,writes}=await open(page,{
    raw:[{...morning('2026-11-17'),Sleep_score:'76'},{...morning('2026-11-18'),Sleep_score:'53'}],
    log:[run('2026-11-10',10,'51:00'),run('2026-11-15',15.01,'1:24:34'),run('2026-11-16',7.51,'45:04')],
    plan:[{Data:'2027-02-01',Type:'Bieg',Session:'Przyszły trening testowy'}],
  },'2026-11-18');
  await expect(page.locator('.sync-strip')).toContainText('Ostatnie dane: 18');
  await expect(page.locator('.sync-strip')).not.toContainText('2027');
  const nav=page.getByRole('navigation',{name:'Dolna nawigacja'});
  await nav.getByRole('button',{name:'Postęp'}).click();
  await expect(page.locator('.glass-race-card')).toContainText('Tydzień 1 z 16');
  await expect(page.locator('.glass-race-card')).not.toContainText('numer tygodnia Runny');
  await expect(page.locator('.chart-goal-label')).toHaveText('cel 47:30');
  await page.getByRole('button',{name:'Długi bieg',exact:true}).click();
  // Sunday stays Sunday, not the Monday grouping key. Monday's shorter run is separate.
  const choice=page.locator('.glass-chart-picker button').filter({hasText:'15 lis'});
  await expect(page.locator('.glass-chart-picker button')).toHaveCount(2);
  await choice.click();
  await expect(page.locator('.glass-chart-readout')).toContainText('15,01 km');
  await expect(page.locator('.glass-chart-readout')).toContainText('15 lis');
  await expect(page.locator('.chart-goal-label')).toHaveText('cel 18 km');
  await expect(page.locator('.chart-y-label')).toHaveCount(3);
  expect(await page.locator('.glass-chart').evaluate(el=>el.getBoundingClientRect().height)).toBeCloseTo(180,0);
  expect(await page.locator('.chart-goal').evaluate(el=>getComputedStyle(el).strokeDasharray)).not.toBe('none');
  const chart=page.locator('.glass-progress-chart');
  await chart.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-24));
  await page.screenshot({path:'test-results/glass-progress-chart-viewport-390.png'});
  const recovery=page.locator('.glass-card').filter({has:page.getByRole('heading',{name:'Regeneracja · odczyty'})});
  const sleep=recovery.locator('.glass-metric-grid > div').filter({hasText:'Jakość snu'});
  await expect(sleep).toContainText('53');await expect(sleep).toContainText('18 lis');
  await expect(sleep).not.toContainText('84');
  await recovery.scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/glass-progress-readings-viewport-390.png'});
  for(const y of [0,500,100000]){
    await page.evaluate(y=>window.scrollTo(0,y),y);
    expect(await nav.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
    const box=await nav.boundingBox();
    expect(box.y+box.height).toBeCloseTo(830,0);
  }
  const lastButton=page.getByRole('button',{name:'EPA · analizy historyczne →'});
  const buttonBox=await lastButton.boundingBox(),navBox=await nav.boundingBox();
  expect(buttonBox.y+buttonBox.height).toBeLessThan(navBox.y);
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});
test('existing check-in contract, comma, no default wellbeing and no obscured submit',async({page})=>{
  const {writes}=await open(page,{});
  await page.getByLabel('Liczba godzin snu').fill('6,9');
  await expect(page.getByLabel('Liczba godzin snu')).toHaveValue('6,9');
  await expect(page.getByText('Wybierz samopoczucie',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Dobrze',exact:true}).click();
  await expect(page.getByRole('button',{name:'Dobrze',exact:true})).toHaveAttribute('aria-pressed','true');
  const submit=page.getByRole('button',{name:'Zapisz check-in',exact:true});
  await submit.scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollBy(0,140));
  const button=await submit.boundingBox(), nav=await page.getByRole('navigation',{name:'Dolna nawigacja'}).boundingBox();
  expect(button.y+button.height).toBeLessThan(nav.y);
  expect(await page.locator('main').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(124);
  await page.screenshot({path:'test-results/glass-checkin-390.png'});
  expect(writes).toEqual([]);
});
test('today RPE targets only a recorded session; opening never saves',async({page})=>{
  const {writes,errors}=await open(page);
  await page.locator('.glass-close > summary').click();
  await expect(page.locator('.glass-close')).toContainText('test-run-2026-11-17');
  await expect(page.locator('.glass-close input[type=range]')).toHaveValue('3');
  await page.locator('.glass-close input[type=range]').fill('5');
  await expect(page.locator('.glass-close input[type=range]')).toHaveClass(/tone-yellow/);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});
for(const width of [320,390,1024])test(`responsive and reduced motion ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const {errors}=await open(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await page.locator('.glass-ambient i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  for(const button of await page.locator('.glass-week-grid button').all()){ const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44); }
  expect(errors).toEqual([]);
});

test('glass navigation preserves Runna import, details, archive and weekly evidence',async({page})=>{
  const {errors,writes}=await open(page);
  await page.getByText('Dane Garmina i kontrola spójności',{exact:true}).click();
  await page.getByText('Wykonanie · ostatnie 7 dni',{exact:true}).click();
  await expect(page.locator('.weekly-snapshot-grid')).toBeVisible();
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Tydzień'}).click();
  const copy={version:'carlos.runna-reference.v1',title:'Test plan',sourceLabel:'Synthetic',capturedOn:'2026-11-17',weeks:[{number:1,start:'2026-11-16',totalKm:8,sessions:[{day:2,type:'tempo',km:8}]}]};
  await page.getByLabel('Plik kopii planu Runna').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(copy))});
  await expect(page.getByRole('region',{name:'Stały plan boksu'})).toContainText('Wtorek');
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Dziś',exact:true}).click();
  await expect(page.locator('.glass-day-plan')).toContainText('DZIŚ BOKS');
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Postęp'}).click();
  await page.getByRole('button',{name:'EPA · analizy historyczne →'}).click();
  await expect(page.getByRole('heading',{name:'Jeden plan. Runna.'})).toBeVisible();
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('unknown and duplicate sessions do not become progress',async({page})=>{
  await open(page,{log:[run('2026-11-01',10,'55:00'),run('2026-11-01',10,'55:00'),{...run('2026-11-03',10,'50:00'),Status:'PLANNED'},run('2026-12-01',10,'48:00')]});
  await page.getByRole('navigation',{name:'Dolna nawigacja'}).getByRole('button',{name:'Postęp'}).click();
  await expect(page.locator('.chart-line')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Jeszcze bez wykresu'})).toBeVisible();
});

test('check-in submits the unchanged three-state contract to a mocked endpoint',async({page})=>{
  await open(page,{});
  let sent;
  await page.route('**/api/daily-checkin',async route => { sent=route.request().postDataJSON();await route.fulfill({json:{ok:true,action:'insert'}}); });
  await page.getByLabel('Poranne HRV rMSSD w milisekundach').fill('55,5');
  await page.getByLabel('Tętno leżąc',{exact:true}).fill('58');
  await page.getByLabel('Tętno stojąc',{exact:true}).fill('76');
  await page.getByLabel('Liczba godzin snu').fill('6,9');
  await page.getByRole('button',{name:'Normalnie',exact:true}).click();
  await page.getByRole('button',{name:'Zapisz check-in',exact:true}).click();
  await expect(page.getByText('Zapisano poranny check-in.',{exact:true})).toBeVisible();
  expect(sent).toMatchObject({date:'2026-11-17',wellbeing:'NORMAL',hrvOrthostatic:'55,5',sleepHours:'6,9',symptomsConfirmed:true});
  expect(sent).not.toHaveProperty('soreness');
  expect(sent).not.toHaveProperty('legFatigue');
});
