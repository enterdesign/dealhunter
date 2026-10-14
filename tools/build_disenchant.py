#!/usr/bin/env python3
"""Buduje docs/data/tbc/disenchant.json: wyniki rozbioru (disenchant) wg przedziałów z ItemDisenchantLoot.

Źródła: tabele DB2 (przedziały: klasa, jakość, poziom przedmiotu) + obserwacje graczy z Wowheada
(strony materiałów z zakładką "Disenchanted from"). Dla każdego przedziału bierzemy po kilka najczęściej obserwowanych przedmiotów i sumujemy ich
wyniki rozbioru (szansa = liczba wypadnięć / liczba rozbiorów).

Użycie: python3 tools/build_disenchant.py --raw data-raw/2.5.6.70006 [--out docs/data/tbc]
"""
import argparse
import csv
import datetime
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import wowhead  # noqa: E402

MATERIALS = [10938, 10939, 10940, 10978, 10998, 11082, 11083, 11084, 11134, 11135, 11137, 11138, 11139,
             11174, 11175, 11176, 11177, 11178, 14343, 14344, 16202, 16203, 16204, 20725, 22445, 22446,
             22447, 22448, 22449, 22450]
SKIP_INVENTORY_TYPES = {0, 4, 19}  # nie-ekwipunek, koszulki, tabardy
MIN_CHANCE = 0.01
TOP_ITEMS = 3


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def load_brackets(raw):
    out = []
    for r in read_csv(pathlib.Path(raw) / "ItemDisenchantLoot.csv"):
        out.append({"id": int(r["ID"]), "cls": int(r["Class"]), "quality": int(r["Quality"]),
                    "min": int(r["MinLevel"]), "max": int(r["MaxLevel"])})
    return out


def pick_bracket(brackets, cls, quality, ilvl):
    """Najbardziej szczegółowy przedział (największy próg dolny, potem węższy zakres)."""
    cands = [b for b in brackets if b["cls"] == cls and b["quality"] == quality and b["min"] <= ilvl <= b["max"]]
    if not cands:
        return None
    return max(cands, key=lambda b: (b["min"], -(b["max"] - b["min"])))["id"]


def disenchantable_items(raw, items, brackets):
    """Przypisuje przedmioty klasy broń/pancerz (jakość 2-4) do przedziałów rozbioru."""
    meta = {}
    for r in read_csv(pathlib.Path(raw) / "Item.csv"):
        meta[int(r["ID"])] = (int(r["ClassID"]), int(r["InventoryType"] or 0))
    out = {}
    for item_id, it in items.items():
        cls, inv = meta.get(item_id, (None, 0))
        if cls not in (2, 4) or inv in SKIP_INVENTORY_TYPES:
            continue
        quality, ilvl = it.get("quality", 0), it.get("ilvl", 0)
        if quality not in (2, 3, 4) or not ilvl:
            continue
        b = pick_bracket(brackets, cls, quality, ilvl)
        if b is not None:
            out[item_id] = b
    return out


def parse_stack(s):
    """'{1: 47.1,2: 52.9}' -> {1: 47.1, 2: 52.9}"""
    return {int(q): float(p) for q, p in re.findall(r"(\d+):\s*([\d.]+)", s or "")}


def representatives(listings, item_bracket, k=TOP_ITEMS):
    """Wybiera po k najczęściej obserwowanych przedmiotów z każdego przedziału.

    listings: {material_id: [rekordy z listy "Disenchanted from"]}. Lista materiału jest ucięta przez
    Wowheada (ok. 200 pozycji), więc służy tylko do znalezienia przedmiotów z dużą próbą."""
    outof = {}
    for recs in listings.values():
        for rec in recs:
            if rec["id"] in item_bracket:
                outof[rec["id"]] = max(outof.get(rec["id"], 0), rec.get("outof", 0))
    per_bracket = {}
    for item, total in sorted(outof.items(), key=lambda kv: -kv[1]):
        per_bracket.setdefault(item_bracket[item], []).append(item)
    return {b: items[:k] for b, items in per_bracket.items()}


def aggregate(item_records, item_bracket):
    """item_records: {item_id: [rekordy z zakładki "Disenchanting" tego przedmiotu]} ->
    {bracket: {"n": liczba rozbiorów w próbie, "outcomes": [[materiał, szansa, średnia ilość], ...]}}"""
    n = {}
    drops = {}   # (bracket, material) -> [count, ważona suma ilości, suma wag]
    for item, recs in item_records.items():
        b = item_bracket.get(item)
        if b is None or not recs:
            continue
        n[b] = n.get(b, 0) + max(rec.get("outof", 0) for rec in recs)
        for rec in recs:
            if not rec.get("count"):
                continue
            d = drops.setdefault((b, rec["id"]), [0, 0.0, 0.0])
            stack = parse_stack(rec.get("pctstack")) or {1: 100.0}
            total = sum(stack.values())
            d[0] += rec["count"]
            d[1] += sum(q * p for q, p in stack.items()) / total * rec["count"]
            d[2] += rec["count"]

    result = {}
    for (b, material), (count, qsum, wsum) in drops.items():
        chance = count / n[b] if n.get(b) else 0
        if chance < MIN_CHANCE:
            continue
        result.setdefault(b, {"n": n[b], "outcomes": []})["outcomes"].append(
            [material, round(min(chance, 1.0), 4), round(qsum / wsum, 3)])
    for entry in result.values():
        entry["outcomes"].sort(key=lambda o: -o[1])
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default="docs/data/tbc")
    ap.add_argument("--cache", default="data-raw/wowhead")
    args = ap.parse_args()
    out = pathlib.Path(args.out)

    items = {int(k): v for k, v in json.loads((out / "items.json").read_text(encoding="utf-8"))["items"].items()}
    brackets = load_brackets(args.raw)
    item_bracket = disenchantable_items(args.raw, items, brackets)

    observations = {}
    for i, material in enumerate(MATERIALS, 1):
        html = wowhead.fetch_item(material, args.cache)
        observations[material] = wowhead.listview(html, "disenchanted-from") or []
        print(f"[{i}/{len(MATERIALS)}] {items.get(material, {}).get('name')}: {len(observations[material])} przedmiotów", flush=True)

    reps = representatives(observations, item_bracket)
    item_records = {}
    todo = [i for items_ in reps.values() for i in items_]
    for n_done, item in enumerate(todo, 1):
        html = wowhead.fetch_item(item, args.cache)
        item_records[item] = wowhead.listview(html, "disenchanting") or []
        if n_done % 10 == 0 or n_done == len(todo):
            print(f"  przedmioty reprezentatywne [{n_done}/{len(todo)}]", flush=True)

    brackets_out = aggregate(item_records, item_bracket)
    used = {b for b in brackets_out}
    data = {
        "source": "Wowhead (obserwacje graczy) + ItemDisenchantLoot (DB2)",
        "fetched": datetime.date.today().isoformat(),
        "brackets": {str(b): v for b, v in sorted(brackets_out.items())},
        "items": {str(i): b for i, b in sorted(item_bracket.items()) if b in used},
    }
    (out / "disenchant.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Przedziały z danymi: {len(brackets_out)}, przedmioty: {len(data['items'])}")


if __name__ == "__main__":
    main()
