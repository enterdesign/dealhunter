# DealHunter (tier 1 – bez AI w backendzie)

Strona + backend (FastAPI + Playwright). Użytkownik podaje EAN/link, miejsce dostawy i listę
kandydatów (sklep, link, kody). Backend sam wrzuca produkt do koszyka, wpisuje adres, testuje
kody, odczytuje cenę i układa ranking (z dostawą / bez).

Listę kandydatów możesz wygenerować w darmowym czacie AI (przycisk „Kopiuj prompt dla czatu AI”)
– backend nie wywołuje żadnego API AI, więc nie ma kosztów tokenów.

## Uruchomienie
```
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && playwright install chromium
uvicorn app.main:app --reload     # http://127.0.0.1:8000
```
`CHROMIUM_PATH=/ścieżka/do/chrome` pozwala użyć już zainstalowanej przeglądarki.
Przycisk „Wstaw przykład” używa wbudowanego sklepu demo (`/demo-shop`).

## Dodawanie sklepu
Wpis w `app/shops.json` (selektory: add_to_cart, postcode, kod rabatowy, sumy). Sklep bez wpisu
dostaje tylko cenę z JSON-LD i status „niezweryfikowane”. Sklepy z mocną ochroną antybotową mogą
wymagać osobnego adaptera/proxy. Sprawdź regulamin sklepu przed automatyzacją.

## Testy
`CHROMIUM_PATH=... pytest -q`

## Ograniczenia
Zadania są trzymane w pamięci (restart = utrata), max 15 kandydatów na zadanie, 3 równoległe koszyki.
Linki do adresów prywatnych są blokowane (ochrona SSRF).
