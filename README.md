# DealHunter

Podaj EAN/link, miejsce dostawy i listę ofert (sklep, link, kody). Serwer sprawdza koszyki, testuje
kody, odczytuje cenę z dostawą i układa ranking. Żadnych kosztów API AI – listę kandydatów możesz
wygenerować w darmowym czacie (przycisk „Kopiuj prompt dla czatu AI”).

## `web/` – wersja PHP (lekka, główna)
Działa na zwykłym hostingu PHP 8.1+ z cURL. Bez Composera, bazy, crona i przeglądarki: strona
odpytuje `api.php` po jednej ofercie naraz, więc nie ma długich zadań w tle.

- **Shopify** (`/products/...`): `.js`, `/cart/add.js`, `/cart.js`, `/cart/shipping_rates.json`, `/discount/KOD`.
- **WooCommerce** (`/product/...`): Store API (koszyk, adres, wybór dostawy, kupony).
- Inne sklepy: tylko cena z JSON-LD („niezweryfikowane”).

Uruchomienie lokalnie:
```
DEALHUNTER_ALLOW_LOCAL=1 php -S 127.0.0.1:8000 -t web      # LOCAL=1 pozwala testować atrapy na localhost
php web/tests/run.php                                      # testy (22 asercje)
```
Wdrożenie: wgraj zawartość `web/` na hosting. Bez `DEALHUNTER_ALLOW_LOCAL` serwer blokuje adresy
prywatne (SSRF) i limituje 60 sprawdzeń / 10 min na IP. „Wstaw przykład” używa atrap w `web/mock/`.

**Uwaga:** adaptery zbudowano według dokumentacji API platform i sprawdzono na atrapach – nie na
prawdziwych sklepach. Kody w Shopify często potwierdzają się dopiero w checkoutcie (wtedy status
„niepotwierdzony”), a stawki dostawy (`shipping_rates.json`) bywają wyłączone.

## `python/` – wersja z przeglądarką (Playwright)
Obsługuje dowolny sklep po dopisaniu selektorów w `app/shops.json`, ale wymaga serwera z Chromium.
`cd python && pip install -r requirements.txt && uvicorn app.main:app` (testy: `pytest`).
