# Centrum sterowania — kopia planu Runna V1

Aktualizacja 24.09: dla nowych biegów obowiązuje [Runna mode](runna-mode-v1.md). Opisana niżej nadrzędność arkusza i propozycje JointPlanner dotyczą wyłącznie trybu historycznego sprzed 24.09; nie są już bieżącą polityką.

Zakładka Plan pokazuje tygodniowy kalendarz biegów z kopii dostarczonej przez użytkownika, stałe terminy boksu i przejście do istniejącego Logu. Pełna instrukcja jednostki nadal znajduje się w Runna. Nie jest to integracja z kontem ani importer FIT/TCX.

## Granice danych

- `runnaReference.js` przyjmuje JSON `carlos.runna-reference.v1`, maksymalnie 100 kB / 60 tygodni, maksymalnie jeden bieg dziennie. Waliduje daty, tygodnie od poniedziałku, numery, typy, dodatnie dystanse i zgodność sum tygodniowych. Nieznane pola są odrzucane.
- Dane użytkownika nie są częścią bundla ani repo. JSON przygotowany z jego zrzutów dostarczamy osobno. W1–2 nie są rekonstruowane z niepełnych materiałów.
- Kopia w localStorage (`carlos:runna-reference:v1`) jest lokalna, niezaszyfrowana jak pozostała pamięć przeglądarki. Chroni ją dostęp do profilu urządzenia. Ekran aplikacji pozostaje za istniejącą bramką dostępu; sam localStorage nie jest sejfem.
- Potwierdzone wylogowanie usuwa kopię. Ponowne wczytanie wymaga zachowania JSON. Nie zmieniamy storage innych danych ani mechanizmu sesji.
- Błędny import lub błąd zapisu zachowuje poprzednią kopię. Użytkownik może jawnie ją usunąć lub zastąpić nowszą.
- Typ, dystans, data i źródło są faktami z kopii. Nie dopisujemy tempa, HR, etapów, daty ukończenia ani automatycznego DONE. Terminy boksu nie są potwierdzonym czasem wykonania.
- Kalendarz używa Europe/Warsaw i dat kalendarzowych. Najbliższa jednostka pochodzi z aktualnej daty niezależnie od przeglądanego tygodnia; karta jest podpisana osobno od sum wybranego tygodnia.
- Obecny Plan w arkuszu pozostaje źródłem celów analizy TCX. Kopia Runna go nie zastępuje. Przed analizą względem celu potrzebne jest jawne przeniesienie i powiązanie celu, poza zakresem tego wydania.
- Dotychczasowy wspólny planner i źródłowe wpisy Planu są zachowane w rozwijanych sekcjach. Nowe UI nie wysyła POST/PUT/DELETE poza istniejącym wylogowaniem.

## Interakcje i dostępność

Porównanie źródeł: nad najbliższą jednostką i w jej panelu pokazujemy wszystkie wpisy Planu na tę datę. Dwa lub więcej wierszy daje jawny stan niejednoznaczności. Jedna data ani zgodny tytuł nie tworzą automatycznego powiązania. Kopia Runny nie jest decyzją dnia i nie zastępuje późniejszej korekty z arkusza. Błąd odczytu/kopia cache blokuje przedstawianie źródła jako aktualnego; brak dopasowania i nieczytelne daty są osobnymi stanami.

Wybór tygodnia, wykres kilometrażu, klikane sesje i panel szczegółów. Na telefonie dni są pionową listą, na szerokim ekranie siedmioma kolumnami. Panel wykorzystuje istniejący DashboardDrawer. Przewidziano focus-visible, Escape, etykiety i reduced-motion. Kolory oznaczają typy treningów, nie ocenę stanu zdrowia.

## Weryfikacja

Testy jednostkowe walidacji, sum, braków, czasu i DST; testy przeglądarkowe importu, błędnej zamiany, nawigacji, szczegółów, wylogowania i szerokości 320/390/1280 px. Dane e2e są syntetyczne. Bez pomiarów medycznych, dostępu do kont Runna i nowych zależności.
