import React, { useEffect, useMemo, useState } from 'react';
import { exactValue } from './parse.js';
import { A } from './schema.js';
import { warsawDate } from './dailyCheckin.js';

const SYMPTOMS = [
  ['dizziness', 'Zawroty głowy'],
  ['palpitations', 'Kołatanie serca'],
  ['chestPain', 'Ból w klatce piersiowej'],
  ['illness', 'Choroba / objawy infekcji'],
];

function yes(value) {
  return ['YES', 'TRUE', 'TAK'].includes(String(value || '').trim().toUpperCase());
}

function fromRaw(row) {
  if (!row) return {
    hrvOrthostatic: '', hrLying: '', hrStanding: '', sleepHours: '', wellbeing: '',
    hrvNight: '', weightKg: '', symptoms: Object.fromEntries(SYMPTOMS.map(([key]) => [key, false])),
  };
  const value = (field) => exactValue(row, A[field] || [], '');
  const sleepMin = Number(String(value('rawSleepMinutes')).replace(',', '.'));
  return {
    hrvOrthostatic: value('rawOrthostaticHrv'),
    hrLying: value('rawHrLying'),
    hrStanding: value('rawHrStanding'),
    sleepHours: Number.isFinite(sleepMin) && sleepMin > 0 ? String(Math.round((sleepMin / 60) * 100) / 100) : '',
    wellbeing: value('rawWellbeing'),
    hrvNight: value('rawHrv'),
    weightKg: value('rawWeight'),
    symptoms: {
      dizziness: yes(value('rawSymptomDizziness')),
      palpitations: yes(value('rawSymptomPalpitations')),
      chestPain: yes(value('rawSymptomChestPain')),
      illness: yes(value('rawSymptomIllness')),
    },
  };
}

export function DailyCheckin({ rows = [], onSubmit }) {
  const [date, setDate] = useState(() => warsawDate());
  const record = useMemo(() => rows.filter((row) => String(exactValue(row, A.date, '')).slice(0, 10) === date).at(-1) || null, [date, rows]);
  const [form, setForm] = useState(() => fromRaw(record));
  const [dirty, setDirty] = useState(false);
  const savedCheckin = Boolean(record && exactValue(record, A.rawCheckinSavedAt, ''));
  const [state, setState] = useState({ busy: false, message: '', error: '', fields: {} });

  useEffect(() => {
    setForm(fromRaw(record));
    setState({ busy: false, message: '', error: '', fields: {} });
    setDirty(false);
  }, [date]);

  useEffect(() => {
    if (!dirty) setForm(fromRaw(record));
  }, [record, dirty]);

  const setField = (key, value) => { setDirty(true); setForm((current) => ({ ...current, [key]: value })); };
  const setSymptom = (key, value) => { setDirty(true); setForm((current) => ({ ...current, symptoms: { ...current.symptoms, [key]: value } })); };
  const delta = form.hrLying !== '' && form.hrStanding !== ''
    ? Number(form.hrStanding) - Number(form.hrLying) : null;

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true, message: '', error: '', fields: {} });
    const result = await onSubmit({
      date,
      hrvOrthostatic: form.hrvOrthostatic,
      hrLying: form.hrLying,
      hrStanding: form.hrStanding,
      sleepHours: form.sleepHours,
      wellbeing: form.wellbeing,
      hrvNight: form.hrvNight,
      weightKg: form.weightKg,
      symptomsConfirmed: true,
      symptoms: form.symptoms,
    });
    if (result?.ok) {
      setState({ busy: false, message: result.action === 'update' ? 'Zaktualizowano check-in z tego dnia.' : 'Zapisano poranny check-in.', error: '', fields: {} });
    } else if (result?.error === 'validation-error') {
      setState({ busy: false, message: '', error: 'Sprawdź oznaczone pola.', fields: result.fields || {} });
    } else if (result?.status === 401 || result?.status === 403) {
      setState({ busy: false, message: '', error: 'Sesja wygasła. Zaloguj się ponownie.', fields: {} });
    } else if (result?.status === 429) {
      setState({ busy: false, message: '', error: `Za dużo prób zapisu. Spróbuj ponownie za ${result.retryAfterSeconds || 600} s.`, fields: {} });
    } else {
      setState({ busy: false, message: '', error: 'Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.', fields: {} });
    }
  }

  return (
    <section className="section-block morning-checkin glass-card" aria-labelledby="morning-checkin-title">
      <div className="compact-section-heading">
        <div><span>PORANNY POMIAR</span><h2 id="morning-checkin-title">Check-in organizmu</h2></div>
        <small>{savedCheckin ? 'zapisano · możesz poprawić' : 'krótki zapis · około 1 min'}</small>
      </div>
      {savedCheckin && <div className="glass-metric-grid">{[['HRV rano', form.hrvOrthostatic, 'ms'], ['Tętno leżąc', form.hrLying, 'bpm'], ['Różnica', delta, 'bpm']].map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value === '' || value == null ? '—' : value}</strong><small>{unit}</small></div>)}</div>}
      <details className="glass-checkin-editor" open={!savedCheckin || undefined}>
      <summary>{savedCheckin ? 'Popraw poranny pomiar' : 'Uzupełnij poranny pomiar'}</summary>
      <form className="morning-checkin-form" onSubmit={submit}>
        <label className="checkin-field checkin-date">Data
          <input type="date" value={date} max={warsawDate()} onChange={(event) => setDate(event.target.value)} required />
          {state.fields.date ? <small className="checkin-error">{state.fields.date}</small> : null}
        </label>
        <div className="checkin-grid">
          <label className="checkin-field">HRV rMSSD · leżąc <span>ms · poranny pomiar</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" placeholder="np. 56" value={form.hrvOrthostatic} onChange={(event) => setField('hrvOrthostatic', event.target.value)} aria-label="Poranne HRV rMSSD w milisekundach" />
            {state.fields.hrvOrthostatic ? <small className="checkin-error">{state.fields.hrvOrthostatic}</small> : null}
          </label>
          <label className="checkin-field">Tętno leżąc <span>bpm · pomiar ortostatyczny</span>
            <input type="number" inputMode="numeric" min="25" max="250" step="1" placeholder="np. 48" value={form.hrLying} onChange={(event) => setField('hrLying', event.target.value)} aria-label="Tętno leżąc" />
            {state.fields.hrLying ? <small className="checkin-error">{state.fields.hrLying}</small> : null}
          </label>
          <label className="checkin-field">Tętno stojąc <span>bpm · po teście</span>
            <input type="number" inputMode="numeric" min="25" max="250" step="1" placeholder="np. 62" value={form.hrStanding} onChange={(event) => setField('hrStanding', event.target.value)} aria-label="Tętno stojąc" />
            {state.fields.hrStanding ? <small className="checkin-error">{state.fields.hrStanding}</small> : null}
          </label>
          <label className="checkin-field">Sen <span>godziny · np. 7,5</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" placeholder="np. 7,5" value={form.sleepHours} onChange={(event) => setField('sleepHours', event.target.value)} aria-label="Liczba godzin snu" />
            {state.fields.sleepHours ? <small className="checkin-error">{state.fields.sleepHours}</small> : null}
          </label>
        </div>
        <div className="checkin-derived" aria-live="polite">Różnica stojąc–leżąc: <strong>{delta === null || !Number.isFinite(delta) ? '—' : `${delta > 0 ? '+' : ''}${delta} bpm`}</strong><small>Wyliczana automatycznie; nie zastępuje żadnego pomiaru.</small></div>
        <label className="checkin-field checkin-feeling">Jak się dziś czujesz?
          <output>{({ GOOD: 'Dobrze', NORMAL: 'Normalnie', BAD: 'Słabo' })[form.wellbeing] || 'Wybierz samopoczucie'}</output>
          <input type="range" min="0" max="2" step="1" value={Math.max(0, ['BAD', 'NORMAL', 'GOOD'].indexOf(form.wellbeing))} aria-valuetext={({ GOOD: 'Dobrze', NORMAL: 'Normalnie', BAD: 'Słabo' })[form.wellbeing] || 'Nie wybrano'} onChange={(event) => setField('wellbeing', ['BAD', 'NORMAL', 'GOOD'][Number(event.target.value)])} />
          {state.fields.wellbeing ? <small className="checkin-error">{state.fields.wellbeing}</small> : null}
        </label>
        <div className="glass-feeling-options" role="group" aria-label="Samopoczucie">{[['BAD','Słabo'],['NORMAL','Normalnie'],['GOOD','Dobrze']].map(([value, label]) => <button type="button" key={value} aria-pressed={form.wellbeing === value} onClick={() => setField('wellbeing', value)}>{label}</button>)}</div>
        <fieldset className="checkin-symptoms">
          <legend>Objawy dziś? Zaznacz tylko te, które występują.</legend>
          <div>{SYMPTOMS.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(form.symptoms[key])} onChange={(event) => setSymptom(key, event.target.checked)} />{label}</label>)}</div>
          {state.fields.symptoms ? <small className="checkin-error">{state.fields.symptoms}</small> : null}
        </fieldset>
        <details className="checkin-optional">
          <summary>Dodatkowe · opcjonalne</summary>
          <div className="checkin-grid">
            <label className="checkin-field">HRV nocne Garmin <span>ms · osobna miara</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" placeholder="—" value={form.hrvNight} onChange={(event) => setField('hrvNight', event.target.value)} />
            {state.fields.hrvNight ? <small className="checkin-error">{state.fields.hrvNight}</small> : null}
            </label>
            <label className="checkin-field">Masa ciała <span>kg</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" placeholder="—" value={form.weightKg} onChange={(event) => setField('weightKg', event.target.value)} />
            {state.fields.weightKg ? <small className="checkin-error">{state.fields.weightKg}</small> : null}
            </label>
          </div>
        </details>
        <div className="checkin-submit-row">
          <small>Puste pole pozostaje puste. Poranne rMSSD i HR leżąc zapisuję oddzielnie od nocnego HRV i historycznego RHR Garmina.</small>
          <button type="submit" disabled={state.busy}>{state.busy ? 'Zapisuję…' : record ? 'Zaktualizuj check-in' : 'Zapisz check-in'}</button>
        </div>
        {state.message ? <p className="checkin-success" role="status">{state.message}</p> : null}
        {state.error ? <p className="checkin-error" role="alert">{state.error}</p> : null}
      </form>
      </details>
    </section>
  );
}
