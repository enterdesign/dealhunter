# DealHunter AH

Strona (GitHub Pages) do liczenia opłacalności przedmiotów i receptur z aukcji WoW (TBC Anniversary,
docelowo Classic / Forever): vendor / disenchant / AH, najniższa / mediana / średnia, trend cen.
Dane wczytujesz z własnego pliku SavedVariables - wszystko liczy się lokalnie w przeglądarce,
nic nie jest wysyłane na serwer. Prowizja i depozyt AH są na razie wyłączone.

- `docs/` - strona (statyczna, bez zależności). Źródło dla GitHub Pages: gałąź domyślna, folder `/docs`.
  - `docs/data/recipes.json`, `docs/data/items.json` - receptury i katalog przedmiotów, generowane z tabel DB2 (wago.tools).
- `tools/` - `fetch_wago.py` pobiera tabele CSV do `data-raw/`, `build_data.py` generuje `docs/data/*.json`.
  Odświeżenie: `python3 tools/fetch_wago.py && python3 tools/build_data.py --raw data-raw/<build>`.
- `web-tests/` - testy logiki strony: `node --test web-tests/site.test.mjs` (Node 20+).
- `addon/DealHunterAH/` - addon do gry zbierający ceny z AH do pliku SavedVariables (niesprawdzony w grze).
- `tests/` - testy silnika w Lua: `python3 -m unittest discover -s tests` (wymaga `pip install lupa`).

Format `docs/data/recipes.json`:
`[{ "id": 3979, "name": "...", "profession": "Engineering", "skill": 200, "grey": 220, "produces": 4357, "qty": 1,
   "reagents": [{ "item": 2589, "count": 1 }] }]`
(`id` = numer czaru receptury, `produces` = id przedmiotu, `skill` = początek pomarańczowego zakresu).
Brak w danych klienta: wyniki rozbioru (disenchant) i lista przedmiotów sprzedawanych przez kupców.
