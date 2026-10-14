#!/usr/bin/env python3
"""Buduje docs/data/recipes.json i docs/data/items.json z tabel DB2 pobranych przez fetch_wago.py.

Użycie: python3 tools/build_data.py --raw data-raw/2.5.6.70006 [--out docs/data]
Uwaga: w plikach klienta NIE ma tabel dropu (rozbiór, kupcy) - tych danych ten skrypt nie zawiera.
"""
import argparse
import csv
import json
import pathlib

PROFESSIONS = {
    164: "Blacksmithing", 165: "Leatherworking", 171: "Alchemy", 185: "Cooking", 186: "Mining",
    197: "Tailoring", 202: "Engineering", 333: "Enchanting", 755: "Jewelcrafting", 129: "First Aid",
}
EFFECT_CREATE_ITEM = 24
BONDING_PICKUP = 1


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def num(row, key, default=0):
    try:
        return int(float(row.get(key) or default))
    except ValueError:
        return default


def build(raw, out, build_name=""):
    raw, out = pathlib.Path(raw), pathlib.Path(out)

    # przedmioty: nazwa, cena u kupca, jakość, poziom, BoP
    items = {}
    for r in rows(raw / "ItemSparse.csv"):
        name = (r.get("Display_lang") or "").strip()
        if not name:
            continue
        item = {"name": name}
        if num(r, "SellPrice") > 0:
            item["vendorSell"] = num(r, "SellPrice")
        item["quality"] = num(r, "OverallQualityID")
        if num(r, "ItemLevel"):
            item["ilvl"] = num(r, "ItemLevel")
        if num(r, "Bonding") == BONDING_PICKUP:
            item["bop"] = True
        items[num(r, "ID")] = item

    # co receptura wytwarza (efekt "create item"), tylko dla czarów z profesji
    creates = {}
    for r in rows(raw / "SpellEffect.csv"):
        if num(r, "Effect") != EFFECT_CREATE_ITEM or num(r, "DifficultyID") != 0:
            continue
        spell, product = num(r, "SpellID"), num(r, "EffectItemType")
        if product and spell not in creates:
            creates[spell] = (product, max(1, num(r, "EffectBasePoints") + 1))

    reagents = {}
    for r in rows(raw / "SpellReagents.csv"):
        lst = [{"item": num(r, f"Reagent_{i}"), "count": num(r, f"ReagentCount_{i}")} for i in range(8)]
        reagents[num(r, "SpellID")] = [g for g in lst if g["item"] > 0 and g["count"] > 0]

    recipes, seen = [], set()
    for r in rows(raw / "SkillLineAbility.csv"):
        line, spell = num(r, "SkillLine"), num(r, "Spell")
        if line not in PROFESSIONS or spell not in creates or (line, spell) in seen:
            continue
        product, qty = creates[spell]
        if product not in items or not reagents.get(spell):
            continue
        seen.add((line, spell))
        recipes.append({
            "id": spell, "name": items[product]["name"], "profession": PROFESSIONS[line],
            # MinSkillLineRank w tej wersji klienta to zawsze 1, więc "skill" = początek pomarańczowego
            # zakresu (TrivialSkillLineRankLow), a "grey" = od którego poziomu receptura jest szara.
            "skill": num(r, "TrivialSkillLineRankLow"), "grey": num(r, "TrivialSkillLineRankHigh"),
            "produces": product, "qty": qty, "reagents": reagents[spell],
        })
    recipes.sort(key=lambda x: (x["profession"], x["skill"], x["name"], x["id"]))

    # katalog: wszystkie przedmioty z nazwą (nazwy w liście skanu AH)
    out.mkdir(parents=True, exist_ok=True)
    (out / "recipes.json").write_text(json.dumps(recipes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "items.json").write_text(
        json.dumps({"build": build_name, "items": {str(k): v for k, v in sorted(items.items())}},
                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return recipes, items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default="docs/data")
    args = ap.parse_args()
    recipes, items = build(args.raw, args.out, pathlib.Path(args.raw).name)
    by = {}
    for r in recipes:
        by[r["profession"]] = by.get(r["profession"], 0) + 1
    print(f"Receptury: {len(recipes)} {by}")
    print(f"Przedmioty: {len(items)}")


if __name__ == "__main__":
    main()
