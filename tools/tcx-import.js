import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createTcxImport,
  parseTrainingLogCsv,
  reconcileTcxImport,
  resolveTcxTarget,
} from '../src/tcxImport.js';

function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) positional.push(argument);
    else {
      const name = argument.slice(2);
      options[name] = argv[index + 1];
      index += 1;
    }
  }
  return { file: positional[0], options };
}

async function readTrainingLog(options) {
  if (options['training-log']) return readFileSync(options['training-log'], 'utf8');
  if (options['sheet-id']) {
    throw new Error('Arkusz jest Restricted. Użyj importera w aplikacji albo lokalnego --training-log.');
  }
  return null;
}

function usage() {
  return [
    'Użycie:',
    'npm run tcx:import -- <plik.tcx> --session-id <ID> [--min 150 --max 162]',
    '  [--training-log <plik.csv>] [--max-gap 5]',
    'Bez --min/--max cel HR jest pobierany z dopasowanego wiersza Training Log.',
  ].join('\n');
}

async function main() {
  const { file, options } = parseArguments(process.argv.slice(2));
  if (!file || !options['session-id']) throw new Error(usage());
  if ((options.min === undefined) !== (options.max === undefined)) {
    throw new Error('--min i --max muszą wystąpić razem.');
  }

  const trainingLogCsv = await readTrainingLog(options);
  const trainingLog = trainingLogCsv === null ? null : parseTrainingLogCsv(trainingLogCsv);
  let targetMin = options.min;
  let targetMax = options.max;
  let targetResolution = null;
  if (targetMin === undefined) {
    if (trainingLog === null) throw new Error(`${usage()}\nBrak Training Log, z którego można pobrać cel HR.`);
    targetResolution = resolveTcxTarget(trainingLog, options['session-id']);
    if (targetResolution.action !== 'resolved') {
      console.log(JSON.stringify({ targetResolution }, null, 2));
      process.exitCode = 2;
      return;
    }
    targetMin = targetResolution.targetMin;
    targetMax = targetResolution.targetMax;
  }

  const tcxText = readFileSync(file, 'utf8');
  const sourceSha256 = createHash('sha256').update(tcxText).digest('hex');
  const envelope = createTcxImport(tcxText, {
    sessionId: options['session-id'],
    targetMin,
    targetMax,
    sourceSha256,
    ...(options['max-gap'] === undefined ? {} : { maxGapSeconds: options['max-gap'] }),
  });
  if (trainingLogCsv === null) console.log(JSON.stringify({ envelope }, null, 2));
  else {
    const reconciliation = reconcileTcxImport(trainingLog, envelope);
    console.log(JSON.stringify({ targetResolution, envelope, reconciliation }, null, 2));
    if (!['update', 'noop'].includes(reconciliation.action)) process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`TCX import: ${error.message}`);
  process.exitCode = 1;
});
