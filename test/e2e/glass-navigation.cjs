// Only navigation paths changed by the glass redesign; data assertions stay in each test.
async function openArchive(page) {
  await page.getByRole('navigation', { name: 'Dolna nawigacja' }).getByRole('button', { name: 'Postęp', exact: true }).click();
  await page.getByRole('button', { name: 'EPA · analizy historyczne →', exact: true }).click();
}
async function openSourceDetails(page) {
  await page.getByText('Dane Garmina i kontrola spójności', { exact: true }).click();
}
async function openRunnaCopy(page) {
  await page.getByText('Kopia Runny · import i ustawienia', { exact: true }).click();
}
module.exports = { openArchive, openSourceDetails, openRunnaCopy };
