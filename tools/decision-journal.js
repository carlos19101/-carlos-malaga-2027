import { buildDecisionJournal } from '../src/decisionJournal.js';
import { readApplicationTables } from '../api/_lib/googleSheets.js';
import { sheetContractError } from '../src/schema.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const limit = Number(option('--limit') || 4);
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) throw new Error('Użycie: npm run journal:audit -- [--limit 4] (wymaga GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY i GOOGLE_SHEET_ID)');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit musi być dodatnią liczbą całkowitą.');
  const tables = await readApplicationTables();
  const [headers = [], ...values] = tables.raw || [];
  const rows = values.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
  const contractError = sheetContractError(rows, 'Raw_Data');
  if (contractError) throw new Error(contractError);
  console.log(JSON.stringify(buildDecisionJournal(rows, { limit }), null, 2));
}

main().catch((error) => {
  console.error(`Dziennik decyzji: ${error.message}`);
  process.exitCode = 1;
});
