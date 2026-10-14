# DealHunter AH

Strona (GitHub Pages) do zarabiania golda na aukcjach WoW. Wczytujesz plik SavedVariables ze skanem AH
(`Auctionator.lua` albo `DealHunterAH.lua` z naszego addona),
a strona liczy lokalnie w przeglądarce (nic nie jest wysyłane na serwer):

- **Flipy do vendora** - kup na AH taniej, niż płaci kupiec.
- **Flipy do profesji** - receptury (składniki od kupców liczone po cenie kupca) i rozbiór (disenchant).
- **Flipy na AH** - aktualna najniższa cena kontra mediana z historii skanów, z trendem.
- **Inwestycje z guidów** - przedmioty polecane w guidach z aktualną ceną i dystansem do typowej ceny.

Wszystko filtrowane po profesji i sortowane po zysku, koszcie i ROI. Zakładka **Strategie** zawiera guide
(własnymi słowami, ze źródłami i oceną ich wiarygodności) dla wszystkich profesji.
Prowizja i depozyt AH są domyślnie wyłączone.

## Źródła skanu
- **Auctionator** (`Auctionator.lua`): baza cen jest zapisana jako binarny napis CBOR; strona go dekoduje (`docs/js/cbor.js`).
  Auctionator zapisuje tylko najniższe ceny dzienne i ilość (mediana i średnia są niedostępne, używana jest najniższa cena).
  Historia obejmuje dni, w których robiłeś skany, więc flipy według historii poprawiają się z każdym kolejnym skanem.
- **Addon DealHunterAH** (patrz niżej): zapisuje też medianę i średnią oraz znane receptury.

## Addon DealHunterAH
Zbieracz danych (bez własnego okna aukcji i bez automatyzacji): zapisuje ceny z **pełnego skanu AH zrobionego
Auctionatorem** (najniższa cena, mediana, średnia, ilość, historia) oraz **znane receptury** postaci.
Analizę robi strona. Addon niczego nie kupuje, nie wystawia i nie wysyła zapytań do AH.

- **Ceny:** skanuje Auctionator (pełny skan, "Full Scan"). Addon zapisuje tylko kompletne listy aukcji; zwykłe wyszukiwanie
  pokazuje jedną stronę wyników, więc jest pomijane (`/dhah` pokaże, ile list pominięto). Plik `Auctionator.lua` też
  można wgrać na stronę, ale addon dodaje medianę i średnią.
- **Receptury:** skan uruchamiasz sam. Otwórz okno profesji (rozwiń wszystkie kategorie, wyłącz filtry) i kliknij przycisk
  "Zapisz receptury" w oknie profesji albo wpisz `/dhah recipes`. Dotyczy też Enchantingu (osobne okno).

Instalacja i użycie:
1. Pobierz `docs/DealHunterAH.zip` (link jest też na stronie) i rozpakuj do `World of Warcraft/<wersja>/Interface/AddOns/`
   (powstanie folder `DealHunterAH`). Numer `Interface` w `.toc` to `20506` (TBC Anniversary 2.5.6) i `16001` (WoW Forever 1.60.1). Jeśli addon
   jest "incompatible", sprawdź build komendą `/dump (select(4, GetBuildInfo()))` i zaznacz "Load out of date AddOns".
2. Zrób pełny skan AH Auctionatorem. W czacie pojawi się "zapisano ceny N przedmiotów".
3. W oknie każdej profesji kliknij "Zapisz receptury". Pojawi się "zapisano N nowych receptur".
4. Wpisz `/reload` (plik zapisuje się przy `/reload` albo wylogowaniu) i wgraj na stronie
   `WTF/Account/<konto>/SavedVariables/DealHunterAH.lua` (opcjonalnie razem z `Auctionator.lua`).
   W Chrome i Edge kliknij raz „Połącz z plikami…” i wskaż pliki; potem po każdym skanie wystarczy `/reload` w grze
   i przycisk „Odśwież z połączonych plików” (przeglądarka zapamiętuje połączenie, czasem pyta o zgodę na odczyt).

Komendy: `/dhah` (status), `/dhah recipes`, `/dhah item <link>`, `/dhah reset yes`.
Diagnostyka, gdy po skanie nic się nie zapisuje: `/dhah debug` (jakie API aukcji ma klient, ile zdarzeń list widziano, ostatnia lista)
i `/dhah spy` (włącz, zrób skan, potem `/dhah debug` pokaże, jakie zdarzenia aukcji faktycznie przychodzą; wyłącz tą samą komendą).
Addon obsługuje klasyczne API aukcji (TBC, Classic Era) i nowsze "replicate" (`C_AuctionHouse`).
Po zmianach w `addon/` uruchom `python3 tools/pack_addon.py`.

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
- `addon/DealHunterAH/` - addon do gry (zbieracz cen i receptur); `docs/DealHunterAH.zip` to jego paczka do pobrania (`tools/pack_addon.py`). Niesprawdzony w grze.
- `web-tests/` - testy strony: `node --test web-tests/site.test.mjs` (Node 20+).
- `tests/` - testy Pythona (generatory danych, addon na atrapach API gry, paczka ZIP): `python3 -m unittest discover -s tests` (wymaga `pip install lupa`).

## Ograniczenia danych
- Wyniki rozbioru to średnie z obserwacji graczy na Wowheadzie (nie z tabel serwera).
- Lista przedmiotów u kupców pochodzi z Wowheada; uwzględniane są tylko oferty bez limitu zapasu, płatne samym złotem.
- Wymagana umiejętność receptury to początek jej pomarańczowego zakresu (w danych klienta pole minimalne ma zawsze 1).
