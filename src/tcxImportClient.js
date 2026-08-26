import { createTcxImport } from './tcxImport.js';

export const MAX_TCX_FILE_BYTES = 12 * 1024 * 1024;

export async function sha256Hex(text, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('SHA-256 nie jest dostępny w tej przeglądarce.');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function prepareTcxImport(tcxText, options = {}, cryptoImpl = globalThis.crypto) {
  const source = String(tcxText ?? '');
  if (!source.trim()) throw new Error('Plik TCX jest pusty.');
  const sourceSha256 = await sha256Hex(source, cryptoImpl);
  return createTcxImport(source, { ...options, sourceSha256 });
}

export function tcxImportPreview(envelope = {}) {
  const atomic = envelope.atomic || {};
  const analyzed = Number(atomic.HR_Analyzed_Duration_s);
  const percent = (value) => analyzed > 0 ? (Number(value) / analyzed) * 100 : null;
  return {
    sessionId: envelope.sessionId,
    targetMin: atomic.HR_Target_Min_bpm,
    targetMax: atomic.HR_Target_Max_bpm,
    analyzedDuration: analyzed,
    timeInTarget: Number(atomic.Time_In_Target_s),
    timeAboveTarget: Number(atomic.Time_Above_Target_s),
    timeBelowTarget: Number(atomic.Time_Below_Target_s),
    pctInTarget: percent(atomic.Time_In_Target_s),
    pctAboveTarget: percent(atomic.Time_Above_Target_s),
    pctBelowTarget: percent(atomic.Time_Below_Target_s),
    diagnostics: envelope.diagnostics || {},
  };
}
