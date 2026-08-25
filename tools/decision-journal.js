import { buildDecisionJournal } from '../src/decisionJournal.js';
import { buildSheetCsvUrl, parseCSV } from '../src/parse.js';
import { sheetContractError } from '../src/schema.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const sheetId = option('--sheet-id');
  const limit = Number(option('--limit') || 4);
  if (!sheetId) throw new Error('Użycie: npm run journal:audit -- --sheet-id <SPREADSHEET_ID> [--limit 4]');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit musi być dodatnią liczbą całkowitą.');
  const query = 'select A,B,C,D,E,G,H,I,J,O,P,Q,R,S,T,AL';
  const response = await fetch(buildSheetCsvUrl(sheetId, 'Raw_Data', Date.now(), query), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Nie udało się pobrać Raw_Data: HTTP ${response.status}`);
  const rows = parseCSV(await response.text());
  const contractError = sheetContractError(rows, 'Raw_Data');
  if (contractError) throw new Error(contractError);
  console.log(JSON.stringify(buildDecisionJournal(rows, { limit }), null, 2));
}

main().catch((error) => {
  console.error(`Dziennik decyzji: ${error.message}`);
  process.exitCode = 1;
});
