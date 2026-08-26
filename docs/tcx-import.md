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

## Import w aplikacji

W zakładce **Log → Importuj bieg**:

1. wybierz sesję z istniejącym `Session_ID` i zakresem HR;
2. wybierz plik `.tcx` do 12 MB;
3. sprawdź podgląd czasu w oknie, ponad i poniżej celu;
4. potwierdź zapis.

TCX jest analizowany lokalnie w przeglądarce. Do `/api/tcx-import` trafia wersjonowana koperta z SHA-256, metodologią i sześcioma wartościami atomowymi, nie surowy plik. Endpoint wymaga sesji HttpOnly i dozwolonego `Origin`. Serwer ponownie waliduje sumę czasów, metodologię, hash oraz kontrakt Training Log.

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

Gdy istniejący wiersz ma już `HR_Target_Min_bpm` i `HR_Target_Max_bpm`, nie trzeba powtarzać ich w komendzie — importer pobiera je po `Session_ID`. Podanie tylko jednej granicy jest błędem, a jawny cel sprzeczny z istniejącym zostaje zatrzymany jako `conflict`.

CLI pozostaje lokalnym dry-runem dla pliku TCX i opcjonalnego eksportu CSV. Nie pobiera już Training Log przez publiczny `gviz`, ponieważ produkcyjny arkusz jest `Restricted`. Uwierzytelniony zapis wykonuje aplikacja przez service account.
