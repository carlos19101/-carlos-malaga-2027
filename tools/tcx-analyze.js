import { readFileSync } from 'node:fs';
import { analyzeTcx } from '../src/tcx.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const file = process.argv[2]?.startsWith('--') ? undefined : process.argv[2];
const targetMin = option('--min');
const targetMax = option('--max');
const maxGapSeconds = option('--max-gap');

if (!file || targetMin === undefined || targetMax === undefined) {
  console.error('Użycie: npm run tcx:analyze -- <plik.tcx> --min 150 --max 162 [--max-gap 5]');
  process.exitCode = 1;
} else {
  const result = analyzeTcx(readFileSync(file, 'utf8'), {
    targetMin,
    targetMax,
    ...(maxGapSeconds === undefined ? {} : { maxGapSeconds }),
  });
  console.log(JSON.stringify(result, null, 2));
}
