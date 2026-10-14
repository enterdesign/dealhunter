# DealHunter AH

Strona (GitHub Pages) do liczenia opłacalności przedmiotów i receptur z aukcji WoW (TBC Anniversary,
docelowo Classic / Forever): vendor / disenchant / AH, najniższa / mediana / średnia, trend cen.
Dane wczytujesz z własnego pliku SavedVariables - wszystko liczy się lokalnie w przeglądarce,
nic nie jest wysyłane na serwer. Prowizja i depozyt AH są na razie wyłączone.

- `docs/` - strona (statyczna, bez zależności). Źródło dla GitHub Pages: gałąź domyślna, folder `/docs`.
  - `docs/data/recipes.json` - baza receptur (na razie pusta), `docs/data/items.json` - katalog przedmiotów (pusty).
- `web-tests/` - testy logiki strony: `node --test web-tests/site.test.mjs` (Node 20+).
- `addon/DealHunterAH/` - addon do gry zbierający ceny z AH do pliku SavedVariables (niesprawdzony w grze).
- `tests/` - testy silnika w Lua: `python3 -m unittest discover -s tests` (wymaga `pip install lupa`).

Format `docs/data/recipes.json`:
`[{ "id": 3918, "name": "...", "profession": "Engineering", "skill": 1, "produces": 4357, "qty": 1,
   "reagents": [{ "item": 2589, "count": 1 }], "source": "trener" }]`
(`id` = numer czaru receptury, `produces` = id przedmiotu).
