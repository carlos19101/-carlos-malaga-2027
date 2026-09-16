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

## Cele etapowe

Powyższe zasady dotyczą również celów etapowych. Źródłem etapów przy zapisie jest Plan, a nie domyślny zakres pojedynczego HR.

### Etapy czasowe (`carlos.hr-target-stages.v1`)

Ich zegar to czas od pierwszej poprawnej próbki HR, nie czas ruchu. Interwał przecinający granicę etapu jest dzielony na tej granicy; obie części nadal używają HR wcześniejszej próbki. Luki nie zatrzymują zegara etapów. Czas poza zapisanymi etapami jest raportowany jako `unmappedDuration` i nie wchodzi do sumy czasów w/powyżej/poniżej celu.

### Etapy dystansowe (`carlos.hr-target-stages.v2`)

Granice etapów wyznacza kumulowane `DistanceMeters` od pierwszej dostępnej próbki, nie tempo ani przewidywany czas. Interwał przekraczający granicę kilometrową jest dzielony proporcjonalnie do dystansu; oba fragmenty nadal używają HR wcześniejszej próbki. Interwał bez `DistanceMeters` lub z malejącym dystansem nie jest analizowany i trafia do diagnostyki, zamiast być zgadywany. Postój z niezmienionym dystansem przypisujemy etapowi, w którym rozpoczął się interwał. Czas po ostatniej zaplanowanej granicy jest `unmappedDuration`.

## Odcinki z celem i odcinki obserwowane (v3)

`carlos.hr-target-stages.v3` używa zegara czasu od pierwszej próbki HR,
tak samo jak v1. `mode: "target"` wymaga granicy HR; `mode: "observe"`
wymaga braku granic. Nie zamieniamy braku celu na sztuczny szeroki zakres.
`maxExclusive: true` oznacza HR < max; starsze schematy pozostają domknięte.
Przebieżki i przerwy bez celu HR mogą mieć odrębne odcinki obserwacji.

- `HR_Analyzed_Duration_s` i trzy atomowe czasy dotyczą tylko odcinków
  z zadanym celem HR. Suma trzech czasów nadal równa się mianownikowi.
- `observedDuration` jest pokrytym pomiarem czasem bez oceny celu.
  Nie trafia do licznika, mianownika ani automatycznego werdyktu OVER.
- Dla każdego odcinka zapisujemy czas pokryty pomiarem, minimum, maksimum
  oraz średnią HR ważoną długością interwałów. Nie jest to średnia z próbek.
  Pusty odcinek ma null, a nie HR = 0. Ostatnia próbka bez czasu nie wpływa
  na te statystyki. Granice odcinków nadal dzielą interwały; luki nie
  przesuwają zegara, końcówka po planie pozostaje `unmappedDuration`.
- RPE pozostaje oddzielną oceną odczuć. Nie przeliczamy go na HR.
- Werdykt intensywności dotyczy tylko ocenianych odcinków, nie całkowitego
  kosztu całej sesji. UI jawnie pokazuje zakres oceny i czas obserwacji.

Import ma oddzielny kontrakt `carlos.tcx-import.v4`, aby starszy serwer
odrzucił nieznaną metodologię zamiast zapisać błędne liczby. Pole
`methodology.targetBoundaryMode: "per-stage"` zastępuje w nim globalne
`inclusiveTarget`: granice określa każdy etap, w tym otwarte HR < 150.
Plan zawiera
tylko definicję celu. W istniejącej komórce `HR_Target_Stages_JSON` w Training
Log zapisujemy tę definicję wraz z osobnym obiektem `analysis` w wersji
`carlos.hr-stage-analysis.v1`: SHA-256 TCX, statystyki odcinków oraz czasy
obserwacji, luk i końcówki. Porównanie z Planem dotyczy definicji celu,
nie wyników. Nie dodajemy kolumn ani nie zapisujemy GPS/raw TCX w arkuszu.
Zmiana celu, źródła lub zapisanej analizy wywołuje konflikt, nie nadpisanie.
Zapis odrzuca sprzeczne sumy i statystyki; powtórzenie tego samego importu
jest no-op. Są to kontrole spójności danych, nie kryptograficzny dowód
autentyczności pliku przesłanego przez zalogowanego użytkownika.

## Przypadek kontrolny 23.08.2026 (bez zmiany metodologii)

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
