const {expect,test}=require('playwright/test');
const copy={version:'carlos.runna-reference.v1',title:'Test plan',sourceLabel:'Synthetic',capturedOn:'2026-09-23',weeks:[{number:3,start:'2026-09-21',totalKm:8,sessions:[{day:4,type:'tempo',km:8}]}]};
async function open(page) {
  const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')writes.push(r.url());});
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+02:00'));
  await page.route('**/api/session',r=>r.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data',r=>r.fulfill({json:{ok:true,tables:{feed:[],raw:[],log:[],plan:[]}}}));
  await page.goto('/');
  return {errors,writes};
}
test('current Runna dashboard does not fall back to old decision and keeps data warnings',async({page})=>{
  const {errors,writes}=await open(page);
  await expect(page.getByRole('heading',{name:'SPRAWDŹ RUNNĘ',exact:true})).toBeVisible();
  await expect(page.getByText('Nie potwierdzono kompletnych, aktualnych danych regeneracji.',{exact:true})).toBeVisible();
  await expect(page.getByText('WERDYKT GŁÓWNEGO TRENERA',{exact:true})).toHaveCount(0);
  await page.getByLabel('Plik kopii planu Runna').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(copy))});
  await expect(page.getByRole('heading',{name:'BEZ BIEGU W KOPII',exact:true})).toBeVisible();
  await expect(page.locator('.runna-next')).toContainText('Bieg tempowy');
  await page.locator('.runna-next').click();
  await expect(page.getByRole('dialog')).toContainText('Runna jest źródłem planu biegowego');
  await expect(page.getByRole('dialog')).toContainText('Pełny cel Runny nie jest jeszcze powiązany');
  await page.keyboard.press('Escape');
  await page.getByText('Źródło i ustawienia kopii',{exact:true}).click();
  await page.getByRole('button',{name:'Usuń lokalną kopię'}).click();
  await expect(page.getByRole('heading',{name:'SPRAWDŹ RUNNĘ',exact:true})).toBeVisible();
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});
test('old prescriptions remain archived rather than current',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'EPA',exact:true}).filter({visible:true}).click();
  await expect(page.getByRole('heading',{name:'Jeden plan. Runna.'})).toBeVisible();
  await expect(page.locator('details.joint-source-archive')).not.toHaveAttribute('open','');
  await page.getByRole('button',{name:'Plan',exact:true}).filter({visible:true}).click();
  await expect(page.getByText('Plan w arkuszu · układ i propozycje',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/Poniższy arkusz jest archiwum/)).toBeVisible();
});
for(const width of [320,390])test(`Runna current view at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const {errors}=await open(page);
  await page.getByLabel('Plik kopii planu Runna').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(copy))});
  await expect(page.getByRole('heading',{name:'BEZ BIEGU W KOPII'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  if(width===390)await page.screenshot({path:'test-results/runna-mode-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});
