# DealHunter AH

Strona (GitHub Pages) do zarabiania golda na aukcjach WoW. Wczytujesz plik SavedVariables ze skanem AH,
a strona liczy lokalnie w przeglądarce (nic nie jest wysyłane na serwer):

- **Flipy do vendora** - kup na AH taniej, niż płaci kupiec.
- **Flipy do profesji** - receptury (składniki od kupców liczone po cenie kupca) i rozbiór (disenchant).
- **Flipy na AH** - aktualna najniższa cena kontra mediana z historii skanów, z trendem.
- **Inwestycje z guidów** - przedmioty polecane w guidach z aktualną ceną i dystansem do typowej ceny.

Wszystko filtrowane po profesji i sortowane po zysku, koszcie i ROI. Zakładka **Strategie** zawiera guide
(własnymi słowami, ze źródłami i oceną ich wiarygodności) dla wszystkich profesji.
Prowizja i depozyt AH są domyślnie wyłączone.

## Tryby gry
Strona główna (`docs/index.html`) wybiera tryb. Dostępny: **TBC Anniversary** (`docs/tbc/`, dane w `docs/data/tbc/`).
**WoW Forever** dojdzie jako drugi tryb (`docs/forever/`, `docs/data/forever/`) po premierze gry.

## Struktura
- `docs/` - strona (statyczna, bez zależności). Źródło dla GitHub Pages: gałąź domyślna, folder `/docs`.
- `docs/js/` - silnik wyceny (`engine.js`), okazje (`opportunities.js`), parser SavedVariables (`luaparse.js`), UI (`app.js`).
- `docs/data/tbc/` - `recipes.json`, `items.json` (DB2 z wago.tools), `vendors.json`, `disenchant.json` (Wowhead),
  `strategies.json` (guide).
- `tools/` - generatory danych:
  - `fetch_wago.py` + `build_data.py` - receptury i przedmioty z tabel DB2 (wago.tools),
  - `build_vendors.py`, `build_disenchant.py` - ceny u kupców i wyniki rozbioru (zakładki Wowheada, z cache'em w `data-raw/`),
  - `build_strategies.py` - strategie i listy przedmiotów z guidów.
- `addon/DealHunterAH/` - addon do gry zbierający ceny z AH do pliku SavedVariables (niesprawdzony w grze).
- `web-tests/` - testy strony: `node --test web-tests/site.test.mjs` (Node 20+).
- `tests/` - testy Pythona (generatory danych) i silnika Lua: `python3 -m unittest discover -s tests` (wymaga `pip install lupa`).

## Ograniczenia danych
- Wyniki rozbioru to średnie z obserwacji graczy na Wowheadzie (nie z tabel serwera).
- Lista przedmiotów u kupców pochodzi z Wowheada; uwzględniane są tylko oferty bez limitu zapasu, płatne samym złotem.
- Wymagana umiejętność receptury to początek jej pomarańczowego zakresu (w danych klienta pole minimalne ma zawsze 1).
