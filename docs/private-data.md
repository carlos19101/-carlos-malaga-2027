# Prywatny odczyt danych

## Transport

Po kompletnej konfiguracji środowiska aplikacja nie pobiera danych sportowych bezpośrednio z przeglądarki. Globalna sesja HttpOnly odblokowuje `GET /api/data`, a endpoint wykonuje jeden Google Sheets API `values:batchGet` dla:

- `APP_FEED`,
- `Training Log`,
- `Plan`,
- `Raw_Data`.

Odpowiedź ma `Cache-Control: no-store`. Service worker zawsze kieruje `/api/` do sieci. Tabele z Values API przechodzą po stronie klienta przez te same kontrakty nagłówków i dat co dotychczasowy CSV.

## Bezpieczne przełączenie

- `configured:false` — aplikacja pozostaje zamknięta i nie pokazuje danych, dopóki prywatny endpoint nie zostanie skonfigurowany;
- `configured:true` i brak sesji — cały dashboard jest zastąpiony bramką passcode;
- `configured:true` i ważna sesja — jedynym transportem danych jest `/api/data`;
- nieznany stan `/api/session` — aplikacja nie wraca automatycznie do publicznego `gviz`.

Snapshot `localStorage` ma wyłącznie oznaczenie `private`; starsze i publiczne kopie są odrzucane. Wylogowanie usuwa snapshot oraz dane z pamięci widoku. Niewysłana kolejka feedbacku pozostaje na urządzeniu, aby nie utracić wpisu offline, ale nie jest pokazywana bez ponownego zalogowania.

## Ochrona logowania

Warstwa aplikacji prowadzi trwały limiter prób niezależnie od WAF: pięć nieudanych prób z jednego klienta w ciągu 15 minut blokuje kolejne logowanie na 15 minut i zwraca `429` z `Retry-After`. Stan trafia do ukrytej zakładki `Auth_Limits` w tym samym prywatnym arkuszu, ale zawiera wyłącznie klucz HMAC adresu klienta, liczniki i znaczniki czasu — nigdy plaintext hasła ani adres IP. Poprawne logowanie zeruje wpis.

WAF Vercela pozostaje zewnętrzną, współdzieloną pierwszą linią ochrony. Nie zastępuje limitera aplikacyjnego i odwrotnie.

## Aktywacja produkcyjna

1. Uruchom `npm run passcode:generate`, zapisz pokazany `PASSCODE` wyłącznie w menedżerze haseł, a do Vercela skopiuj tylko `APP_PASSCODE_SCRYPT`.
2. Utwórz Google service account i udostępnij mu konkretny arkusz jako **edytor** — ta sama tożsamość odczytuje dane i zapisuje „Oceń bieg”.
3. Ustaw w Vercelu wartości z `.env.example`.
4. Ogranicz w Vercel WAF próby logowania dla ścieżki `/api/session` i metody `POST`. Reguła ma zwracać `429`; nie ograniczaj kontrolnego `GET`.
5. Sprawdź, że `/api/session` zwraca `configured:true`.
6. Zaloguj się i porównaj cztery arkusze oraz agregaty Verifiera.
7. Wyślij testową ocenę biegu i potwierdź zapis w `Training Log`.
8. Dopiero po pozytywnym smoke-checku zmień Google Sheet z publicznego na `Restricted`.
9. Sprawdź dashboard, odświeżenie, północ, kolejkę offline, wylogowanie oraz ponowne logowanie.

`APP_PASSCODE_SCRYPT` ma format `scrypt-v1$salt$key`. Plaintextowy passcode nie jest zmienną środowiskową i nie może trafić do repozytorium ani logów wdrożenia. Reguła WAF jest współdzielona przez instancje serverless; nie zastępuj jej licznikiem w pamięci funkcji. Nie zapisuj prób w `Training Log`, `Raw_Data` ani innych zakładkach treningowych.

Odebranie publicznego dostępu jest zmianą zewnętrzną i wymaga uprawnień właściciela arkusza. Samo wdrożenie kodu nie wykonuje tego kroku.

## Stan produkcji

Aktywacja została zakończona: service account ma uprawnienie edytora, prywatny odczyt i idempotentny zapis zostały potwierdzone, arkusz jest `Restricted`, a anonimowy `gviz` zwraca `401`. Lokalny plik JSON z kluczem został usunięty po zapisaniu sekretu w Vercelu.
