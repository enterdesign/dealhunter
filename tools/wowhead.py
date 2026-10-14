"""Pomocnicze funkcje do pobierania stron przedmiotów z Wowheada (z lokalnym cache'em i opóźnieniem).

Dane są pobierane raz i trzymane w data-raw/wowhead/ (poza repo). Opóźnienie między zapytaniami
jest celowo duże - to jednorazowe, osobiste pobranie, nie crawler.
"""
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

# Wersja bazy Wowheada: "tbc" (domyślnie) albo "classic" (WoW Forever); zmienia się zmienną WOWHEAD_GAME.
BASE = "https://www.wowhead.com/" + os.environ.get("WOWHEAD_GAME", "tbc") + "/item={}"
DELAY = 1.2
_last = [0.0]


def fetch_item(item_id, cache_dir, delay=DELAY):
    cache = pathlib.Path(cache_dir) / f"item-{item_id}.html"
    if cache.exists():
        return cache.read_text(encoding="utf-8", errors="replace")
    wait = delay - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(BASE.format(item_id), headers={"User-Agent": "dealhunter-personal-data-fetch"})
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:  # przedmiotu nie ma w tej wersji gry (np. materiał z TBC w Classic)
                html = ""
                break
            last_err = e
            time.sleep(3 * (attempt + 1))
        except Exception as e:  # noqa: BLE001 - ponawiamy dowolny błąd sieci
            last_err = e
            time.sleep(3 * (attempt + 1))
    else:
        raise RuntimeError(f"item {item_id}: {last_err}")
    _last[0] = time.time()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(html, encoding="utf-8")
    return html


def listview(html, view_id):
    """Zwraca listę rekordów z `new Listview({... id: 'view_id' ... data: [...]})` albo None."""
    marker = f"id: '{view_id}'"
    i = html.find(marker)
    if i < 0:
        return None
    j = html.find("data: [", i)
    if j < 0:
        return None
    # następny Listview zaczyna się po `data`, więc nie wolno wyjść poza bieżący widok
    nxt = html.find("new Listview(", i)
    if 0 < nxt < j:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(html[j + len("data: "):])
    except ValueError:
        return None
    return data
