#!/usr/bin/env python3
"""Buduje docs/data/forever/strategies.json: strategie zarabiania golda dla WoW Forever (treść własnymi słowami).

Treść opiera się na ogólnej wiedzy o ekonomii Classic (materiały, wyroby, flipy). To punkt wyjścia, nie dane
z serwera - zawsze sprawdzaj wnioski w zakładce Okazje na własnym skanie. Skrypt sprawdza, czy każda nazwa
przedmiotu istnieje w docs/data/forever/items.json.

Użycie: python3 tools/build_strategies_forever.py [--out docs/data/forever]
"""
import argparse
import datetime
import json
import pathlib

VH, H, M, L = "bardzo wysoka", "wysoka", "średnia", "niska"
SRC = {"title": "Wowhead: Gold Making (Classic)", "url": "https://www.wowhead.com/classic/guides/gold-making",
       "reliability": "średnia", "note": "ogólny punkt odniesienia; konkretne wskazówki poniżej to wiedza ogólna o Classic, niezweryfikowana na Twoim serwerze"}


def items(tier_map):
    return [{"name": n, "value": v} for v, names in tier_map for n in names]


STRATEGIES = [
    {"id": "ceny-na-serwerze", "profession": "Ogólne", "tier": None,
     "title": "Sprawdzaj ceny na własnym serwerze",
     "summary": "Każda lista \"co się opłaca\" jest uśredniona. Ekonomia serwera potrafi ją odwrócić, więc decyzję podejmuj po własnym skanie AH.",
     "points": ["Zrób pełny skan AH przed zakupem materiałów.", "Porównuj zysk z receptur i flipów w zakładce Okazje.",
                "Zwracaj uwagę na przedmioty BoP - nie da się ich sprzedać na AH.",
                "Pamiętaj, że strona na razie nie odlicza prowizji i depozytu AH."],
     "sources": [SRC]},
    {"id": "flipy-ah", "profession": "Ogólne", "tier": None,
     "title": "Flipy na AH: kupuj poniżej typowej ceny",
     "summary": "Podstawowa zasada: kup przedmiot taniej niż zwykle i sprzedaj w normalnej cenie. Strona porównuje aktualną najniższą cenę z historią Twoich skanów.",
     "points": ["Kupuj, gdy najniższa cena jest wyraźnie poniżej mediany z historii (tryb \"Flipy AH\").",
                "W Forever beta dodatek zapisuje tylko najniższą cenę i ilość, więc \"mediana\" jest wtedy najniższą ceną z danego skanu.",
                "Zwracaj uwagę na trend: spadająca cena może oznaczać, że \"okazja\" dalej tanieje."],
     "sources": [SRC]},
    {"id": "vendor-flipy", "profession": "Ogólne", "tier": None,
     "title": "Flipy do kupca: przedmioty na AH tańsze niż cena skupu",
     "summary": "Zdarza się, że przedmiot wystawiony na AH jest tańszy niż suma, którą zapłaci kupiec. To najprostszy, bezryzykowny zysk.",
     "points": ["Tryb \"Flipy do vendora\" w zakładce Okazje wylicza je ze skanu.", "Zysk jest mały na sztukę, więc liczy się ilość ofert."],
     "sources": [SRC]},
    {"id": "alchemy", "profession": "Alchemy", "tier": "S",
     "title": "Alchemy: mikstury, eliksiry i flaski na raidy",
     "summary": "Alchemia sprzedaje się stabilnie, bo raidy i PvP zużywają mikstury. Największy popyt mają eliksiry bojowe i ochronne oraz flaski.",
     "points": ["Flaski (Flask of the Titans, Flask of Petrification) są drogie, ale wymagają Black Lotus i rzadkich ziół - sprawdź koszt w Okazjach.",
                "Mikstury lecznicze i many z wyższego poziomu schodzą stale.",
                "Ceny ziół skaczą z podażą - ten sam przepis raz jest opłacalny, raz nie."],
     "items": items([(H, ["Flask of the Titans", "Flask of Petrification", "Elixir of the Mongoose", "Major Healing Potion"]),
                     (M, ["Greater Fire Protection Potion", "Mighty Rage Potion"])]),
     "check": {"type": "topRecipes", "profession": "Alchemy"}, "sources": [SRC]},
    {"id": "tailoring", "profession": "Tailoring", "tier": "S",
     "title": "Tailoring: sztuki materiału i torby",
     "summary": "Krawiectwo opiera się na tanim, łatwo farmionym materiale (Mageweave, Runecloth). Sprzedają się sztuki materiału, torby i bandaże.",
     "points": ["Bolt of Runecloth i Bolt of Mageweave bywa drożej sprzedać jako sztukę niż jako surowiec.",
                "Torby (Mageweave Bag, Runecloth Bag) mają stałe zapotrzebowanie.",
                "Heavy Runecloth Bandage kupują gracze na PvP i farmie."],
     "items": items([(H, ["Runecloth Bag", "Bolt of Runecloth"]), (M, ["Mageweave Bag", "Bolt of Mageweave", "Heavy Runecloth Bandage"])]),
     "check": {"type": "topRecipes", "profession": "Tailoring"}, "sources": [SRC]},
    {"id": "enchanting", "profession": "Enchanting", "tier": "S",
     "title": "Enchanting: rozbiór (disenchant) i zaklęcia",
     "summary": "Enchanter zarabia na rozbiorze zielonych i niebieskich przedmiotów oraz na zaklęciach. Materiały z rozbioru możesz też sprzedawać.",
     "points": ["Zakładka Okazje liczy wartość oczekiwaną rozbioru (EV) z rozrzutem i pewnością.",
                "Kupuj na AH przedmioty, których EV rozbioru jest wyższe niż cena.",
                "Wartość pewności zależy od liczby obserwacji, które zebrano dla danego przedziału."],
     "items": items([(H, ["Greater Eternal Essence", "Large Brilliant Shard"])]),
     "check": {"type": "topRecipes", "profession": "Enchanting"}, "sources": [SRC]},
    {"id": "blacksmithing", "profession": "Blacksmithing", "tier": "B",
     "title": "Blacksmithing: kamienie, pancerze i sztabki",
     "summary": "Kowalstwo zarabia na kamieniach do ostrzenia, sztabkach i wybranych pancerzach. Wiele rzeczy wymaga Miningu.",
     "points": ["Kamienie (Dense, Elemental Sharpening Stone) mają stały popyt.", "Arcanite Bar jest ceniony przez alchemików i kowali."],
     "items": items([(H, ["Lionheart Helm", "Arcanite Bar"]), (M, ["Dense Sharpening Stone", "Elemental Sharpening Stone"])]),
     "check": {"type": "topRecipes", "profession": "Blacksmithing"}, "sources": [SRC]},
    {"id": "leatherworking", "profession": "Leatherworking", "tier": "B",
     "title": "Leatherworking: skóry i pancerze",
     "summary": "Rymarstwo sprzedaje się dzięki wyrobom ze skór i dodatkom do pancerza. Dobry zysk przy własnym skórowaniu.",
     "points": ["Rugged Leather, Core Leather i Enchanted Leather to materiały, które często są warte więcej sprzedane niż przerobione.", "Pancerze z rzadkimi recepturami (np. Wicked Leather Gauntlets) sprzedają się drożej."],
     "items": items([(M, ["Core Leather", "Enchanted Leather", "Rugged Leather", "Wicked Leather Gauntlets"])]),
     "check": {"type": "topRecipes", "profession": "Leatherworking"}, "sources": [SRC]},
    {"id": "engineering", "profession": "Engineering", "tier": "B",
     "title": "Engineering: ładunki, granaty i narzędzia",
     "summary": "Inżynieria sprzedaje materiały wybuchowe i narzędzia na raidy i PvP. Wiele wyrobów jest używanych głównie przez inżynierów.",
     "points": ["Goblin Sapper Charge i Thorium Grenade mają stały popyt w PvP i na raidach.", "Droższe wyroby (np. Gnomish Death Ray) sprzedają się rzadko."],
     "items": items([(M, ["Goblin Sapper Charge", "Thorium Grenade"]), (L, ["Gnomish Death Ray"])]),
     "check": {"type": "topRecipes", "profession": "Engineering"}, "sources": [SRC]},
    {"id": "mining", "profession": "Mining", "tier": "A",
     "title": "Mining: sztabki i wydobycie",
     "summary": "Górnictwo daje surowiec dla kowali i inżynierów. Sprzedajesz rudę albo przetopione sztabki, zależnie od tego, co droższe.",
     "points": ["Porównaj cenę rudy ze sztabką - czasem opłaca się przetopić, czasem nie.", "Rzadkie żyły (Truesilver, Dark Iron) są warte wyraźnie więcej."],
     "items": items([(H, ["Dark Iron Bar", "Thorium Bar", "Truesilver Bar"]), (M, ["Mithril Bar"])]),
     "check": {"type": "topRecipes", "profession": "Mining"}, "sources": [SRC]},
    {"id": "cooking-firstaid", "profession": "Cooking", "tier": None,
     "title": "Cooking i First Aid: profesje pomocnicze",
     "summary": "Jedzenie i bandaże sprzedają się po niewielkich cenach, ale stabilnie. Rzadko robi się na nich duże pieniądze.",
     "points": ["Jedzenie (np. Nightfin Soup) kupują gracze na raidy.", "Receptury kulinarne i bandaże są w bazie strony, więc Okazje je uwzględniają, jeśli skan ma ich ceny."],
     "items": items([(L, ["Nightfin Soup", "Heavy Runecloth Bandage"])]),
     "sources": [SRC]},
    {"id": "herbalism", "profession": "Herbalism", "tier": "A",
     "title": "Herbalism: zioła dla alchemików",
     "summary": "Zielarstwo daje surowiec dla alchemii. Stałe zioła sprzedają się masowo, a rzadkie (Black Lotus, Dreamfoil) osiągają wysokie ceny.",
     "points": ["Black Lotus i Dreamfoil to jedne z najdroższych ziół.", "Gromsblood i Sungrass sprzedają się masowo.",
                "Porównaj cenę zioła z ceną mikstury z niego - czasem lepiej sprzedać surowiec."],
     "items": items([(VH, ["Black Lotus"]), (H, ["Dreamfoil"]), (M, ["Gromsblood", "Sungrass"])]),
     "sources": [SRC]},
    {"id": "skinning", "profession": "Skinning", "tier": "B",
     "title": "Skinning: skóry dla rymarzy",
     "summary": "Skórowanie daje skóry dla rymarstwa. Sprzedaż jest stabilna, ale ceny zwykłych skór są niskie, a rzadkie warte więcej.",
     "points": ["Rugged Leather i Core Leather schodzą stale.", "Sprawdź, czy surowa skóra jest droższa od przerobionej w Okazjach."],
     "items": items([(M, ["Rugged Leather", "Core Leather"])]),
     "sources": [SRC]},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/data/forever")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    names = {v["name"] for v in json.loads((out / "items.json").read_text(encoding="utf-8"))["items"].values()}
    missing = sorted({i["name"] for s in STRATEGIES for i in s.get("items", []) if i["name"] not in names})
    data = {"updated": datetime.date.today().isoformat(), "strategies": STRATEGIES}
    (out / "strategies.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Strategie: {len(STRATEGIES)}, bez dopasowania w items.json: {missing}")


if __name__ == "__main__":
    main()
