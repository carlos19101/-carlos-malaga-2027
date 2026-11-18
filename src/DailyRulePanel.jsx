import React from 'react';
import { computeDayRule } from './dayRule.js';
import { warsawDate } from './dailyCheckin.js';
import { GlassCard, GlassRing, glassNumber as number } from './glassUi.jsx';

export function DailyRulePanel({ rows = [], now = new Date() }) {
  const rule = computeDayRule(rows, warsawDate(now));
  const tone = ['red', 'yellow', 'green'].includes(rule.status) ? rule.status : 'blue';
  const calibrating = rule.status === 'calibration';
  const known = !['missing', 'incomplete'].includes(rule.status);
  const current = rule.current, base = rule.baseline;
  const titles = { missing: 'Zacznij od pomiaru', calibration: 'Poznajemy Twoją normę', incomplete: 'Uzupełnij pomiar', green: 'Trenuj według planu', yellow: 'Dziś lżej', red: 'Dziś odpoczynek' };
  const signals = [
    { id: 1, title: 'HRV i tętno leżąc', value: current ? `${number(current.hrv)} ms · ${number(current.lying)} bpm` : '—', norm: base ? `Norma ${number(base.hrv)} ms · ${number(base.lying)} bpm` : 'Norma w kalibracji' },
    { id: 2, title: 'Test ortostatyczny', value: current?.delta != null ? `${number(current.delta)} bpm różnicy` : '—', norm: base ? `Norma różnicy ${number(base.delta)} bpm` : 'Norma w kalibracji' },
    { id: 3, title: 'Sen i samopoczucie', value: current ? `${number(current.sleep == null ? null : current.sleep / 60)} h · ${{ GOOD: 'dobrze', NORMAL: 'normalnie', BAD: 'słabo' }[current.wellbeing] || '—'}` : '—', norm: 'Próg reguły: 7 h · samopoczucie słabo' },
  ];
  return <GlassCard className={`glass-decision tone-${tone}`} aria-labelledby="day-rule-title">
    <span className="glass-eyebrow">DECYZJA DNIA · REGUŁA CHECK-INU</span>
    <div className="glass-decision-main"><GlassRing tone={tone} value={calibrating ? `${rule.calibrationDays}/7` : known ? `${rule.triggeredCount}/3` : '—'} label={calibrating ? 'pomiarów' : 'sygnałów'} fraction={calibrating ? rule.calibrationDays / 7 : known ? rule.triggeredCount / 3 : null} /><div><span className="glass-status">{rule.label}</span><h2 id="day-rule-title">{titles[rule.status]}</h2><p>{rule.recommendation}</p></div></div>
    <div className="glass-signals">{signals.map(signal => { const evidence = rule.signals.find(s => s.id === signal.id); return <details key={signal.id} className={`glass-signal ${evidence?.triggered ? 'is-triggered' : ''}`}><summary><span className="signal-title">{signal.title}</span><strong>{signal.value}</strong><small>{signal.norm}</small><span className="signal-track">{evidence && <i className={evidence.triggered ? 'active' : 'clear'} />}</span><em>{evidence ? evidence.triggered ? 'Sygnał ostrzegawczy' : 'Bez sygnału' : 'Brak oceny'} · szczegóły ↓</em></summary><p>{evidence?.detail || 'Brakuje pomiaru lub wystarczającej normy. Nie traktujemy braku jako prawidłowego wyniku.'}</p></details>; })}</div>
    {rule.symptoms.length > 0 && <div className="glass-warning" role="alert">Objawy: {rule.symptoms.join(', ')}. Nie trenuj z niepokojącymi objawami. Silny lub utrzymujący się ból w klatce, duszność lub omdlenie wymagają pilnej pomocy medycznej.</div>}
    {rule.sleepStreak && <p className="glass-warning">Sen poniżej 7 h przez trzy kolejne noce.</p>}
    {calibrating && rule.calibrationDays === 7 && <p>Zebrano 7 pomiarów. Norma będzie dostępna przy kolejnym pomiarze — dzisiejszego nie używamy do oceniania samego siebie.</p>}
    <details className="glass-method"><summary>Jak czytać tę decyzję?</summary><p>Norma: do 14 wcześniejszych ważnych dni, minimum 7. Oceniany dzień nie wchodzi do własnej normy. Paski oznaczają obecność sygnału, nie procent gotowości. Gotowość Garmina nie wpływa na kolor.</p><p>Brakujące dane: {rule.missing.join(', ') || (rule.status === 'missing' ? 'dzisiejszy check-in' : 'brak')}. To reguła pomocnicza, nie diagnoza ani gwarancja bezpieczeństwa.</p></details>
  </GlassCard>;
}
