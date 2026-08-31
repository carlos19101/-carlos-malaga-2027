# Strava — połączenie prywatnego odczytu

Integracja korzysta z OAuth Stravy wyłącznie do odczytu podsumowań aktywności. Nie zapisuje automatycznie niczego do `Training Log`, nie pobiera tras ani opisu aktywności i nie wpływa samodzielnie na decyzję treningową.

## Konfiguracja produkcji

1. W [ustawieniach API Stravy](https://www.strava.com/settings/api) ustaw **Authorization Callback Domain** na `carlos-malaga-2027.vercel.app`.
2. W Vercel → **Settings → Environment Variables** dodaj dla środowiska Production:
   - `STRAVA_CLIENT_ID`
   - `STRAVA_CLIENT_SECRET`
   - `STRAVA_TOKEN_SECRET` — losowy sekret o długości co najmniej 32 znaków, inny niż `SESSION_SECRET`.
3. Wykonaj redeploy Production.
4. Zaloguj się passcodem do CARLOS → **Log** → **Aktywności ze Stravy** → **Połącz Stravę** i zaakceptuj dokładnie zakres `activity:read_all`.

`Client Secret`, kod OAuth, access token i refresh token nie trafiają do JavaScriptu aplikacji, repozytorium ani arkusza. Serwer przechowuje odświeżalny token wyłącznie zaszyfrowany w cookie `HttpOnly; Secure; SameSite=Strict`. Token jest odświeżany przez serwer tylko gdy zbliża się jego wygaśnięcie.

## Dwa komputery

Połączenie jest celowo przypisane do przeglądarki, w której autoryzowano Stravę. Na drugim komputerze połącz konto osobno; nie kopiuj cookies ani tokenów między urządzeniami.

## Granice MVP

Panel pokazuje podsumowania: nazwę, lokalny czas startu, typ, dystans, czas ruchu i HR średnie/maksymalne. Oprócz widoku porównawczego istnieje zatwierdzany przez użytkownika import do `Training Log` przez `/api/strava/import`, ograniczony do kategorii `Mobilizacja` i `Siła` oraz RPE 1–10. Serwer sam pobiera wybraną aktywność po ID i nadaje `Session_ID = strava-<activityId>`. Kolejne żądanie dla istniejącej sesji zwraca `noop`; więcej niż jeden taki wpis oznacza konflikt. Jest to sprawdzenie odczytanego stanu, nie transakcyjna gwarancja unikalności przy równoległych żądaniach. Import nie wytwarza atomowych czasów HR.

Panel zestawia aktywność Stravy z `Training Log` wyłącznie po lokalnym dniu, typie i bezpiecznej tolerancji dystansu (maksymalnie 100 m lub 2%). Czas ruchu Stravy jest wyświetlany, ale nie zastępuje czasu całej aktywności z TCX. Wiele sesji tego samego typu jednego dnia, inny dystans albo brak pary oznaczane są jawnie jako wymagające przeglądu.
