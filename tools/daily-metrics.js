import { computeDailyMetrics } from '../src/dailyMetrics.js';
import { buildSheetCsvUrl, parseCSV } from '../src/parse.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function usage() {
  return 'Użycie: npm run metrics:daily -- --sheet-id <SPREADSHEET_ID> [--date YYYY-MM-DD]';
}

function report(result) {
  return {
    state: result.state,
    calibrationDays: result.calibrationDays,
    normalizedDays: result.days.length,
    currentDate: result.current?.date ?? null,
    current: result.current?.values ?? null,
    metrics: Object.fromEntries(Object.entries(result.metrics).map(([field, metric]) => [field, {
      baseline: {
        ready: metric.baseline.ready,
        n: metric.baseline.n,
        calibrationDays: metric.baseline.calibrationDays,
        sampleCoverage: metric.baseline.sampleCoverage,
        ...(metric.baseline.ready ? { mean: metric.baseline.mean, sd: metric.baseline.sd } : {}),
      },
      zScore: metric.zScore,
    }])),
    issues: result.issues.map(({ id, severity, date, detail }) => ({ id, severity, date, detail })),
    methodology: result.methodology,
  };
}

async function main() {
  const sheetId = option('--sheet-id');
  const date = option('--date') || new Date();
  if (!sheetId) throw new Error(usage());
  const url = buildSheetCsvUrl(sheetId, 'Raw_Data', Date.now(), 'select A,B,C,D,E,G,H,T');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Nie udało się pobrać Raw_Data: HTTP ${response.status}`);
  const rows = parseCSV(await response.text());
  console.log(JSON.stringify(report(computeDailyMetrics(rows, date)), null, 2));
}

main().catch((error) => {
  console.error(`Daily Metrics: ${error.message}`);
  process.exitCode = 1;
});
