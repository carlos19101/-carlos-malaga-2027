# Formularz „Oceń bieg” — zapis i bezpieczeństwo

Formularz aktualizuje wyłącznie istniejącą sesję w `Training Log`, dopasowaną exact-match po `Session_ID`. Nie tworzy niepełnego wiersza, jeśli import Garmin/TCX jeszcze nie dodał sesji.

## Dane

Wymagane są `RPE`, `Pain` i `Leg_Fatigue_0_10` w skali 0–10. Notatka jest opcjonalna i ograniczona do 500 znaków. Serwer przelicza `sRPE = Duration_min × RPE`; bez `Duration_min` pozostawia sRPE puste.

Kolumny ścieżki zapisu są dopisane po dotychczasowym kontrakcie Training Log:

- `Leg_Fatigue_0_10`
- `Feedback_ID`
- `Feedback_Submitted_At`
- `Feedback_Notes`
- `Feedback_Synced_At`

## Idempotencja i kolejka offline

Każda ocena ma `Feedback_ID`. Ponowienie tej samej paczki daje `noop`. Serwer porównuje również `Feedback_Submitted_At`, dlatego starsza paczka nie może nadpisać nowszej oceny. Kolejka przeglądarki zachowuje tylko najnowszą paczkę dla konkretnego `Session_ID`.

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

Warstwa odczytu przełącza się na prywatne `/api/data`, gdy konfiguracja jest kompletna. Do tego czasu `configured:false` zachowuje publiczny `gviz`, aby wdrożenie kodu nie odcięło aplikacji przed dodaniem sekretów. Pełna procedura: [`private-data.md`](private-data.md).

Produkcja jest obecnie skonfigurowana i arkusz ma dostęp `Restricted`; publiczny fallback nie uczestniczy w bieżącym odczycie.
