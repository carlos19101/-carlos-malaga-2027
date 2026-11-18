import React, { useState } from 'react';
import { exactValue, parseNumber, normalize, resolveLogSession } from './parse.js';
import { A } from './schema.js';
import { plannerDay, plannerWeek } from './jointPlanner.js';
import { boxingWeek } from './boxingSchedule.js';
import { RUNNA_TYPES } from './runnaReference.js';

export const glassRead = (row, field) => exactValue(row || {}, A[field] || [], '');
export const glassDay = row => plannerDay(glassRead(row, 'date'));
export const dayDistance = (a, b) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;
export const shortDay = day => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(`${day}T12:00:00Z`));
export function glassNumber(value, digits = 1) {
  const n = parseNumber(value);
  return n === null ? '—' : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(n);
}
export const runningRow = row => ['bieg', 'run', 'running'].includes(normalize(resolveLogSession(row, A.logType)));
// Presentation adapter: omit ambiguous IDs and unfinished/future rows, never fill missing days with zero.
export function completedRows(rows, today) {
  const counts = new Map();
  rows.forEach(row => { const id = glassRead(row, 'logSessionId'); if (id) counts.set(id, (counts.get(id) || 0) + 1); });
  return rows.filter(row => {
    const day = glassDay(row), id = glassRead(row, 'logSessionId');
    return day && day <= today && (!id || counts.get(id) === 1)
      && ['', 'done', 'completed', 'finished', 'wykonany', 'wykonane'].includes(normalize(glassRead(row, 'logStatus')));
  }).sort((a, b) => glassDay(a).localeCompare(glassDay(b)));
}

export function GlassIcon({ name }) {
  const paths = { dashboard: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', plan: 'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 14h2m4 0h2m-8 3h2', progress: 'M4 4v16h16M7 15l4-4 3 2 6-7m-4 0h4v4', log: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1' };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.log} /></svg>;
}
export function GlassCard({ children, className = '', ...props }) {
  return <section className={`glass-card ${className}`} {...props}>{children}</section>;
}
export function GlassRing({ value, label, fraction = null, tone = 'accent', ariaLabel }) {
  const offset = fraction === null ? null : 1 - Math.max(0, Math.min(1, fraction));
  return <div className={`glass-ring tone-${tone}`} role="img" aria-label={ariaLabel || `${value} ${label}`}>
    <svg viewBox="0 0 140 140" aria-hidden="true"><circle className="ring-track" cx="70" cy="70" r="59" />{offset !== null && <circle className="ring-fill" cx="70" cy="70" r="59" pathLength="1" strokeDasharray="1" strokeDashoffset={offset} style={{ '--ring-to': offset }} />}</svg>
    <div><strong>{value}</strong><span>{label}</span></div>
  </div>;
}
export function GlassHeader({ title, now, progress = false }) {
  const day = plannerDay(now), left = Math.max(0, dayDistance(day, '2027-03-07'));
  return <header className="glass-page-heading"><div><p>{progress ? 'TWOJA DROGA · MÁLAGA 2027' : new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' }).format(now)}</p><h1>{title}</h1></div><span className="glass-pill"><i className="pulse-dot" />{left} dni do Málagi</span></header>;
}
export function GlassWeekStrip({ reference, rows = [], now, onOpenPlan }) {
  const today = plannerDay(now), days = plannerWeek(today), [selected, setSelected] = useState(today);
  const club = boxingWeek(today, reference), done = completedRows(rows, today);
  const sessions = reference?.weeks.flatMap(w => w.sessions) || [];
  const known = date => reference?.weeks.some(w => w.start <= date && date <= w.end);
  const selectedRun = sessions.find(s => s.date === selected), selectedBox = club.find(s => s.date === selected);
  return <GlassCard className="glass-week"><div className="glass-section-title"><h2>Ten tydzień</h2><button type="button" onClick={onOpenPlan}>Cały plan ↗</button></div><div className="glass-week-grid">{days.map((date, i) => {
    const run = sessions.find(s => s.date === date), performed = done.some(r => glassDay(r) === date);
    const tone = performed ? 'done' : run && ['tempo', 'intervals', 'time_trial', 'race'].includes(run.type) ? 'hard' : run || club.some(s => s.date === date) ? 'planned' : known(date) ? 'rest' : 'unknown';
    return <button type="button" key={date} aria-pressed={selected === date} aria-label={`${shortDay(date)}${date === today ? ', dziś' : ''}`} className={`${date === today ? 'is-today' : ''} ${selected === date ? 'is-selected' : ''}`} onClick={() => setSelected(date)}><span>{['PN','WT','ŚR','CZW','PT','SB','ND'][i]}</span><b>{Number(date.slice(8))}</b><i className={`week-dot ${tone}`} /></button>;
  })}</div><p className="glass-week-description" aria-live="polite"><b>{shortDay(selected)} · </b>{selectedRun ? `${RUNNA_TYPES[selectedRun.type]} · ${glassNumber(selectedRun.km)} km` : known(selected) ? 'Bez biegu w kopii' : 'Brak kopii Runny'}{selectedBox ? ` · Boks ${selectedBox.start}–${selectedBox.end}` : ''}</p><small>Zielona kropka: zapis aktywności, nie automatyczne potwierdzenie wykonania planu. Żółta: akcent w planie. Szara: wolne w kopii.</small></GlassCard>;
}
