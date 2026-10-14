# DealHunter AH

Addon do WoW TBC Anniversary (docelowo też Classic / Forever) liczący opłacalność przedmiotów
i receptur: vendor / disenchant / AH (z prowizją), min / mediana / średnia i trend cen.
Nie automatyzuje żadnych akcji - ceny zbiera z aukcji, które pokazuje gra po Twoim skanie.

- `addon/DealHunterAH/` - addon (Lua); skopiuj do `Interface/AddOns/`.
- `tests/` - testy silnika wyceny (`python3 -m unittest discover -s tests`, wymaga `pip install lupa`).

Status: silnik, zbieranie cen i okno (`/dhah`) gotowe, ale niesprawdzone w grze. Brak jeszcze danych receptur
(Engineering, Blacksmithing) i tabel disenchant - generowane osobnym skryptem.
Wartości do potwierdzenia na kliencie: numer Interface w `.toc`, prowizja AH, sygnatury API.
