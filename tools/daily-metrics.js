import { computeDailyMetrics } from '../src/dailyMetrics.js';
import { readApplicationTables } from '../api/_lib/googleSheets.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function usage() {
  return 'Użycie: npm run metrics:daily -- [--date YYYY-MM-DD] (wymaga GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY i GOOGLE_SHEET_ID)';
}

function report(result) {
  return {
    state: result.state,
    calibrationDays: result.calibrationDays,
    normalizedDays: result.days.length,
    currentDate: result.current?.date ?? null,
    current: result.current?.values ?? null,
    bridgeSignal: result.bridgeSignal,
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
  const date = option('--date') || new Date();
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) throw new Error(usage());
  const tables = await readApplicationTables();
  const [headers = [], ...values] = tables.raw || [];
  const rows = values.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
  console.log(JSON.stringify(report(computeDailyMetrics(rows, date)), null, 2));
}

main().catch((error) => {
  console.error(`Daily Metrics: ${error.message}`);
  process.exitCode = 1;
});
