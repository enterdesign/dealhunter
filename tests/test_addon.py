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
_total = nil
function GetNumAuctionItems(kind) return #_auction, _total or #_auction end
function GetAuctionItemInfo(kind, i)
  local a = _auction[i]
  return a.name or "x", nil, a.count, 1, nil, nil, nil, 0, 0, a.buyout, 0, nil, nil, a.owner, nil, nil, a.itemId, true
end
_replicate = nil
_browse = nil
_tsui = { info = {}, ids = {}, name = nil }
C_TradeSkillUI = {
  GetAllRecipeIDs = function() return _tsui.ids end,
  GetRecipeInfo = function(id) return _tsui.info[id] end,
  GetBaseProfessionInfo = function() return _tsui.name and { professionName = _tsui.name } or nil end,
}
C_AuctionHouse = {
  GetBrowseResults = function() return _browse or {} end,
  GetNumReplicateItems = function() return _replicate and #_replicate or 0 end,
  GetReplicateItemInfo = function(i)
    local a = _replicate[i + 1]                       -- numeracja od 0
    return "x", nil, a.count, 1, nil, nil, nil, 0, 0, a.buyout, 0, nil, nil, a.owner, nil, nil, a.itemId, true
  end,
}
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

    def run_scan(self):
        """Symuluje zdarzenie listy aukcji i upływ ciszy (timer)."""
        self.lua.execute("_timers = {}")
        self.ns.Scanner.onListUpdate()
        self.ns.Scanner.onListUpdate()                                 # kolejne zdarzenia nie dodają timerów
        self.assertEqual(len(self.lua.eval("_timers")), 1)
        self.ns.Scanner.process()

    def count(self):
        return len(list(self.lua.eval("DealHunterAHDB.items").keys()))   # len() dałoby 0 dla rzadkich kluczy

    def history(self, item):
        return self.lua.eval("DealHunterAHDB.items")[item]["history"]

    def test_records_low_median_avg_qty(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 2000, 1, "b"), (100, 9000, 1, "c"), (200, 500, 5, "a")])
        self.run_scan()
        self.assertEqual(self.count(), 2)
        p = self.history(100)[1]
        self.assertEqual((p["low"], p["median"], p["qty"]), (1000, 2000, 3))
        self.assertAlmostEqual(p["avg"], 4000)
        q = self.history(200)[1]
        self.assertEqual((q["low"], q["qty"]), (100, 5))    # cena za sztukę: 500 / 5

    def test_refresh_after_full_scan_is_not_reprocessed_or_reported(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 2000, 1, "b")])
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("_printed").values())), 1)
        self.lua.globals()._now = 1700000000 + 30                  # gra odświeża listę po skanie (ten sam skan)
        self.run_scan()
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("_printed").values())), 1)   # bez kolejnych komunikatów
        self.assertEqual(len(self.history(100)), 1)
        self.lua.globals()._now = 1700000000 + 3600                # po godzinie ta sama liczba ofert = nowy skan
        listings(self.lua, [(100, 3000, 1, "a"), (100, 4000, 1, "b")])
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("_printed").values())), 2)
        self.assertEqual(self.history(100)[2]["low"], 3000)

    def test_partial_list_is_ignored(self):
        # zwykłe wyszukiwanie: gra pokazuje 50 z 400 wyników (jedna strona)
        listings(self.lua, [(100, 1000, 1, "a")] * 50)
        self.lua.globals()._total = 400
        self.run_scan()
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.ns.Scanner.ignored, 1)

    def test_complete_small_result_set_is_recorded(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 1500, 1, "b")])   # wszystkie wyniki naraz
        self.run_scan()
        self.assertEqual(self.history(100)[1]["qty"], 2)
        self.assertEqual(self.ns.Scanner.ignored, 0)

    def test_full_scan_with_larger_total_is_recorded(self):
        listings(self.lua, [(i % 50 + 1, 100 + i, 1, "s%d" % i) for i in range(5000)])
        self.lua.globals()._total = 60000                                   # partia >= próg pełnego skanu
        self.run_scan()
        self.assertEqual(self.count(), 50)

    def test_same_list_collected_twice_does_not_double_count(self):
        listings(self.lua, [(100, 1000, 1, "a"), (100, 1000, 1, "a")])   # dwie identyczne oferty
        self.ns.Scanner.collect()
        self.ns.Scanner.collect()                                         # ta sama lista jeszcze raz
        self.ns.Scanner.flush()
        self.assertEqual(self.history(100)[1]["qty"], 2)

    def test_identical_offers_without_owner_are_kept(self):
        listings(self.lua, [(100, 1000, 1, None)] * 3)
        self.run_scan()
        self.assertEqual(self.history(100)[1]["qty"], 3)

    def test_ignores_bid_only_and_empty(self):
        listings(self.lua, [(100, 0, 1, "a"), (100, 500, 0, "a")])
        self.run_scan()
        self.assertEqual(self.count(), 0)
        listings(self.lua, [])
        self.run_scan()
        self.assertEqual(self.count(), 0)

    def test_buffer_cleared_after_flush(self):
        listings(self.lua, [(100, 1000, 1, "a")])
        self.run_scan()
        self.lua.globals()._now = 1700000000 + 7200
        listings(self.lua, [(100, 3000, 1, "a")])
        self.run_scan()
        h = self.history(100)
        self.assertEqual((h[1]["low"], h[2]["low"]), (1000, 3000))   # drugi skan nie miesza się z pierwszym
        self.assertEqual(h[2]["qty"], 1)


def trade(lua, name, rows):
    lua.globals()._trade = lua.table(name=name, rows=lua.table_from([lua.table(kind=k, link=l) for k, l in rows]))


class ReplicateTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load()

    def set_list(self, rows):
        self.lua.globals()._replicate = self.lua.table_from([
            self.lua.table(itemId=i, buyout=b, count=c, owner=o) for i, b, c, o in rows])

    def run_scan(self):
        self.lua.execute("_timers = {}")
        self.ns.Scanner.onListUpdate("replicate")
        self.ns.Scanner.onListUpdate("replicate")
        self.assertEqual(len(self.lua.eval("_timers")), 1)
        self.ns.Scanner.process()

    def history(self, item):
        return self.lua.eval("DealHunterAHDB.items")[item]["history"]

    def test_replicate_scan_is_recorded_zero_indexed(self):
        self.set_list([(100, 1000, 1, "a"), (100, 3000, 1, "b"), (200, 500, 5, "c")])   # w tym pierwsza oferta (indeks 0)
        self.run_scan()
        p = self.history(100)[1]
        self.assertEqual((p["low"], p["qty"]), (1000, 2))
        self.assertEqual(self.history(200)[1]["low"], 100)
        self.assertEqual(self.ns.Scanner.events["replicate"], 2)

    def test_replicate_refresh_not_reprocessed(self):
        self.set_list([(100, 1000, 1, "a"), (100, 3000, 1, "b")])
        self.run_scan()
        self.lua.globals()._now = 1700000000 + 20
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("_printed").values())), 1)

    def test_empty_replicate_list_saves_nothing(self):
        self.set_list([])
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("DealHunterAHDB.items").keys())), 0)

    def test_missing_replicate_api_is_safe(self):
        self.lua.execute("C_AuctionHouse = nil")
        self.ns.Scanner.onListUpdate("replicate")
        self.ns.Scanner.process()
        self.assertEqual(len(list(self.lua.eval("DealHunterAHDB.items").keys())), 0)


class BrowseTests(unittest.TestCase):
    """Forever beta: Auctionator w trybie summary; wyniki przeglądania = najniższa cena i ilość na przedmiot."""

    def setUp(self):
        self.lua, self.ns = load()

    def set_results(self, rows):
        self.lua.globals()._browse = self.lua.table_from([
            self.lua.table(itemKey=self.lua.table(itemID=i), minPrice=p, totalQuantity=q) for i, p, q in rows])

    def run_scan(self):
        self.lua.execute("_timers = {}")
        for _ in range(14):                       # tyle zdarzeń przychodzi podczas skanu
            self.ns.Scanner.onListUpdate("browse")
        self.assertEqual(len(self.lua.eval("_timers")), 1)
        self.ns.Scanner.process()

    def history(self, item):
        return self.lua.eval("DealHunterAHDB.items")[item]["history"]

    def test_records_low_and_qty_without_median(self):
        self.set_results([(100, 1500, 12), (200, 300, 4)])
        self.run_scan()
        p = self.history(100)[1]
        self.assertEqual((p["low"], p["qty"]), (1500, 12))
        self.assertIsNone(p["median"])
        self.assertIsNone(p["avg"])
        self.assertEqual(self.ns.Scanner.events["browse"], 14)

    def test_variants_of_same_item_are_merged(self):
        self.set_results([(100, 1500, 12), (100, 900, 3), (100, 2000, 1)])
        self.run_scan()
        p = self.history(100)[1]
        self.assertEqual((p["low"], p["qty"]), (900, 16))

    def test_invalid_rows_skipped_and_refresh_ignored(self):
        self.set_results([(100, 0, 5), (101, 500, 0), (102, 700, 2)])
        self.run_scan()
        self.assertEqual(sorted(self.lua.eval("DealHunterAHDB.items").keys()), [102])
        self.lua.globals()._now = 1700000000 + 30
        self.run_scan()
        self.assertEqual(len(list(self.lua.eval("_printed").values())), 1)

    def test_browse_api_missing_is_safe(self):
        self.lua.execute("C_AuctionHouse.GetBrowseResults = nil")
        self.ns.Scanner.onListUpdate("browse")
        self.ns.Scanner.process()
        self.assertEqual(len(list(self.lua.eval("DealHunterAHDB.items").keys())), 0)


class KnownTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load()

    def known(self):
        return {k: sorted(v.keys()) for k, v in self.lua.eval("DealHunterAHDB.known").items()}

    def test_returns_profession_and_total(self):
        trade(self.lua, "Alchemy", [("easy", "|Henchant:1|h"), ("easy", "|Henchant:2|h")])
        added, prof, total = self.ns.Known.scanTradeSkill()
        self.assertEqual((added, prof, total), (2, "Alchemy", 2))
        added, prof, total = self.ns.Known.scanTradeSkill()    # drugi raz: nic nowego, ale profesja i suma są znane
        self.assertEqual((added, prof, total), (0, "Alchemy", 2))

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

    def test_modern_profession_window_uses_learned_flag(self):
        self.lua.execute("""
          _tsui.name = "Blacksmithing"
          _tsui.ids = { 10, 11, 12 }
          _tsui.info = { [10] = { learned = true }, [11] = { learned = false }, [12] = { learned = true } }
        """)
        added, prof, total = self.ns.Known.scanModern()
        self.assertEqual((added, prof, total), (2, "Blacksmithing", 2))
        self.assertEqual(self.known(), {"Blacksmithing": [10, 12]})

    def test_modern_scan_without_api_or_profession(self):
        self.lua.execute("C_TradeSkillUI = nil")
        self.assertEqual(self.ns.Known.scanModern(), 0)

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
        self.assertRegex(toc, r"## Interface: \d{5}(, \d{5})*")
        self.assertIn("20506", toc)   # TBC Anniversary 2.5.6
        self.assertIn("16001", toc)   # WoW Forever 1.60.1


if __name__ == "__main__":
    unittest.main()
