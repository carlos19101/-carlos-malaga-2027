const { expect, test } = require('playwright/test');
const snapshot = () => ({ version: 'carlos.runna-reference.v1', title: 'Przykładowy plan', sourceLabel: 'Dane syntetyczne do testów', capturedOn: '2026-09-23', weeks: [
  {number:3,start:'2026-09-21',totalKm:25,sessions:[{day:0,type:'easy',km:5},{day:2,type:'intervals',km:6},{day:4,type:'tempo',km:5},{day:6,type:'long',km:9}]},
  {number:4,start:'2026-09-28',totalKm:6,sessions:[{day:2,type:'easy',km:6}]},
] });
async function openHub(page) {
  const writes=[], errors=[];
  page.on('request',r=>{ if(r.url().includes('/api/') && r.method()!=='GET') writes.push(r.url()); });
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+02:00'));
  await page.route('**/api/session',r=>r.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data',r=>r.fulfill({json:{ok:true,tables:{feed:[],raw:[],log:[],plan:[]}}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Plan',exact:true}).filter({visible:true}).click();
  return {writes,errors};
}
async function upload(page, data=snapshot()) {
  await page.getByLabel('Plik kopii planu Runna').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
}
test('empty state does not fabricate workouts and importing changes only local storage',async({page})=>{
  const {writes,errors}=await openHub(page);
  await expect(page.getByRole('heading',{name:'Twój plan biegowy ma tutaj swoje miejsce.'})).toBeVisible();
  await upload(page);
  await expect(page.locator('.runna-week-total')).toContainText('25');
  await expect(page.locator('.runna-next')).toContainText('Interwały');
  await expect(page.locator('.runna-calendar .runna-kind-boxing')).toHaveCount(2);
  await expect(page.locator('.runna-source')).toContainText('Bez automatycznej synchronizacji');
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
test('details open and close with keyboard; no invented pace or completion',async({page})=>{
  await openHub(page);await upload(page);
  const opener=page.locator('.runna-next');await opener.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Pełna instrukcja: w Runna');
  await expect(dialog).toContainText('Brak w kopii');
  await expect(dialog).toContainText('Status wykonania nie jest przypisany');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  await page.locator('.runna-calendar .runna-kind-boxing').first().click();
  await expect(page.getByRole('dialog')).toContainText('Godziny planowane, nie zarejestrowany czas');
});
test('invalid replacement preserves previous copy and reload restores it',async({page})=>{
  await openHub(page);await upload(page);
  const broken=snapshot();broken.weeks[0].totalKm=100;await upload(page,broken);
  await expect(page.locator('.runna-error')).toContainText('suma sesji');
  await expect(page.locator('.runna-week-total')).toContainText('25');
  await page.reload();await page.getByRole('button',{name:'Plan',exact:true}).filter({visible:true}).click();
  await expect(page.locator('.runna-week-total')).toContainText('25');
});
test('week navigation, calendar selection and disabling club anchors work',async({page})=>{
  await openHub(page);await upload(page);
  await page.getByRole('button',{name:'Następny tydzień Runna',exact:true}).click();
  await expect(page.locator('.runna-day').first()).toHaveAttribute('aria-label','Plan Runna 2026-09-28');
  await page.getByRole('button',{name:'Wróć do bieżącej daty'}).click();
  await expect(page.locator('.runna-day.is-today')).toContainText('23');
  await page.getByText('Źródło i ustawienia kopii',{exact:true}).click();
  await page.getByRole('checkbox',{name:/Pokaż terminy boksu/}).uncheck();
  await expect(page.locator('.runna-kind-boxing')).toHaveCount(0);
  await page.getByRole('button',{name:'Usuń lokalną kopię'}).click();
  await expect(page.locator('.runna-empty')).toBeVisible();
});
for(const width of [320,390,1280])test(`responsive hub at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const {errors}=await openHub(page);await upload(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.locator('.runna-next').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByText('Droga do startu',{exact:false}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  if(width===390)await page.screenshot({path:'test-results/runna-hub-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('confirmed logout clears local Runna copy',async({page})=>{
  await openHub(page);await upload(page);
  await page.route('**/api/session',r=>r.fulfill({json:r.request().method()==='DELETE'?{ok:true}:{ok:true,configured:true,authenticated:true}}));
  await page.getByRole('button',{name:'Wyloguj',exact:true}).filter({visible:true}).click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('carlos:runna-reference:v1'))).toBe(null);
});
