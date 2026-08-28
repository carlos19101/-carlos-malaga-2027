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

Panel pokazuje jedynie ostatnie podsumowania: nazwę, lokalny czas startu, typ, dystans, czas ruchu i HR średnie/maksymalne. Jest to widok porównawczy. Dopiero kolejny etap może zaproponować import konkretnej aktywności po dopasowaniu jej do `Session_ID` i po Twoim zatwierdzeniu.
