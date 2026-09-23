const { expect, test } = require('playwright/test');

const headers = ['Data','Dzień','Rano','Później','Cel HR','RPE max','Status','Uwagi','HR_Target_Min_bpm','HR_Target_Max_bpm','Distance_Target_Min_km','Distance_Target_Max_km','HR_Target_Stages_JSON'];
const planRow = (date, title, extra={}) => {
  const values = { Data:date, Rano:title, Status:'PLANNED', 'Cel HR':'145–158', 'RPE max':'3',...extra };
  return headers.map((key) => values[key] || '');
};
const initialTables = () => ({feed:[],raw:[],log:[],plan:[headers,
  planRow('2026-09-22','Easy 4–5 km'), planRow('2026-09-23','Siła podstawowa'),
  planRow('2026-09-25','Odpoczynek'), planRow('2026-09-27','Długi bieg — cel z Planu'),
]});

async function openPlanner(page, tables=initialTables()) {
  const writes = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\/api\//.test(request.url()) && request.method() !== 'GET') writes.push(request.url());
  });
  await page.clock.setFixedTime(new Date('2026-09-21T12:00:00+02:00'));
  await page.route('**/api/session', route=>route.fulfill({json:{ok:true,configured:true,authenticated:true}}));
  await page.route('**/api/data', route=>route.fulfill({json:{ok:true,transport:'test',tables}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Plan',exact:true}).filter({visible:true}).click();
  await page.getByText('Plan w arkuszu · układ i propozycje', {exact:true}).click();
  await expect(page.getByRole('heading',{name:'Jeden wspólny tydzień'})).toBeVisible();
  return {writes,errors};
}

test('wspólny tydzień i propozycja działają mobilnie bez zapisu danych', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {writes,errors} = await openPlanner(page);
  const source = page.locator('.joint-day[aria-label="2026-09-22"]');
  await expect(source).toContainText('Easy 4–5 km');
  await expect(source).toContainText('Boks klubowy');
  await source.locator('.joint-running summary').click();
  await source.getByRole('button',{name:'Zaproponuj inny dzień'}).click();
  await expect(page.getByLabel('Propozycja zmiany terminu')).toContainText('Nie zapisano do Planu');
  await expect(page.locator('.joint-day[aria-label="2026-09-21"]')).toContainText('Easy 4–5 km');
  await expect(source).not.toContainText('Easy 4–5 km');
  await page.getByLabel('Dzień propozycji').selectOption('2026-09-26');
  await expect(page.locator('.joint-day[aria-label="2026-09-26"]')).toContainText('Easy 4–5 km');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button',{name:'Przywróć widok źródłowy'}).click();
  await expect(source).toContainText('Easy 4–5 km');
  await page.screenshot({path:'test-results/joint-planner-mobile.png',fullPage:true});
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('odświeżenie źródła unieważnia propozycję, nie usuwa zmian w Planie', async ({page})=>{
  const tables = initialTables();
  const {writes,errors} = await openPlanner(page,tables);
  await page.locator('.joint-day[aria-label="2026-09-22"] .joint-running summary').click();
  await page.getByRole('button',{name:'Zaproponuj inny dzień'}).filter({visible:true}).first().click();
  tables.plan[1] = planRow('2026-09-22','Easy 3 km — zmienione w źródle');
  await page.getByRole('button',{name:'Odśwież dane',exact:true}).click();
  await expect(page.getByLabel('Propozycja zmiany terminu')).toHaveCount(0);
  await expect(page.locator('.joint-day[aria-label="2026-09-22"]')).toContainText('Easy 3 km');
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('niejednoznaczny Plan blokuje propozycje, ale zachowuje wszystkie wpisy', async ({page})=>{
  const tables=initialTables();tables.plan.push([...tables.plan[1]]);
  await openPlanner(page,tables);
  await expect(page.locator('.joint-planner')).toContainText('2 wiersze Planu');
  const cards=page.locator('.joint-day[aria-label="2026-09-22"] .joint-running');
  await expect(cards).toHaveCount(2);
  await cards.first().locator('summary').click();
  await expect(cards.first().getByRole('button',{name:'Zaproponuj inny dzień'})).toBeDisabled();
});

test('pusty Plan nie staje się fikcyjnym planem półmaratońskim', async ({page})=>{
  await page.setViewportSize({width:320,height:740});
  await openPlanner(page,{feed:[],raw:[],log:[],plan:[]});
  await expect(page.locator('.joint-planner')).toContainText('Nie generujemy kilometrażu z pustej listy');
  await expect(page.locator('.joint-boxing')).toHaveCount(2);
  await expect(page.locator('.joint-running')).toHaveCount(0);
  await page.getByText('Na czym oprzemy dalszą adaptację?',{exact:true}).click();
  await expect(page.locator('.joint-history')).toContainText('Dystans znanych zapisów: —');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('tygodnie i założenia są dostępne także klawiaturą', async ({page})=>{
  await openPlanner(page);
  await page.getByRole('button',{name:'Następny tydzień',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.joint-day').first()).toHaveAttribute('aria-label','2026-09-28');
  await page.getByRole('button',{name:'Ten tydzień',exact:true}).click();
  await page.getByText('Założenia i granice planowania',{exact:true}).click();
  await page.getByRole('checkbox').uncheck();
  await expect(page.locator('.joint-boxing')).toHaveCount(0);
});
