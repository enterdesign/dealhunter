#!/usr/bin/env python3
"""Pakuje addon/DealHunterAH do docs/DealHunterAH.zip (do pobrania ze strony). Zawartość jest deterministyczna.

Uruchom po każdej zmianie w addon/: python3 tools/pack_addon.py   (test pilnuje, żeby ZIP był aktualny)
"""
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon" / "DealHunterAH"
OUT = ROOT / "docs" / "DealHunterAH.zip"


def addon_files():
    return sorted(p for p in ADDON.rglob("*") if p.is_file())


def main():
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in addon_files():
            info = zipfile.ZipInfo(f"DealHunterAH/{f.relative_to(ADDON).as_posix()}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, f.read_bytes())
    print(f"{OUT.relative_to(ROOT)}: {len(addon_files())} plików")


if __name__ == "__main__":
    main()
