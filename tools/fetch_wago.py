#!/usr/bin/env python3
"""Pobiera tabele DB2 (CSV) z wago.tools dla wybranego produktu/buildu do data-raw/<build>/.

Użycie: python3 tools/fetch_wago.py [--product wow_anniversary] [--build 2.5.6.70006]
Pliki w data-raw/ nie trafiają do repo (patrz .gitignore).
"""
import argparse
import json
import pathlib
import urllib.request

TABLES = ["SkillLine", "SkillLineAbility", "SpellName", "SpellReagents", "SpellEffect", "ItemSparse", "Item",
          "ItemDisenchantLoot"]
BASE = "https://wago.tools"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dealhunter-data-fetch"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def latest_build(product):
    builds = json.loads(get(f"{BASE}/api/builds"))
    return builds[product][0]["version"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--product", default="wow_anniversary")
    ap.add_argument("--build")
    ap.add_argument("--out", default="data-raw")
    args = ap.parse_args()
    build = args.build or latest_build(args.product)
    out = pathlib.Path(args.out) / build
    out.mkdir(parents=True, exist_ok=True)
    for table in TABLES:
        data = get(f"{BASE}/db2/{table}/csv?build={build}")
        (out / f"{table}.csv").write_bytes(data)
        print(f"{table}: {len(data):,} B")
    print(f"Zapisano w {out} (build {build})")


if __name__ == "__main__":
    main()
