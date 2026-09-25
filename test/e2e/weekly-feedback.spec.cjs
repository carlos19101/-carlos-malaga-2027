const {test,expect}=require('playwright/test');
const run = (id,date,name,extra={}) => ({Session_ID:id,Date:date,Time:'10:00',Type:'Bieg',Name:name,Distance:'8',Duration:'60:00',Status:'DONE',...extra});
async function open(page,log){
  const { SHEET_CONTRACTS } = await import('../../src/schema.js');
  const headers = [...new Set(['Pain',...SHEET_CONTRACTS['Training Log'].map(field=>field.label),...log.flatMap(row=>Object.keys(row))])];
  // Use the actual endpoint's values-table contract, not parsed row objects.
  const table = [headers,...log.map(row=>headers.map(h=>row[h]??''))];
  await page.clock.setFixedTime(new Date('2026-09-25T12:00:00+02:00'));
  await page.route('**/api/session',r=>r.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data',r=>r.fulfill({json:{ok:true,tables:{feed:[],raw:[],plan:[],log:table}}}));
  await page.route('**/api/strava/status',r=>r.fulfill({json:{ok:true,configured:true,connected:false}}));
  await page.goto('/');
}
test('weekly view shows partial load, evidence boxing duration and missing RPE on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page,[run('strava-101','2026-09-25','Bieg bez oceny'),run('strava-102','2026-09-24','Bieg z oceną',{RPE:'2',sRPE:'120'}),{Date:'2026-09-23',Type:'Boks',Duration:'1:25:50',RPE:'',sRPE:''}]);
  await page.getByText('Wykonanie · ostatnie 7 dni',{exact:true}).click();
  const summary=page.locator('.weekly-snapshot-grid');
  await expect(summary).toContainText('SUMA CZĘŚCIOWA');
  await expect(summary).toContainText('1/3');
  await expect(summary).toContainText('1 h 26 min');
  await expect(summary).toContainText('120');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('switching between older runs keeps drafts separate and does not write',async({page})=>{
  const writes=[];page.on('request',r=>{if(r.url().includes('/api/')&&r.method()==='POST')writes.push(r.url());});
  await page.setViewportSize({width:390,height:844});
  await open(page,[run('strava-101','2026-09-25','Najnowszy'),run('strava-102','2026-09-24','Starszy')]);
  await page.getByRole('button',{name:'Log',exact:true}).filter({visible:true}).click();
  const select=page.getByRole('combobox',{name:'Bieg do oceny',exact:true});
  const rpe=page.getByRole('spinbutton',{name:/^RPE 1/});
  await expect(select).toHaveValue('strava-101');
  await rpe.fill('3');
  await select.selectOption('strava-102');
  await expect(rpe).toHaveValue('');
  await rpe.fill('5');
  await select.selectOption('strava-101');
  await expect(rpe).toHaveValue('3');
  await select.selectOption('strava-102');
  await expect(rpe).toHaveValue('5');
  expect(writes).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('undated rows do not silently become an empty week',async({page})=>{
  await open(page,[run('strava-101','invalid','Brak daty'),run('strava-102','2026-08-01','Poza oknem')]);
  await page.getByText('Wykonanie · ostatnie 7 dni',{exact:true}).click();
  await expect(page.getByText(/Wiersze bez czytelnej daty: 1/)).toBeVisible();
});
