# Wspólny plan: półmaraton + boks — paczka 1

Data prac: 2026-09-21. Status: implementacja lokalna, bez publikacji i bez zapisu do arkusza.

## Co zostało sprawdzone

- GitHub `main`: `2d7e05b630e6f020d83748c95bfeb368c6e6710f` (odczyt konektorem).
- Lokalny `src/main.jsx` przed pracą odpowiadał temu plikowi na GitHubie po normalizacji końców linii.
- Lokalny HEAD repo jest starszy (`819507a`), a drzewo zawiera wcześniejsze niezacommitowane zmiany. Zachowano je. Nie publikować całego drzewa jako tej paczki.
- Baseline lokalny: 483 testy, build PASS. To nie jest niezależny audyt całego bieżącego wdrożenia.

## Zakres dostarczony

1. W zakładce Plan działa wspólny tydzień z datowanych wierszy źródła.
2. Osobno pokazane terminy użytkownika: wtorek i czwartek 20:00–22:00. Nie są dowodami wykonania ani wpisami w arkuszu.
3. Rano/Trening i Później są odrębnymi elementami widoku. Cel HR, RPE i status głównej sesji nie przechodzą na Później.
4. Ostrzeżenia o boksie i innych jednostkach tego samego dnia, odpoczynku z aktywną sesją oraz biegu z akcentem/długim obok boksu. To przegląd kalendarza, nie medyczna ocena bezpieczeństwa ani pomiar zmęczenia.
5. Automatyczna propozycja innego dnia dla istniejącego biegu: wyłącznie w tym samym tygodniu, nie w przeszłości, nie na dniu zawodów, nie na zajętym dniu lub jawnym odpoczynku. Ranking: mniej własnych ostrzeżeń, potem najmniejsza zmiana daty, potem wcześniejsza data. Brak wpisu nie potwierdza dostępności zawodnika.
6. Jedna propozycja naraz; cele, nazwa i oryginalna data zachowane. Nowa propozycja zastępuje poprzedni podgląd, nie kumuluje zmian.
7. Dane niejednoznaczne, duplikaty dat, nieczytelne daty i nieznane typy blokują automatyczne propozycje. Możliwe wykonanie w Training Log też wymaga wyjaśnienia, nie dopasowania na siłę.
8. Zmiana danych/transportu/dnia odrzuca podgląd. Nie ma localStorage, zapisów API ani kolejki zmian planu.
9. Ostatnie 28 dni Training Log opisane jako historia zaobserwowana, nie pełna frekwencja. Pokrycie dystansu jawne; boks nie daje kilometrów, brak nie daje zera. Powtórzone Session_ID ujawniane zamiast zawyżania sumy.
10. Wszystkie źródłowe wpisy i niedatowane pozycje nadal dostępne.

## Czego ta paczka NIE robi

- Nie generuje biegowych dawek, tempa, stref HR, kilometrażu ani wyników startowych.
- Nie implementuje FOUNDATION 01 jako dodatkowych obowiązkowych treningów obok biegów.
- Nie określa gotowości, nie wnioskuje o sparingu z HR, nie automatyzuje progresji siłowej.
- Nie oznacza wykonania po samym terminie boksu ani po zbieżności dat.
- Nie zapisuje, nie publikuje ani nie wysyła treningów na zegarek.
- Nie stanowi pełnego odpowiednika Runny. To pierwszy moduł koordynacji tygodnia.

## Kolejne bramki wdrożenia (bez zgadywania dawek)

1. Potwierdzony profil: realna dostępność na biegi, aktualne biegi i tolerancja, priorytet startu, stałe boksy. Nie dobierać liczby biegów wyłącznie z archiwalnych zapisów.
2. Stabilne identyfikatory PlanSession i wersja planu. Dziennik zatwierdzonych zmian. Serwerowa kontrola rewizji i idempotencja zapisu. Obecny kontrakt dziennych wierszy nie nadaje się do bezpiecznego zapisu dowolnych wielu jednostek bez decyzji o migracji.
3. Zatwierdzona biblioteka biegowych jednostek i ich wariantów; dobór dawki oddzielony od kalendarza. Przegląd reguł sportowych przed włączeniem rekomendacji.
4. Prowadzenie sesji + Evidence + krótki feedback; jawne wiązanie wykonania z konkretną sesją, obsługa korekt i duplikatów.
5. Adaptacja tygodnia na podstawie porównywalnych dowodów. Najpierw rekomendacja z uzasadnieniem i akceptacją, nie samoczynne przepisanie planu.
6. Pilot na rzeczywistym tygodniu, dopiero potem automatyzacja kolejnych bloków. Integracja Garmin/FIT jest osobną pracą, nie obietnicą obecnego importera TCX.

## Weryfikacja tej wersji

- 46 nowych testów reguł; całość 529/529 PASS.
- 5 nowych scenariuszy przeglądarkowych; cała lokalna suite 25/25 PASS.
- Build PASS. Kontrola braku poziomego przewijania strony przy 320 i 390 px.
- Testy przeglądarkowe używają jawnie syntetycznych tabel i atrap endpointów, nie prywatnych danych produkcyjnych.
- Brak POST/PUT/DELETE podczas podglądu; zachowanie celów; brak błędów JS w nowych ścieżkach.
- Lokalne środowisko Windows zawieszało sprzątanie serwera w domyślnym runnerze Playwright. Całą suite uruchomiono z osobną konfiguracją lokalną przeciw już działającemu serwerowi; zakończyła się kodem 0. Konfiguracja repo nie została w tym celu zmieniona.

Nowe pliki: `src/jointPlanner.js`, `src/jointPlanner.test.js`, `src/JointPlanner.jsx`, `src/jointPlanner.css`, `test/e2e/joint-planner.spec.cjs`, ten dokument. Integracja: mały dodatek do `src/main.jsx`. Bez zmian zależności, źródeł danych, autoryzacji lub importera.
