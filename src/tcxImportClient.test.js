import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareTcxImport, sha256Hex, tcxImportPreview } from './tcxImportClient.js';

const fixture = readFileSync(new URL('../test/fixtures/2026-08-23-run-01.sanitized.tcx', import.meta.url), 'utf8');
const progressiveFixture = readFileSync(new URL('../test/fixtures/2026-08-29-progressive.sanitized.tcx', import.meta.url), 'utf8');

describe('przeglądarkowy import TCX', () => {
  it('liczy SHA-256 i buduje identyczne atomy jak analizator regresyjny', async () => {
    const sourceSha256 = await sha256Hex(fixture);
    const envelope = await prepareTcxImport(fixture, {
      sessionId: '2026-08-23-run-01', targetMin: 150, targetMax: 162,
    });
    expect(envelope).toMatchObject({
      sourceSha256,
      atomic: {
        Time_In_Target_s: 1169,
        Time_Above_Target_s: 1376,
        Time_Below_Target_s: 87,
        HR_Analyzed_Duration_s: 2632,
      },
    });
    expect(sourceSha256).toMatch(/^[A-F0-9]{64}$/);
  });

  it('tworzy podgląd procentów bez zgadywania brakującego czasu', async () => {
    const envelope = await prepareTcxImport(fixture, {
      sessionId: '2026-08-23-run-01', targetMin: 150, targetMax: 162,
    });
    expect(tcxImportPreview(envelope)).toMatchObject({
      targetMin: 150,
      targetMax: 162,
      analyzedDuration: 2632,
      pctInTarget: 1169 / 2632 * 100,
      pctAboveTarget: 1376 / 2632 * 100,
      pctBelowTarget: 87 / 2632 * 100,
    });
  });

  it('odrzuca pusty plik przed przygotowaniem importu', async () => {
    await expect(prepareTcxImport('  ', {
      sessionId: '2026-08-23-run-01', targetMin: 150, targetMax: 162,
    })).rejects.toThrow('Plik TCX jest pusty');
  });

  it('pokazuje etapy zamiast zmyślonego pojedynczego zakresu HR', async () => {
    const envelope = await prepareTcxImport(progressiveFixture, {
      sessionId: '2026-08-29-run-01',
      targetStages: JSON.stringify({ schema: 'carlos.hr-target-stages.v1', stages: [
        { name: 'WU', durationSeconds: 600, min: 135, max: 145 },
        { name: 'CD', durationSeconds: 480, max: 150 },
      ] }),
    });
    expect(tcxImportPreview(envelope)).toMatchObject({ targetMode: 'staged', stageCount: 2 });
  });
});
