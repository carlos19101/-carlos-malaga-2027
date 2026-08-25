import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeTcx } from '../src/tcx.js';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('Użycie: node tools/tcx-sanitize.js <źródło.tcx> <cel.tcx>');
  process.exitCode = 1;
} else {
  writeFileSync(destination, sanitizeTcx(readFileSync(source, 'utf8')), 'utf8');
  console.log(`Zapisano oczyszczony fixture: ${destination}`);
}
