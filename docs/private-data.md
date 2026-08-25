# Prywatny odczyt danych

## Transport

Po kompletnej konfiguracji środowiska aplikacja nie pobiera danych sportowych bezpośrednio z przeglądarki. Globalna sesja HttpOnly odblokowuje `GET /api/data`, a endpoint wykonuje jeden Google Sheets API `values:batchGet` dla:

- `APP_FEED`,
- `Training Log`,
- `Plan`,
- `Raw_Data`.

Odpowiedź ma `Cache-Control: no-store`. Service worker zawsze kieruje `/api/` do sieci. Tabele z Values API przechodzą po stronie klienta przez te same kontrakty nagłówków i dat co dotychczasowy CSV.

## Bezpieczne przełączenie

- `configured:false` — wersja przejściowa zachowuje publiczny odczyt `gviz`, aby wdrożenie kodu nie odcięło działającej aplikacji przed dodaniem sekretów;
- `configured:true` i brak sesji — cały dashboard jest zastąpiony bramką passcode;
- `configured:true` i ważna sesja — jedynym transportem danych jest `/api/data`;
- nieznany stan `/api/session` — aplikacja nie wraca automatycznie do publicznego `gviz`.

Snapshot `localStorage` ma oznaczenie `public` albo `private`. Prywatna sesja nie wczyta starszego publicznego snapshotu. Wylogowanie usuwa snapshot oraz dane z pamięci widoku. Niewysłana kolejka feedbacku pozostaje na urządzeniu, aby nie utracić wpisu offline, ale nie jest pokazywana bez ponownego zalogowania.

## Aktywacja produkcyjna

1. Utwórz Google service account i udostępnij mu konkretny arkusz jako edytor.
2. Ustaw w Vercelu wartości z `.env.example`.
3. Sprawdź, że `/api/session` zwraca `configured:true`.
4. Zaloguj się i porównaj cztery arkusze oraz agregaty Verifiera.
5. Dopiero po pozytywnym smoke-checku zmień Google Sheet z publicznego na `Restricted`.
6. Sprawdź dashboard, odświeżenie, północ, kolejkę offline oraz zapis „Oceń bieg”.

Odebranie publicznego dostępu jest zmianą zewnętrzną i wymaga uprawnień właściciela arkusza. Samo wdrożenie kodu nie wykonuje tego kroku.
