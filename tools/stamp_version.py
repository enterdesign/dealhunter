#!/usr/bin/env python3
"""Dopisuje do importów w docs/js/*.js i do <script src> w docs/**/*.html parametr ?v=<hash zawartości>.

Dzięki temu przeglądarka (cache GitHub Pages ~10 minut) nie miesza starych plików JS z nowymi.
Uruchom po każdej zmianie w docs/js/: python3 tools/stamp_version.py   (idempotentne)
"""
import hashlib
import pathlib
import re

DOCS = pathlib.Path(__file__).resolve().parent.parent / "docs"
IMPORT = re.compile(r'''((?:from|import)\s*["'])(\.{1,2}/[^"'?]+\.js)(?:\?v=[0-9a-f]+)?(["'])''')
SCRIPT = re.compile(r'''(<script[^>]*\ssrc=["'])([^"'?]+\.js)(?:\?v=[0-9a-f]+)?(["'])''')


def content_hash(files):
    h = hashlib.sha1()
    for f in sorted(files):
        h.update(f.name.encode())
        h.update(IMPORT.sub(r"\1\2\3", f.read_text(encoding="utf-8")).encode())
    return h.hexdigest()[:8]


def main():
    js = sorted((DOCS / "js").glob("*.js"))
    version = content_hash(js)
    for f in js:
        text = f.read_text(encoding="utf-8")
        new = IMPORT.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(3)}", text)
        if new != text:
            f.write_text(new, encoding="utf-8")
    for f in DOCS.rglob("*.html"):
        text = f.read_text(encoding="utf-8")
        new = SCRIPT.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(3)}", text)
        if new != text:
            f.write_text(new, encoding="utf-8")
    print("wersja:", version)


if __name__ == "__main__":
    main()
