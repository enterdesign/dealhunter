#!/usr/bin/env python3
"""Buduje docs/data/tbc/vendors.json: cena za sztukę (w miedzi) składników sprzedawanych przez kupców
za same pieniądze i bez limitu zapasu. Źródło: zakładka "Sold by" na stronach Wowheada.

Użycie: python3 tools/build_vendors.py [--out docs/data/tbc]   (ok. 600 zapytań, ~1,2 s każde, wynik w cache)
"""
import argparse
import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import wowhead  # noqa: E402


def vendor_price(sold_by):
    """Najniższa cena za sztukę (miedź) u kupca bez limitu zapasu, płatna samymi pieniędzmi."""
    best = None
    for npc in sold_by or []:
        cost = npc.get("cost") or []
        if npc.get("stock", -1) != -1 or len(cost) != 1 or len(cost[0]) != 1:
            continue
        copper = cost[0][0]
        if not isinstance(copper, int) or copper <= 0:
            continue
        unit = copper / max(1, npc.get("stack", 1) or 1)
        best = unit if best is None else min(best, unit)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/data/tbc")
    ap.add_argument("--cache", default="data-raw/wowhead")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    recipes = json.loads((out / "recipes.json").read_text(encoding="utf-8"))
    reagents = sorted({g["item"] for r in recipes for g in r["reagents"]})

    prices = {}
    for i, item in enumerate(reagents, 1):
        html = wowhead.fetch_item(item, args.cache)
        price = vendor_price(wowhead.listview(html, "sold-by"))
        if price is not None:
            prices[str(item)] = round(price, 2)
        if i % 25 == 0 or i == len(reagents):
            print(f"[{i}/{len(reagents)}] kupcy: {len(prices)}", flush=True)

    data = {"source": "Wowhead (Sold by)", "fetched": datetime.date.today().isoformat(), "prices": prices}
    (out / "vendors.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Składniki u kupców: {len(prices)} z {len(reagents)}")


if __name__ == "__main__":
    main()
