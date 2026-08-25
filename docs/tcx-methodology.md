# Metodologia analizy TCX

## Kontrakt obliczeń

- Analizowane są wszystkie okrążenia w kolejności zapisanej w TCX.
- Do analizy trafiają trackpointy mające prawidłowe `Time` i `HeartRateBpm/Value`.
- Czas trackpointa to różnica `Time` między nim a następnym prawidłowym trackpointem.
- Interwał jest klasyfikowany według HR wcześniejszego trackpointa.
- Ostatni trackpoint nie dostaje czasu.
- Odstępy równe zero lub ujemne są pomijane.
- Odstępy dłuższe niż 5 sekund są luką sygnału i nie wchodzą do analizowanego czasu.
- Zakres HR jest domknięty: `HR_Target_Min_bpm <= HR <= HR_Target_Max_bpm`.
- Krótkie okrążenia nie są automatycznie odrzucane.
- Postój z ciągłym próbkowaniem HR nie dłuższym niż 5 sekund jest wliczany.
- `HR_Analyzed_Duration_s` jest czasem pokrytym prawidłowymi interwałami HR. Nie jest ani sumą `TotalTimeSeconds` okrążeń, ani ścisłym czasem ruchu.

Zawsze musi zachodzić:

```text
HR_Analyzed_Duration_s =
  Time_In_Target_s + Time_Above_Target_s + Time_Below_Target_s
```

## Przypadek kontrolny 23.08.2026

Dla celu `150–162 bpm` wersjonowany, oczyszczony fixture zwraca:

```text
Time_In_Target_s:          1169
Time_Above_Target_s:       1376
Time_Below_Target_s:         87
HR_Analyzed_Duration_s:    2632
wykluczone luki:              0
okrążenia:                    9
trackpointy:               2641
odstępy zerowe:               8
```

Fixture zachowuje rozkład próbkowania, kolejność okrążeń i HR. Usunięto GPS, dystans, wysokość, moc, kadencję i inne dane. Prawdziwe daty przesunięto do sztucznej daty bazowej, zachowując odstępy czasu.

```text
SHA-256 pliku źródłowego: AB860110AA046542ECC9FABAC31DB380C561F466B55C42FE3F9B9B0C40A148D1
SHA-256 fixture:          185801DF6CE5B8C619F285F33F9B0EB345813422CF98E8B5C81E9AC2FB0DF2AF
```

## Uruchomienie

```bash
npm run tcx:analyze -- "ścieżka/do/pliku.tcx" --min 150 --max 162
```

Opcjonalna zmiana progu luki:

```bash
npm run tcx:analyze -- "ścieżka/do/pliku.tcx" --min 150 --max 162 --max-gap 5
```

Tworzenie oczyszczonego fixture:

```bash
node tools/tcx-sanitize.js "źródło.tcx" "fixture.tcx"
```

Surowych TCX zawierających trasę nie należy dodawać do publicznego repozytorium.
