# EPA: raport progresu v2

## Okres i źródło

Wersja algorytmu: `epa-progress-v2`. Parametr `now` określa lokalny dzień raportu; domyślnie jest to bieżąca data urządzenia. Rodzic aplikacji odświeża widok przy północy, powrocie i odświeżeniu danych. Obliczenia dni kalendarzowych nie zależą od długości doby przy zmianie czasu.

Ostatnie 14 dni to [dziś−13, dziś], poprzednie to [dziś−27, dziś−14]. Data ostatniego biegu nie przesuwa okien. Procent porównania występuje tylko po 28 dniach od pierwszego wpisu, przy dodatnim mianowniku i poprawnych danych obu okien. To dostępność historii, nie dowód jej kompletności. Przerwa bez wpisów oznacza zero zarejestrowanych kilometrów; nie potwierdza dnia OFF.

Raport używa wykonanych biegów Training Log. Puste legacy statusy są akceptowane; przyszłe daty, inne sporty i statusy niewykonane są pomijane i raportowane. Brak dystansu nie usuwa sesji: suma znanych kilometrów jest dolną granicą, oznaczoną ≥. Sprzeczne rekordy z tym samym Session_ID są wykluczane z jawnym błędem; identyczne liczone raz. Różne sesje tego samego dnia pozostają oddzielne.

## Wykres i porównanie easy

Wykres obejmuje maksymalnie 8 kolejnych tygodni poniedziałek–niedziela, łącznie z tygodniami bez wpisów. Pierwszy i bieżący tydzień mogą być niepełne. Wysokości słupków są proporcjonalne do kilometrów; zero ma zerową wysokość. W rozwinięciu są dokładne daty, liczba biegów i braki dystansu.

Trend easy porównuje mediany dwóch rozłącznych grup po 3 sesje. Kandydat wymaga dodatniego dystansu i czasu oraz HR 20–250. Dystans mieści się w ±20%, HR w ±3 bpm względem mediany ostatnich trzech prawidłowych easy. Sesje mieszane opisane jako przebieżki, interwały, progresja, tempo lub test są wyłączone. Pokazujemy konkretne daty i pomiary obu trójek. Różnica tempa co najmniej 5 s/km przy podobnym HR jest wyłącznie sygnałem obserwacyjnym; brak danych o trasie, pogodzie i jakości pomiaru uniemożliwia przypisanie przyczyny zmianie formy.

## Execution i źródła

Zapis biegu, analiza HR i kompletność odczuć są oddzielnymi stanami. Brak TCX nie unieważnia dystansu. Reguła ponad 40% czasu powyżej celu sprawdza trzy ostatnie kolejne easy, nie dowolne trzy w całej historii. Sesja bez poprawnej analizy przerywa potwierdzenie reguły.

`computeExecution` zwraca osobno `intensityStatus` i `volumeStatus`; EPA używa tych wyników, zachowując tolerancję objętości 2% i decyzję sprzed zaokrąglenia procentów. Brak celu objętości ma `volumeStatus: null`.

Plan dobieramy tylko dla jednoznacznego dnia. Wieloznaczny Plan albo różnica pomiędzy zapisanym celem analizy i Planem dają błąd analizy. Sam cel z Planu nie pozwala nadać znaczenia atomowym czasom bez zapisanego celu importu. Przy braku Planu zapisane dane HR nadal można odczytać, lecz nie tworzymy celu dystansu. Zmiana nazw etapów przy tych samych granicach i długościach nie zmienia kontraktu.

Strava jest referencją do dokładnie wybranej sesji. Brak pary, kilka par albo stan `review` nie dostarcza jej wartości do ostatniego biegu. Dystans karty pochodzi z Training Log. Przy dwóch biegach tego samego dnia ostatni wybieramy po godzinie; brak jednoznacznej godziny jest ujawniany. Reakcja następnego dnia wymaga wpisu dokładnie dzień później z HRV lub RHR, nie dowolnego późniejszego feedu.

## Prognoza

Cel 1:30 pozostaje celem. Wstępne przeliczenie półmaratonu: czas próby × (21,0975 / dystans próby)^1,06. Wybieramy najnowszy zakończony test/zawody od 5 km z poprawną datą, czasem i dystansem. Rozpoznanie nazwy jest heurystyką, nie potwierdzeniem maksymalnego wysiłku. Testy sprzętu i przygotowanie do zawodów nie kwalifikują się. Nie używamy średniego tempa zwykłych easy.

Pokazujemy nazwę, datę, wiek i wynik źródła oraz różnicę do celu. Wynik dotyczy próby z podanego dnia, a nie dzisiejszej dyspozycji. Przeliczenie nie zmienia decyzji treningowej. Nie dodajemy arbitralnej pewności procentowej, prognozy z HR średniego ani nowego progu fizjologicznego.

## Weryfikacja

Testy jednostkowe obejmują granice okien, DST, przerwy, brak dystansu, duplikaty, niepoprawne nazwy testów, rozdzielenie celu od prognozy, dobór porównywalnych easy, kolejne przekroczenia, konflikt Plan–TCX i zaokrąglanie granicy tolerancji. Testy przeglądarkowe sprawdzają te stany na mockowanych danych, widok mobile 390 px i brak poziomego przewijania. Żaden test nie zapisuje danych treningowych na produkcji.
