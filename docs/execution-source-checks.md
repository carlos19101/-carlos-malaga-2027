# Wspólna kontrola źródeł Execution

Dashboard, EPA, podsumowanie tygodnia oraz dziennik decyzji korzystają z
`executionForLogRow` z `src/sessionExecution.js`.

- Jeden wpis Planu na datę sesji pozwala sprawdzić cel. Przy kilku wpisach
  dopasowanie jest niejednoznaczne: aplikacja nie wybiera pierwszego wiersza.
- Nieprawidłowy zapis celu wskazuje źródło: Plan albo Training Log.
- Dwa różne poprawne cele blokują ocenę do wyjaśnienia. Zapisanych czasów
  atomowych nie można przypisać wstecz do innego celu.
- Brak TCX jest odrębny od konfliktu Planu. Zapisana sesja zachowuje dystans
  i pozostałe fakty również wtedy, gdy ocena Execution jest wstrzymana.
- Różnica statusu APP_FEED i Raw_Data nadal blokuje pewną decyzję.
  Jeśli Raw_Data ma nowszy znacznik czasu, alarm podaje potrzebę synchronizacji
  oraz obie godziny. Nie przepisuje statusu ani daty pomiarów.
- EPA odsyła do decyzji w zakładce Dziś, po zastosowaniu kontroli źródeł,
  świeżości i regeneracji. Nie prezentuje surowego tekstu APP_FEED jako
  aktualnego werdyktu silnika.

## Granice automatycznej naprawy

Przy kilku różnych celach sesji potrzebne jest potwierdzenie właściwego
kontraktu. Zmiana kolejności wierszy ani wybór celu najlepiej pasującego do
wykonania nie rozstrzygają, co było zaplanowane. Nie modyfikujemy historycznego
planu na podstawie samego wyniku biegu. Brakujących czasów HR nie wyliczamy
ze średniego tętna ani z opisu sesji.
