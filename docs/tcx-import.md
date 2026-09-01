# Idempotentny import TCX do Training Log

Importer tworzy wersjonowaną kopertę z polami atomowymi i dopasowuje dokładnie jeden wiersz po `Session_ID`. Wariant `carlos.tcx-import.v1` dla pojedynczego celu HR zapisuje blok:

```text
HR_Target_Min_bpm
HR_Target_Max_bpm
Time_In_Target_s
Time_Above_Target_s
Time_Below_Target_s
HR_Analyzed_Duration_s
```

Wariant `carlos.tcx-import.v2` dla czasowego celu etapowego, a `carlos.tcx-import.v3` dla dystansowego celu etapowego, zapisują cztery czasy oraz kanoniczne `HR_Target_Stages_JSON`. Nie zapisują jednej pary min/max jako substytutu etapów. Wersja v3 wymaga `DistanceMeters` w TCX i dzieli odstępy na granicach kilometrów liniowo; nie zamienia kilometrów na szacowany czas. Serwer odczytuje Plan dla daty sesji i wymaga dokładnie jednego poprawnego celu etapowego zgodnego z kopertą; brak celu, niejednoznaczność lub różnica blokują zapis.

## Zasady bezpieczeństwa

- brak `Session_ID` nie tworzy nowego wiersza;
- powtórzony `Session_ID` blokuje import;
- identyczne atomy zwracają `noop` i nie generują zapisu;
- inne istniejące atomy zwracają `conflict` i nie są nadpisywane;
- częściowo puste, ale niesprzeczne atomy mogą zostać uzupełnione;
- zapis obejmuje jeden dopasowany wiersz i pola właściwe dla wersji importu;
- gdy `Time` jest puste, importer uzupełnia je rzeczywistą godziną pierwszej próbki TCX w `Europe/Warsaw`; istniejącej godziny nigdy nie nadpisuje;
- źródłowy SHA-256 oraz fingerprint należą do lokalnej koperty importu; nie są zapisywane w arkuszu ani zwracane przez odpowiedź HTTP jako trwały rejestr pochodzenia.

## Import w aplikacji

W zakładce **Log → Importuj bieg**:

1. wybierz sesję z istniejącym `Session_ID` i pojedynczym lub etapowym celem HR; cel etapowy jest pobierany z Planu;
2. wybierz plik `.tcx` do 12 MB;
3. sprawdź podgląd czasu w oknie, ponad i poniżej celu;
4. potwierdź zapis.

TCX jest analizowany lokalnie w przeglądarce. Do `/api/tcx-import` trafia wersjonowana koperta z SHA-256, metodologią, godziną pierwszej poprawnej próbki oraz wartościami właściwymi dla wersji importu, nie surowy plik. Endpoint wymaga sesji HttpOnly i dozwolonego `Origin`. Serwer waliduje sumę czasów, deklarację metodologii, format hasha i kontrakt Training Log; dla etapów dodatkowo sprawdza Plan. Nie analizuje ponownie pliku i nie może potwierdzić jego SHA-256 bez otrzymania oryginału. To walidacja spójności danych, nie niezależny dowód ich pochodzenia.

Execution pokazuje realny procent górnej granicy dystansu, ale nie klasyfikuje śladu GPS jako przekroczenia: status `OVER`/`UNDER` wymaga wyjścia poza cel o więcej niż 2% odpowiednio nad górną lub pod dolną granicą. Tolerancja nie ukrywa wyniku — zmienia tylko werdykt graniczny.

Import sprawdza konflikty w odczytanym stanie arkusza. Google Sheets nie zapewnia tutaj transakcji obejmującej odczyt i zapis; równoczesne importy na wielu instancjach wymagają osobnej kontroli współbieżności przed rozszerzeniem aplikacji na wielu użytkowników.

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
