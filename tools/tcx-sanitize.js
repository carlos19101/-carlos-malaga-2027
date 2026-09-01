import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeTcx } from '../src/tcx.js';

const [source, destination, ...flags] = process.argv.slice(2);
const preserveDistance = flags.includes('--preserve-distance');
if (!source || !destination) {
  console.error('Użycie: node tools/tcx-sanitize.js <źródło.tcx> <cel.tcx> [--preserve-distance]');
  process.exitCode = 1;
} else {
  writeFileSync(destination, sanitizeTcx(readFileSync(source, 'utf8'), { preserveDistance }), 'utf8');
  console.log(`Zapisano oczyszczony fixture: ${destination}`);
}
