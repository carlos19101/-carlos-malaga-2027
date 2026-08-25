# Idempotentny import TCX do Training Log

Importer tworzy wersjonowaną kopertę z polami atomowymi, dopasowuje dokładnie jeden wiersz po `Session_ID` i planuje zapis wyłącznie do bloku:

```text
HR_Target_Min_bpm
HR_Target_Max_bpm
Time_In_Target_s
Time_Above_Target_s
Time_Below_Target_s
HR_Analyzed_Duration_s
```

## Zasady bezpieczeństwa

- brak `Session_ID` nie tworzy nowego wiersza;
- powtórzony `Session_ID` blokuje import;
- identyczne atomy zwracają `noop` i nie generują zapisu;
- inne istniejące atomy zwracają `conflict` i nie są nadpisywane;
- częściowo puste, ale niesprzeczne atomy mogą zostać uzupełnione;
- zapis obejmuje jeden dopasowany wiersz i sześć kolumn atomowych;
- źródłowy SHA-256 oraz fingerprint importu są zwracane w wyniku.

## Analiza bez arkusza

```bash
npm run tcx:import -- "bieg.tcx" \
  --session-id "2026-08-23-run-01" \
  --min 150 \
  --max 162
```

## Porównanie z eksportem Training Log

```bash
npm run tcx:import -- "bieg.tcx" \
  --session-id "2026-08-23-run-01" \
  --min 150 \
  --max 162 \
  --training-log "training-log.csv"
```

Można również pobrać publiczny arkusz bezpośrednio przez `--sheet-id`. Dodanie `--grid-id` powoduje wygenerowanie gotowej tablicy `spreadsheets.batchUpdate` dla połączonego Google Sheets.

Gdy istniejący wiersz ma już `HR_Target_Min_bpm` i `HR_Target_Max_bpm`, nie trzeba powtarzać ich w komendzie — importer pobiera je po `Session_ID`. Podanie tylko jednej granicy jest błędem, a jawny cel sprzeczny z istniejącym zostaje zatrzymany jako `conflict`.

```bash
npm run tcx:import -- "bieg.tcx" \
  --session-id "2026-08-23-run-01" \
  --sheet-id "SPREADSHEET_ID" \
  --grid-id "TRAINING_LOG_GRID_ID"
```

CLI jest domyślnie trybem dry-run: sam nie posiada sekretu ani uprawnienia zapisu. Aktualnie wygenerowany `batchUpdate` wykonuje Codex przez połączone Google Sheets. Samodzielne `--apply` wymaga późniejszego, uwierzytelnionego transportu O2/service account.
