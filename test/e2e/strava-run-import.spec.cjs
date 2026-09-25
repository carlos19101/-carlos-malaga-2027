const {test,expect}=require('playwright/test');
const activity={id:'123',name:'Testowy bieg',type:'Run',sportType:'Run',startLocal:'2026-09-25T18:00:00Z',distanceMeters:8000,movingSeconds:3600,elapsedSeconds:3660,averageHeartRate:150,maxHeartRate:170,hasHeartRate:true};
async function open(page){
  await page.clock.setFixedTime(new Date('2026-09-25T12:00:00+02:00'));
  await page.route('**/api/session',r=>r.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data',r=>r.fulfill({json:{ok:true,tables:{feed:[],raw:[],plan:[],log:[]}}}));
  await page.route('**/api/strava/status',r=>r.fulfill({json:{ok:true,configured:true,connected:true}}));
  await page.route('**/api/strava/activities**',r=>r.fulfill({json:{ok:true,activities:[activity]}}));
  await page.goto('/');await page.getByRole('button',{name:'Log',exact:true}).filter({visible:true}).click();
  await page.getByRole('button',{name:'Pobierz ostatnie aktywności',exact:true}).click();
}
test('running import is explicit, has no prefilled RPE and separates elapsed from moving time',async({page})=>{
  const writes=[];await page.setViewportSize({width:390,height:844});await open(page);
  await page.route('**/api/strava/import',r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,action:'append',sessionId:'strava-123'}});});
  await expect(page.getByLabel('RPE (opcjonalnie)',{exact:true})).toHaveValue('');
  await expect(page.locator('.strava-activity')).toContainText('Ruch 60:00 · cały zapis 61:00');
  const cancel=dialog=>dialog.dismiss();page.once('dialog',cancel);
  await page.getByRole('button',{name:'Dodaj do Training Log',exact:true}).click();expect(writes).toEqual([]);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Dodaj do Training Log',exact:true}).click();
  await expect(page.getByText('Aktywność została zapisana w Training Log.',{exact:true})).toBeVisible();
  expect(writes).toEqual([{activityId:'123',category:'Bieg',rpe:null}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('existing-session warning and unknown response do not claim no write happened',async({page})=>{
  await open(page);page.on('dialog',dialog=>dialog.accept());
  await page.route('**/api/strava/import',r=>r.fulfill({status:409,json:{ok:false,action:'possible-duplicate',reason:'W dzienniku istnieje już bieg z tego dnia.'}}));
  await page.getByRole('button',{name:'Dodaj do Training Log',exact:true}).click();
  await expect(page.getByText('W dzienniku istnieje już bieg z tego dnia.',{exact:true})).toBeVisible();
  await page.route('**/api/strava/import',r=>r.abort());
  await page.getByRole('button',{name:'Dodaj do Training Log',exact:true}).click();
  await expect(page.getByText(/odpowiedź mogła zaginąć po zapisie/)).toBeVisible();
});
test('failed Strava refresh removes outdated import buttons',async({page})=>{
  await open(page);await expect(page.getByRole('button',{name:'Dodaj do Training Log',exact:true})).toBeVisible();
  await page.route('**/api/strava/activities**',r=>r.fulfill({status:503,json:{ok:false}}));
  await page.getByRole('button',{name:'Pobierz ostatnie aktywności',exact:true}).click();
  await expect(page.getByRole('button',{name:'Dodaj do Training Log',exact:true})).toHaveCount(0);
});
