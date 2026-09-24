import React from 'react';
import { boxingWeek } from './boxingSchedule.js';
import { RUNNA_TYPES } from './runnaReference.js';
import { formatMetricNumber } from './parse.js';

export function BoxingSchedule({ day, reference }) {
  const slots = boxingWeek(day, reference);
  return <section className="runna-boxing" aria-label="Stały plan boksu">
    <header><span className="eyebrow">STAŁY PLAN · BOKS</span><h2>Wtorek i czwartek</h2><p>20:00–22:00 · Europe/Warsaw</p></header>
    <div className="runna-boxing-slots">{slots.map(slot => <article key={slot.id}>
      <strong>{slot.weekday === 2 ? 'Wtorek' : 'Czwartek'} · {slot.date.slice(8)}.{slot.date.slice(5,7)}</strong>
      <span>{slot.start}–{slot.end} · termin planowany</span>
      <p>{slot.run ? `Tego dnia także Runna: ${RUNNA_TYPES[slot.run.type]}, ${formatMetricNumber(slot.run.km, { maximumFractionDigits: 2 })} km. Godzina biegu nie jest znana — sprawdź układ dnia. Nie przesuwamy sesji automatycznie.` : slot.runningKnown ? 'Brak biegu na ten dzień w zapisanej kopii Runny.' : 'Brak kopii Runny na ten tydzień. Termin boksu pozostaje zapisany.'}</p>
    </article>)}</div>
    <small>Stały termin nie oznacza wykonania ani 120 minut obciążenia. Rzeczywisty czas i feedback pochodzą z zapisanej aktywności.</small>
  </section>;
}
