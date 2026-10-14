#!/usr/bin/env python3
"""Buduje docs/data/tbc/strategies.json: strategie zarabiania golda (własnymi słowami) + listy przedmiotów z guidów.

Źródło treści: poniższe słowniki. Przedmioty i ich "wartość wg guida" pochodzą z tabel guida Wowheada
(Burning Crusade Classic Gold Making With Professions Overview). Skrypt sprawdza, czy każda nazwa
przedmiotu istnieje w docs/data/tbc/items.json, i wypisuje te, których nie znalazł.

Użycie: python3 tools/build_strategies.py [--out docs/data/tbc]
"""
import argparse
import datetime
import json
import pathlib

VH, H, M, L = "bardzo wysoka", "wysoka", "średnia", "niska"

SRC_WOWHEAD = {"title": "Wowhead: Burning Crusade Classic Gold Making With Professions Overview",
               "url": "https://www.wowhead.com/tbc/guide/best-professions-how-to-make-gold-burning-crusade-classic",
               "reliability": "wysoka", "note": "przeczytany w całości; strona podaje aktualizację 2025-11-30"}
SRC_WOWHEAD_HUB = {"title": "Wowhead: Gold Making (TBC Classic)", "url": "https://www.wowhead.com/tbc/guides/gold-making",
                   "reliability": "średnia", "note": "tylko spis treści z wyników wyszukiwania"}
SRC_PCGAMER = {"title": "PC Gamer: How to make gold in WoW Burning Crusade Classic",
               "url": "https://pcgamer.com/wow-tbc-classic-gold-farming-guide",
               "reliability": "średnia", "note": "tylko streszczenie z wyszukiwarki"}
SRC_NOOB = {"title": "Noobtoboss: TBC Classic Professions Gold Making Guide",
            "url": "https://noobtoboss.com/tbc-classic-professions-gold-guide/",
            "reliability": "średnia", "note": "tylko streszczenie z wyszukiwarki"}
SRC_BITT = {"title": "Bitt's Guides: TBC Classic Gold - Professions", "url": "https://bittsguides.com/tbc-classic-gold-professions/",
            "reliability": "średnia", "note": "tylko streszczenie z wyszukiwarki"}
SRC_AXENT = {"title": "axenthost: WoW TBC tailoring money making guide", "url": "https://axenthost.com/blog/wow-tbc-tailoring-money-making-guide/",
             "reliability": "niska", "note": "blog sprzedawcy golda; tylko streszczenie z wyszukiwarki"}


def items(tier_map):
    return [{"name": n, "value": v} for v, names in tier_map for n in names]


STRATEGIES = [
    # ---------------------------------------------------------------- przegląd
    {"id": "przeglad-profesji", "profession": "Ogólne", "tier": None,
     "title": "Które profesje zarabiają najlepiej",
     "summary": "Wowhead dzieli profesje na trzy poziomy opłacalności. Im wyższy poziom, tym stabilniej sprzedają się wyroby i tym mniej trzeba rzadkich receptur.",
     "points": ["S (najlepsze): Tailoring, Alchemy, Jewelcrafting, Enchanting.",
                "A (pewne, ale mniej): Mining, Herbalism.",
                "B (tylko z rzadkimi recepturami albo w pierwszej fazie): Skinning, Leatherworking, Blacksmithing, Engineering.",
                "Ceny zależą od serwera, więc ten ranking to punkt wyjścia - sprawdź go na własnych skanach (zakładka Okazje)."],
     "sources": [SRC_WOWHEAD]},
    {"id": "ceny-na-serwerze", "profession": "Ogólne", "tier": None,
     "title": "Sprawdzaj ceny na własnym serwerze",
     "summary": "Każda lista \"co się opłaca\" jest uśredniona. Ekonomia serwera potrafi ją odwrócić, więc decyzję podejmuj po własnym skanie AH.",
     "points": ["Zrób skan AH przed zakupem materiałów.", "Porównuj zysk z receptur i flipów w zakładce Okazje.",
                "Zwracaj uwagę na przedmioty BoP - nie da się ich sprzedać na AH."],
     "sources": [SRC_WOWHEAD, SRC_PCGAMER]},
    {"id": "flipy-ah", "profession": "Ogólne", "tier": None,
     "title": "Flipy na AH: kupuj poniżej typowej ceny",
     "summary": "Podstawowa zasada: kup przedmiot taniej niż zwykle i sprzedaj w normalnej cenie. Strona porównuje aktualną najniższą cenę z historią Twoich skanów.",
     "points": ["Kupuj, gdy najniższa cena jest wyraźnie poniżej mediany z historii (tryb \"Flipy AH\").",
                "Jeden z poradników mierzy w ok. 15-20 golda zysku na jednym flipie po odjęciu prowizji AH (źródło o niskiej wiarygodności).",
                "Zwracaj uwagę na trend: spadająca cena może oznaczać, że \"okazja\" dalej tanieje."],
     "sources": [SRC_PCGAMER, SRC_AXENT]},
    {"id": "cykl-tygodniowy", "profession": "Ogólne", "tier": None,
     "title": "Cykl tygodniowy: mikstury i flaski tanieją w weekend",
     "summary": "Jeden z poradników opisuje, że materiały do rajdów (mikstury, flaski) są tańsze w weekend, a po wtorkowym resecie rajdów popyt rośnie. Możesz to sprawdzić na własnej historii cen.",
     "points": ["Kupuj konsumpcje w weekend i sprzedawaj po resecie rajdów.",
                "Zbierz kilka skanów z różnych dni tygodnia, żeby zobaczyć, czy ten wzorzec występuje na Twoim serwerze.",
                "To twierdzenie pochodzi z przedruku poradnika (niska wiarygodność) - traktuj jako hipotezę do sprawdzenia."],
     "items": items([(M, ["Flask of Pure Death", "Flask of Relentless Assault", "Flask of Distilled Wisdom", "Flask of Supreme Power", "Destruction Potion", "Haste Potion"])]),
     "sources": [SRC_PCGAMER]},
    {"id": "farmienie-popytu", "profession": "Ogólne", "tier": None,
     "title": "Farmienie przedmiotów o stałym popycie (Primale, reputacje)",
     "summary": "Niektóre materiały sprzedają się zawsze, bo są potrzebne do wielu receptur albo do zdobywania reputacji.",
     "points": ["Primale (Mana, Shadow, Fire, Air, Water) mają wysoką wartość i są wymagane w wielu wysokich recepturach.",
                "Arcane Tome (Scryers) i Fel Armament (Aldor) dają po 350 reputacji za oddanie, więc mają stały popyt.",
                "Wowhead ma osobne poradniki do farmienia Primali i przedmiotów do reputacji."],
     "items": items([(H, ["Primal Mana", "Primal Shadow", "Primal Fire", "Primal Air", "Primal Water"]),
                     (M, ["Arcane Tome", "Fel Armament"]),
                     (L, ["Sunfury Signet", "Mark of Sargeras", "Coilfang Armaments", "Primal Life", "Primal Earth", "Sanguine Hibiscus",
                          "Arakkoa Feather", "Oshu'gun Crystal Fragment", "Pair of Ivory Tusks"])]),
     "sources": [SRC_WOWHEAD, SRC_WOWHEAD_HUB]},
    # ---------------------------------------------------------------- S
    {"id": "tailoring", "profession": "Tailoring", "tier": "S",
     "title": "Tailoring: pancerze BiS, spellthready i duże torby",
     "summary": "Jedna z najlepszych profesji w TBC: daje mocny ekwipunek dla większości klas casterów oraz torby i spellthready potrzebne przez cały dodatek.",
     "points": ["Największą wartość mają przedmioty BiS pierwszej fazy: Vengeance Wrap, Spellstrike Hood i Pants, Whitemend Hood i Pants, Girdle of Ruination.",
                "Runic i Golden Spellthread (nogawki) oraz Primal Mooncloth Bag (największa torba) mają wysoką wartość przez cały dodatek.",
                "Shadowcloth wymaga cooldownu 3 dni i 20 godzin - wartość średnia.",
                "Netherweave Bag jest tania i łatwa; jeden z poradników opisuje masową produkcję (kup tkaniny w weekend, sprzedaj w tygodniu) z marżą rzędu 1-3 golda na torbę - niska wiarygodność źródła."],
     "items": items([(VH, ["Vengeance Wrap", "Spellstrike Hood", "Whitemend Hood", "Spellstrike Pants", "Whitemend Pants", "Girdle of Ruination"]),
                     (H, ["Unyielding Girdle", "Battlecast Hood", "Battlecast Pants", "Runic Spellthread", "Golden Spellthread", "Primal Mooncloth Bag"]),
                     (M, ["Shadowcloth", "Spellcloth", "Primal Mooncloth", "Unyielding Bracers", "Cloak of Eternity", "White Remedy Cape", "Cloak of the Black Void"]),
                     (L, ["Imbued Netherweave Bag", "Netherweave Bag"])]),
     "check": {"type": "topRecipes", "profession": "Tailoring"},
     "sources": [SRC_WOWHEAD, SRC_AXENT]},
    {"id": "alchemy", "profession": "Alchemy", "tier": "S",
     "title": "Alchemy: flaski, mikstury i transmutacje",
     "summary": "Konsumpcje są potrzebne przez cały dodatek, a transmutacje dostarczają reagentów do wielu wysokich receptur.",
     "points": ["Transmutacje z cooldownem 20 godzin: Primal Might, Earthstorm Diamond i Skyfire Diamond - wysoka wartość.",
                "Flaski (Pure Death, Relentless Assault, Distilled Wisdom, Supreme Power, ...) i mikstury (Destruction, Haste, Insane Strength) mają średnią wartość.",
                "Mercurial Stone jest potrzebny jubilerom do Mercurial Adamantite.",
                "Możesz sprzedawać swój cooldown transmutacji innym graczom za gold (usługa).",
                "Specjalizacje alchemiczne dają szansę na dodatkowy wyrób przy tworzeniu."],
     "items": items([(H, ["Primal Might", "Earthstorm Diamond", "Skyfire Diamond"]),
                     (M, ["Flask of Pure Death", "Flask of Relentless Assault", "Flask of Fortification", "Flask of Chromatic Wonder",
                          "Flask of Blinding Light", "Flask of Distilled Wisdom", "Flask of Mighty Restoration", "Flask of Supreme Power",
                          "Destruction Potion", "Insane Strength Potion", "Haste Potion", "Mercurial Stone"]),
                     (L, ["Ironshield Potion", "Elixir of Empowerment", "Elixir of Major Mageblood", "Elixir of Major Shadow Power",
                          "Elixir of Major Defense", "Fel Strength Elixir", "Elixir of Major Agility", "Elixir of Draenic Wisdom",
                          "Elixir of Major Firepower", "Elixir of Major Frost Power", "Earthen Elixir", "Elixir of Major Fortitude",
                          "Elixir of Major Strength"])]),
     "check": {"type": "topRecipes", "profession": "Alchemy"},
     "sources": [SRC_WOWHEAD, SRC_PCGAMER]},
    {"id": "jewelcrafting", "profession": "Jewelcrafting", "tier": "S",
     "title": "Jewelcrafting: szlify gemów, meta gemy i biżuteria",
     "summary": "Gemy są potrzebne przez cały dodatek, zwłaszcza w pierwszych fazach, zanim pojawią się gemy epickie. Jubiler szlifuje gemy i przerabia rudę (prospecting).",
     "points": ["Meta gemy (Chaotic Skyfire, Relentless/Tenacious/Powerful/Bracing/Insightful Earthstorm Diamond) i szlify Living Ruby (Teardrop, Delicate, Runed, Bold) mają wysoką wartość.",
                "Chain of the Twilight Owl i Eye of the Night to wysoko cenione przedmioty pre-raidowe.",
                "Szlify Dawnstone i Noble Topaz mają średnią wartość, a Nightseye i Talasite niską.",
                "Surowa ruda jest często warta więcej niż sztabki, bo jubilerzy ją przerabiają - uwzględnij to, zanim przetopisz."],
     "items": items([(H, ["Chaotic Skyfire Diamond", "Relentless Earthstorm Diamond", "Tenacious Earthstorm Diamond", "Powerful Earthstorm Diamond",
                          "Bracing Earthstorm Diamond", "Insightful Earthstorm Diamond", "Mystical Skyfire Diamond", "Enigmatic Skyfire Diamond",
                          "Teardrop Living Ruby", "Delicate Living Ruby", "Runed Living Ruby", "Bold Living Ruby",
                          "Chain of the Twilight Owl", "Eye of the Night"]),
                     (M, ["Solid Star of Elune", "Rigid Dawnstone", "Great Dawnstone", "Thick Dawnstone", "Smooth Dawnstone", "Gleaming Dawnstone",
                          "Veiled Noble Topaz", "Luminous Noble Topaz", "Inscribed Noble Topaz", "Potent Noble Topaz", "Glinting Noble Topaz",
                          "Shifting Nightseye", "Sovereign Nightseye", "Glowing Nightseye", "Royal Nightseye"]),
                     (L, ["Jagged Talasite", "Dazzling Talasite", "Enduring Talasite"])]),
     "check": {"type": "topRecipes", "profession": "Jewelcrafting"},
     "sources": [SRC_WOWHEAD, SRC_NOOB, SRC_BITT]},
    {"id": "enchanting", "profession": "Enchanting", "tier": "S",
     "title": "Enchanting: enchanty, materiały i rozbiór",
     "summary": "W TBC nie ma jeszcze welinów (pojawią się dopiero w Wrath), więc zarabiasz na samych enchantach, materiałach i olejach. Enchanty to usługa, nie przedmiot na AH.",
     "points": ["Najcenniejsze enchanty: Weapon - Mongoose, Sunfire i Soulfrost (bardzo wysoka), a także Greater Agility, Major Healing, 2H Major Agility, Savagery, Chest - Exceptional Stats, Boots - Cat's Swiftness i Boar's Speed (wysoka).",
                "Void Crystal jest potrzebny do większości wysokich enchantów (średnia wartość).",
                "Oleje (Superior Wizard/Mana Oil) i zwykłe materiały (Large Prismatic Shard, Arcane Dust) mają niską wartość.",
                "Rozbiór (disenchant) daje stały dochód. Strona w zakładce Okazje -> Profesje pokazuje, które przedmioty z AH opłaca się rozbierać.",
                "Wyrabianie umiejętności jest drogie - policz koszt przed startem (źródło o średniej wiarygodności)."],
     "items": items([(M, ["Void Crystal"]),
                     (L, ["Superior Wizard Oil", "Superior Mana Oil", "Large Prismatic Shard", "Greater Planar Essence", "Small Prismatic Shard", "Arcane Dust"])]),
     "check": {"type": "topDisenchant"},
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    # ---------------------------------------------------------------- A
    {"id": "mining", "profession": "Mining", "tier": "A",
     "title": "Mining: rudy, gemy i motes",
     "summary": "Górnictwo zasila Jewelcrafting, Blacksmithing i Engineering, więc to, co wykopiesz, ma stały popyt. Węzłów rudy jest mniej niż ziół, ale gemy i motes dobrze się sprzedają.",
     "points": ["Living Ruby (wysoka wartość) jest potrzebny do gemów BiS pierwszej fazy dla wszystkich klas.",
                "Star of Elune, Dawnstone, Noble Topaz, Hardened Adamantite Bar, Felsteel Bar, Khorium Bar i Mote of Fire/Primal Fire mają średnią wartość.",
                "Surowa ruda bywa warta więcej niż sztabki, bo jubilerzy ją przerabiają.",
                "Latający mount znacznie przyspiesza zbieranie w Outland."],
     "items": items([(H, ["Living Ruby"]),
                     (M, ["Star of Elune", "Dawnstone", "Noble Topaz", "Hardened Adamantite Bar", "Felsteel Bar", "Khorium Bar", "Mote of Fire", "Primal Fire"]),
                     (L, ["Nightseye", "Talasite", "Adamantite Ore", "Adamantite Bar", "Eternium Ore", "Eternium Bar", "Fel Iron Ore", "Fel Iron Bar",
                          "Mote of Earth", "Primal Earth"])]),
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    {"id": "herbalism", "profession": "Herbalism", "tier": "A",
     "title": "Herbalism: zioła i motes dla alchemików",
     "summary": "Ziół jest dużo, a alchemicy potrzebują ich ciągle. Zioła i motes z zielarstwa mają przyzwoitą wartość.",
     "points": ["Mote of Mana/Primal Mana, Mote of Life/Primal Life, Mana Thistle, Terocone, Nightmare Vine i Netherbloom mają średnią wartość.",
                "Fel Lotus jest potrzebny do wszystkich flasek TBC (niska wartość, ale stały popyt).",
                "Felweed, Ragveil, Dreaming Glory i Ancient Lichen są pospolite i tanie."],
     "items": items([(M, ["Mote of Mana", "Primal Mana", "Mote of Life", "Primal Life", "Mana Thistle", "Terocone", "Nightmare Vine", "Netherbloom"]),
                     (L, ["Fel Lotus", "Ancient Lichen", "Dreaming Glory", "Ragveil", "Felweed"])]),
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    # ---------------------------------------------------------------- B
    {"id": "skinning", "profession": "Skinning", "tier": "B",
     "title": "Skinning: skóry dla skórników",
     "summary": "Skinning głównie wspiera Leatherworking (czasem też Blacksmithing i Tailoring). Skór jest dużo, więc ceny są umiarkowane.",
     "points": ["Cobra Scales mają średnią wartość i są potrzebne w kilku wysokich recepturach.",
                "Knothide Leather to baza prawie wszystkich receptur Leatherworkingu (niska wartość, duże ilości).",
                "Źródła nie są zgodne co do skórowania: jedne dają mu wysokie noty, inne uznają za mało dochodowe."],
     "items": items([(M, ["Cobra Scales"]),
                     (L, ["Thick Clefthoof Leather", "Heavy Knothide Leather", "Wind Scales", "Nether Dragonscales", "Fel Scales", "Crystal Infused Leather", "Knothide Leather"])]),
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    {"id": "leatherworking", "profession": "Leatherworking", "tier": "B",
     "title": "Leatherworking: ekwipunek pre-raid i enchanty na nogawki",
     "summary": "Skórnik robi cenione nogawki i część ekwipunku, ale najlepsze elementy BiS są BoP, więc możliwości sprzedaży są ograniczone.",
     "points": ["Wyroby pre-raid pierwszej fazy: Cobrascale Gloves, Gloves of the Living Touch, Hood of Primal Life, Windslayer Wraps (bardzo wysoka wartość).",
                "Nethercobra i Nethercleft Leg Armor (nogawki) oraz komplety Heavy Clefthoof i Fel Leather mają wysoką wartość.",
                "Riding Crop (+10% prędkości mounta) ma wysoką wartość, a Drums of Battle średnią.",
                "Wyrabianie jest drogie i wymaga dużo skór - warto połączyć z Skinningiem."],
     "items": items([(VH, ["Cobrascale Gloves", "Gloves of the Living Touch", "Hood of Primal Life", "Windslayer Wraps"]),
                     (H, ["Nethercobra Leg Armor", "Nethercleft Leg Armor", "Heavy Clefthoof Vest", "Heavy Clefthoof Leggings", "Heavy Clefthoof Boots",
                          "Fel Leather Boots", "Fel Leather Leggings", "Fel Leather Gloves", "Riding Crop"]),
                     (M, ["Cobrahide Leg Armor", "Clefthide Leg Armor", "Drums of Battle"])]),
     "check": {"type": "topRecipes", "profession": "Leatherworking"},
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    {"id": "blacksmithing", "profession": "Blacksmithing", "tier": "B",
     "title": "Blacksmithing: BoE w pierwszej fazie, pręty i kamienie",
     "summary": "Kowal przede wszystkim robi ekwipunek BoP dla siebie, a do sprzedaży zostaje mniej. BoE bronie i pancerze mają sens głównie w pierwszej fazie.",
     "points": ["Wysoko cenione BoE z pierwszej fazy: Eternium Runed Blade, Hand of Eternity, Bracers of the Green Fortress (bardzo wysoka), komplety Ragesteel i Felsteel (wysoka).",
                "Pręty (Eternium, Adamantite, Fel Iron Rod) są potrzebne enchanterom do wyższych enchantów (średnia wartość).",
                "Adamantite Sharpening Stone i Weightstone mają niską cenę, ale jeden z poradników uznaje je za najprostszy, stały zbyt.",
                "Bez Miningu koszt materiałów zależy od AH i bywa nieprzewidywalny - sprawdź go w zakładce Okazje."],
     "items": items([(VH, ["Eternium Runed Blade", "Hand of Eternity", "Bracers of the Green Fortress"]),
                     (H, ["Ragesteel Helm", "Ragesteel Shoulders", "Ragesteel Breastplate", "Ragesteel Gloves", "Felsteel Helm", "Felsteel Gloves", "Felsteel Leggings"]),
                     (M, ["Eternium Rod", "Adamantite Rod", "Fel Iron Rod", "Adamantite Weapon Chain", "Felsteel Shield Spike"]),
                     (L, ["Adamantite Sharpening Stone", "Adamantite Weightstone", "Greater Rune of Warding", "Greater Ward of Shielding"])]),
     "check": {"type": "topRecipes", "profession": "Blacksmithing"},
     "sources": [SRC_WOWHEAD, SRC_NOOB, SRC_BITT]},
    {"id": "engineering", "profession": "Engineering", "tier": "B",
     "title": "Engineering: zabawki i przedmioty dla innych inżynierów",
     "summary": "Inżynieria jest głównie do własnego użytku. Niewiele wyrobów da się sprzedać, i to zwykle innym inżynierom, a ich wytworzenie jest drogie.",
     "points": ["Wysoko cenione: Flying Machine Control i Turbo-Charged Flying Machine Control (jedyne craftowalne mounty, tylko dla inżynierów), Goblin Rocket Launcher, Gnomish Poultryizer, Nigh Invulnerability Belt.",
                "Rocket Boots Xtreme (Lite): receptura jest BoP, ale wyrób jest BoE, więc da się go sprzedać.",
                "Stabilized Eternium Scope i Khorium Scope to wysoko cenione ulepszenia broni dystansowej.",
                "Zapthrottle Mote Extractor pozwala zbierać motes z chmur gazu w Outland."],
     "items": items([(H, ["Turbo-Charged Flying Machine Control", "Flying Machine Control", "Goblin Rocket Launcher", "Gnomish Poultryizer",
                          "Rocket Boots Xtreme Lite", "Rocket Boots Xtreme", "Nigh Invulnerability Belt", "Stabilized Eternium Scope", "Khorium Scope"]),
                     (M, ["Zapthrottle Mote Extractor"])]),
     "check": {"type": "topRecipes", "profession": "Engineering"},
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
    # ---------------------------------------------------------------- bez rankingu
    {"id": "cooking-firstaid", "profession": "Cooking", "tier": None,
     "title": "Cooking, First Aid, Fishing: profesje pomocnicze",
     "summary": "W przeczytanych źródłach te profesje nie są zaliczane do zarabiających. Dają premie dla własnej postaci albo guildii.",
     "points": ["Nie znalazłem w źródłach potwierdzonej strategii zarabiania golda na Cooking, First Aid ani Fishing.",
                "Receptury kulinarne i bandaże są w bazie strony, więc rankingi w zakładce Okazje je uwzględnią, jeśli skan ma ich ceny."],
     "sources": [SRC_WOWHEAD, SRC_NOOB]},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/data/tbc")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    names = {v["name"] for v in json.loads((out / "items.json").read_text(encoding="utf-8"))["items"].values()}
    missing = sorted({i["name"] for s in STRATEGIES for i in s.get("items", []) if i["name"] not in names})
    data = {"updated": datetime.date.today().isoformat(), "strategies": STRATEGIES}
    (out / "strategies.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(s.get("items", [])) for s in STRATEGIES)
    print(f"Strategie: {len(STRATEGIES)}, przedmioty: {total}, bez dopasowania w items.json: {len(missing)}")
    for n in missing:
        print("  brak:", n)


if __name__ == "__main__":
    main()
