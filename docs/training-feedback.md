# Formularz „Oceń bieg” — zapis i bezpieczeństwo

Formularz aktualizuje wyłącznie istniejącą sesję w `Training Log`, dopasowaną exact-match po `Session_ID`. Nie tworzy niepełnego wiersza, jeśli import Garmin/TCX jeszcze nie dodał sesji.

## Dane

Wymagane są `RPE` w skali 1–10 oraz `Pain` i `Leg_Fatigue_0_10` w skali 0–10. W ukończonym biegu `RPE = 0` nie jest przyjmowane, ponieważ dawałoby pozorne `sRPE = 0`; `1` oznacza wysiłek bardzo lekki. Notatka jest opcjonalna i ograniczona do 500 znaków. Serwer przelicza `sRPE = Duration_min × RPE`; bez `Duration_min` pozostawia sRPE puste.

Kolumny ścieżki zapisu są dopisane po dotychczasowym kontrakcie Training Log:

- `Leg_Fatigue_0_10`
- `Feedback_ID`
- `Feedback_Submitted_At`
- `Feedback_Notes`
- `Feedback_Synced_At`

## Idempotencja i kolejka offline

Każda ocena ma `Feedback_ID`. Ponowienie tej samej paczki daje `noop`. Serwer porównuje również `Feedback_Submitted_At` z aktualnie odczytanym wierszem i odrzuca starszą paczkę. Kolejka przeglądarki zachowuje tylko najnowszą paczkę dla konkretnego `Session_ID`.

Podczas wysyłania kolejka jest odczytywana ponownie po każdym żądaniu. Potwierdzenie usuwa wyłącznie dokładnie wysłaną wersję (`Session_ID`, `Feedback_ID`, `Feedback_Submitted_At`), nie nowszą korektę ani ocenę dodaną podczas oczekiwania na odpowiedź. Równoległe wywołania synchronizacji w jednej karcie współdzielą jedno zadanie; przeglądarki z Web Locks dodatkowo szeregują synchronizacje między kartami tej samej domeny.

Granica gwarancji: odczyt–porównanie–zapis w Google Sheets nie jest transakcją. Powyższe zabezpieczenia nie gwarantują atomowości równoległych zapisów z wielu urządzeń lub instancji serwera; Web Locks nie obejmuje też wszystkich operacji dodawania do `localStorage`. Wersja wieloużytkownikowa wymaga transakcyjnego zapisu z kontrolą wersji, a nie licznika lub blokady wyłącznie w pamięci funkcji.

Nowe formularze wysyłają pakiet w wersji 2. Stare, lokalnie zapisane pakiety bez wersji z `RPE = 0` są zachowane wyłącznie dla zgodności i nie są przepisywane ani poprawiane automatycznie.

HTTP 404 oznacza, że sesja nie istnieje jeszcze w Training Log — paczka pozostaje w kolejce. Błąd walidacji 400/422 usuwa wadliwą paczkę, a brak sieci, 401/403 i błędy serwera zachowują ją do ponowienia.

## Sesja

Passcode jest wysyłany wyłącznie do `/api/session`. Serwer porównuje go z wersjonowanym weryfikatorem `scrypt`; plaintext nie jest przechowywany w zmiennych środowiskowych. Po poprawnej weryfikacji serwer ustawia podpisane cookie `HttpOnly; Secure; SameSite=Strict` na siedem dni. Endpoint zapisu dodatkowo wymaga dozwolonego nagłówka `Origin`. Passcode ani sekret sesji nie trafiają do bundla frontendowego ani `localStorage`.

## Konfiguracja Vercela

Ustaw zmienne z [`.env.example`](../.env.example) w Production:

- `APP_ORIGIN`
- `APP_PASSCODE_SCRYPT` — wygenerowany przez `npm run passcode:generate`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`

Konto serwisowe musi mieć uprawnienie edytora do konkretnego arkusza. Do chwili kompletnej konfiguracji `/api/session` zwraca `configured:false`, a aplikacja nie pokazuje formularza.

Warstwa odczytu korzysta wyłącznie z prywatnego `/api/data`. Gdy konfiguracja jest niepełna, aplikacja nie pokazuje danych ani nie przełącza się na publiczne źródło. Pełna procedura: [`private-data.md`](private-data.md).

Produkcja jest obecnie skonfigurowana, a arkusz ma dostęp `Restricted`.
