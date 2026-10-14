"""Testy addona DealHunterAH (zbieracz danych) na atrapach API gry (lupa). Dane są sztuczne."""
import pathlib
import unittest

import lupa

SRC = pathlib.Path(__file__).resolve().parent.parent / "addon" / "DealHunterAH" / "src"

STUBS = """
DealHunterAHDB = { items = {}, known = {} }
_now = 1700000000
function time() return _now end
_auction = {}
function GetNumAuctionItems(kind) return #_auction end
function GetAuctionItemInfo(kind, i)
  local a = _auction[i]
  return a.name or "x", nil, a.count, 1, nil, nil, nil, 0, 0, a.buyout, 0, nil, nil, a.owner, nil, nil, a.itemId, true
end
_timers = {}
C_Timer = { After = function(sec, fn) _timers[#_timers + 1] = fn end }
_printed = {}
function print(...) _printed[#_printed + 1] = table.concat({...}, " ") end
_trade = nil
function GetTradeSkillLine() return _trade.name end
function GetNumTradeSkills() return #_trade.rows end
function GetTradeSkillInfo(i) return "n", _trade.rows[i].kind end
function GetTradeSkillRecipeLink(i) return _trade.rows[i].link end
_craft = nil
function GetCraftDisplaySkillLine() return _craft.name end
function GetNumCrafts() return #_craft.rows end
function GetCraftInfo(i) return "n", "s", _craft.rows[i].kind end
function GetCraftRecipeLink(i) return _craft.rows[i].link end
"""


def load():
    lua = lupa.LuaRuntime()
    lua.execute(STUBS)
    ns = lua.table()
    loader = lua.eval("function(code, name, ns) return assert(load(code, name))(name, ns) end")
    for name in ("Stats", "History", "Known", "Scanner"):
        loader((SRC / f"{name}.lua").read_text(), name, ns)
    return lua, ns


def listings(lua, rows):
    """rows: [(itemId, buyout, count, owner)] -> ustawia _auction"""
    lua.globals()._auction = lua.table_from([
        lua.table(itemId=i, buyout=b, count=c, owner=o) for i, b, c, o in rows
    ])


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load()

    def flush(self):
        self.ns.Scanner.onListUpdate()
        self.assertEqual(len(self.lua.eval("_timers")), 1)
        return self.ns.Scanner.flush()

    def history(self, item):
        return self.lua.eval("DealHunterAHDB.items")[item]["history"]

    def test_records_low_median_avg_qty(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 2000, 1, "b"), (100, 9000, 1, "c"), (200, 500, 5, "a")])
        self.assertEqual(self.flush(), 2)
        p = self.history(100)[1]
        self.assertEqual((p["low"], p["median"], p["qty"]), (1000, 2000, 3))
        self.assertAlmostEqual(p["avg"], 4000)
        q = self.history(200)[1]
        self.assertEqual((q["low"], q["qty"]), (100, 5))    # cena za sztukę: 500 / 5

    def test_same_list_event_twice_does_not_double_count(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 1000, 1, "a")])   # dwie identyczne oferty
        self.ns.Scanner.collect()
        self.ns.Scanner.collect()                                         # ta sama lista jeszcze raz
        self.ns.Scanner.flush()
        self.assertEqual(self.history(100)[1]["qty"], 2)

    def test_identical_offers_without_owner_are_kept(self):
        listings(self.lua, [(100, 1000, 1, None)] * 3)
        self.flush()
        self.assertEqual(self.history(100)[1]["qty"], 3)

    def test_ignores_bid_only_and_empty(self):
        listings(self.lua, [(100, 0, 1, "a"), (100, 500, 0, "a")])
        self.assertEqual(self.flush(), 0)
        self.assertEqual(len(self.lua.eval("DealHunterAHDB.items")), 0)

    def test_buffer_cleared_after_flush(self):
        listings(self.lua, [(100, 1000, 1, "a")])
        self.flush()
        self.lua.globals()._now = 1700000000 + 7200
        listings(self.lua, [(100, 3000, 1, "a")])
        self.lua.execute("_timers = {}")
        self.flush()
        h = self.history(100)
        self.assertEqual((h[1]["low"], h[2]["low"]), (1000, 3000))   # drugi skan nie miesza się z pierwszym
        self.assertEqual(h[2]["qty"], 1)


def trade(lua, name, rows):
    lua.globals()._trade = lua.table(name=name, rows=lua.table_from([lua.table(kind=k, link=l) for k, l in rows]))


class KnownTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load()

    def known(self):
        return {k: sorted(v.keys()) for k, v in self.lua.eval("DealHunterAHDB.known").items()}

    def test_scan_skips_headers_and_parses_ids(self):
        trade(self.lua, "Blacksmithing", [
            ("header", None), ("optimal", "|cffffd000|Henchant:29606|h[Adamantite Breastplate]|h|r"),
            ("easy", "|cffffd000|Henchant:3979|h[Accurate Scope]|h|r"), ("optimal", None)])
        self.assertEqual(self.ns.Known.scanTradeSkill()[0], 2)
        self.assertEqual(self.known(), {"Blacksmithing": [3979, 29606]})

    def test_sets_accumulate_and_report_only_new(self):
        trade(self.lua, "Alchemy", [("easy", "|Henchant:1|h"), ("easy", "|Henchant:2|h")])
        self.assertEqual(self.ns.Known.scanTradeSkill()[0], 2)
        trade(self.lua, "Alchemy", [("easy", "|Henchant:2|h"), ("easy", "|Henchant:3|h")])   # okno z innym filtrem
        self.assertEqual(self.ns.Known.scanTradeSkill()[0], 1)
        self.assertEqual(self.known(), {"Alchemy": [1, 2, 3]})

    def test_unknown_profession_and_empty_window_ignored(self):
        trade(self.lua, "UNKNOWN", [("easy", "|Henchant:1|h")])
        self.assertEqual(self.ns.Known.scanTradeSkill(), 0)
        self.assertEqual(self.known(), {})

    def test_craft_window_for_enchanting(self):
        self.lua.globals()._craft = self.lua.table(name="Enchanting", rows=self.lua.table_from([
            self.lua.table(kind="header", link=None), self.lua.table(kind="optimal", link="|Henchant:27899|h[x]|h")]))
        self.assertEqual(self.ns.Known.scanCraft()[0], 1)
        self.assertEqual(self.known(), {"Enchanting": [27899]})

    def test_count(self):
        self.lua.execute('DealHunterAHDB.known = { A = { [1] = true, [2] = true }, B = { [3] = true } }')
        total, per = self.ns.Known.count()
        self.assertEqual(total, 3)
        self.assertEqual({k: v for k, v in per.items()}, {"A": 2, "B": 1})


class StatsHistoryTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load()

    def listings(self, rows):
        return self.lua.table_from([self.lua.table(unit=u, qty=q) for u, q in rows])

    def test_summarize_weighted(self):
        s = self.ns.Stats.summarize(self.listings([(100, 1), (200, 1), (1000, 1)]))
        self.assertEqual((s.low, s.median, s.qty, s.n), (100, 200, 3, 3))
        self.assertAlmostEqual(s.avg, 1300 / 3)
        self.assertEqual(self.ns.Stats.summarize(self.listings([(100, 1), (300, 20)])).median, 300)
        self.assertIsNone(self.ns.Stats.summarize(self.listings([])))

    def test_trend(self):
        h = lambda ms: self.lua.table_from([self.lua.table(t=1_000_000 + i * 86400, median=m, low=m, avg=m) for i, m in enumerate(ms)])
        self.assertEqual(self.ns.Stats.trend(h([100, 100, 100, 150])).dir, "up")
        self.assertEqual(self.ns.Stats.trend(h([100, 100, 100, 70])).dir, "down")
        self.assertIsNone(self.ns.Stats.trend(h([100, 120])))

    def test_history_cap_and_close_scans(self):
        db = self.lua.table()
        s = self.lua.table(low=1, median=2, avg=3, qty=4)
        self.ns.History.add(db, 5, s, 1000)
        self.ns.History.add(db, 5, s, 1500)                  # < 1 h: nadpisuje ostatni punkt
        self.assertEqual(len(db["items"][5]["history"]), 1)
        for i in range(70):
            self.ns.History.add(db, 6, s, i * 7200)
        self.assertEqual(len(db["items"][6]["history"]), 60)


class FilesTests(unittest.TestCase):
    def test_all_lua_files_compile(self):
        lua = lupa.LuaRuntime()
        check = lua.eval("function(code, name) local f, err = load(code, name); return err end")
        for f in sorted(SRC.glob("*.lua")):
            self.assertIsNone(check(f.read_text(), f.name), f.name)

    def test_toc_matches_source_files(self):
        toc = (SRC.parent / "DealHunterAH.toc").read_text()
        listed = {line.strip().replace("\\", "/") for line in toc.splitlines() if line.strip().startswith("src")}
        self.assertEqual(listed, {f"src/{f.name}" for f in SRC.glob("*.lua")})
        self.assertIn("## SavedVariables: DealHunterAHDB", toc)
        self.assertRegex(toc, r"## Interface: \d{5}")


if __name__ == "__main__":
    unittest.main()
