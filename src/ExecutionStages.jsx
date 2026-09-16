import React from 'react';
import { formatMetricNumber } from './parse';

const number = (value, digits = 1) => formatMetricNumber(value, { maximumFractionDigits: digits, fallback: '—' });
const time = (value) => `${Math.floor(Math.round(value) / 60)}:${String(Math.round(value) % 60).padStart(2, '0')}`;
export const hasObservedStages = (stages = []) => stages.some((stage) => stage.mode === 'observe');
export function stageTargetLabel(stages = []) {
  const observed = stages.filter((stage) => stage.mode === 'observe').length;
  return observed ? `${stages.length - observed} etapy z celem HR · ${observed} obserwacji` : `${stages.length} etapów HR`;
}

export function ExecutionStages({ stages = [], analysis, analyzedDuration }) {
  if (!hasObservedStages(stages)) return null;
  return <section className="execution-stage-scope">
    <p><strong>Procent dotyczy tylko odcinków z celem HR.</strong> Obserwacja HR nie podwyższa ani nie obniża oceny. RPE nie jest składnikiem wyniku.</p>
    {analysis ? <p>Oceniane: {time(analyzedDuration)} · obserwacja HR: {time(analysis.observedDuration)} · poza planem etapów: {time(analysis.unmappedDuration)} · luki: {time(analysis.excludedDuration)}.</p> : <p>Szczegóły pomiaru etapów wymagają importu TCX.</p>}
    <details><summary>HR poszczególnych odcinków</summary>
      {stages.map((stage, i) => {
        const measured = analysis?.results[i];
        const target = stage.mode === 'observe' ? 'Obserwacja HR — bez oceny celu'
          : stage.min === null ? `${stage.maxExclusive ? '<' : '≤'}${stage.max} bpm`
            : stage.max === null ? `≥${stage.min} bpm`
              : stage.maxExclusive ? `${stage.min} ≤ HR < ${stage.max} bpm` : `${stage.min}–${stage.max} bpm`;
        return <article key={i}><strong>{stage.name}</strong><span>{target}</span>
          {measured?.recordedDuration > 0 ? <>
            <span>Pomiar {time(measured.recordedDuration)} · HR średnie {number(measured.hrAvg)} · min {number(measured.hrMin, 0)} · max {number(measured.hrMax, 0)} bpm</span>
            {stage.mode !== 'observe' && measured.analyzedDuration > 0 ? <span>W celu {number(100 * measured.timeInTarget / measured.analyzedDuration)}% ({time(measured.timeInTarget)} / {time(measured.analyzedDuration)})</span> : null}
          </> : <span>Brak pomiaru HR tego odcinka.</span>}
        </article>;
      })}
    </details>
  </section>;
}
