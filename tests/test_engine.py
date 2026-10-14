"""Testy czystej logiki addona (Stats, History, Fees, Valuation, Recipes) na sztucznych danych.

Dane tu są wymyślone na potrzeby testów (fixture) - to NIE są prawdziwe ceny ani receptury z gry.
"""
import pathlib
import unittest

import lupa

SRC = pathlib.Path(__file__).resolve().parent.parent / "addon" / "DealHunterAH" / "src"


def load_engine():
    lua = lupa.LuaRuntime(unpack_returned_tuples=True)
    ns = lua.table()
    loader = lua.eval("function(code, name, ns) return assert(load(code, name))(name, ns) end")
    for name in ("Stats", "History", "Fees", "Valuation", "Recipes"):
        loader((SRC / f"{name}.lua").read_text(), name, ns)
    return lua, ns


def ctx_from(lua, prices, vendor_sell=None, vendor_buy=None, de=None):
    """prices: {(itemId, mode): copper} albo {itemId: copper} dla wszystkich trybów."""
    vendor_sell, vendor_buy, de = vendor_sell or {}, vendor_buy or {}, de or {}
    ctx = lua.table()
    ctx.ahPrice = lambda item, mode: prices.get((item, mode), prices.get(item))
    ctx.vendorSell = lambda item: vendor_sell.get(item)
    ctx.vendorBuy = lambda item: vendor_buy.get(item)

    def disenchant(item):
        rows = de.get(item)
        if rows is None:
            return None
        return lua.table_from([lua.table(item=i, qty=q, chance=c) for i, q, c in rows])

    ctx.disenchant = disenchant
    return ctx


class StatsTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load_engine()

    def listings(self, rows):
        return self.lua.table_from([self.lua.table(unit=u, qty=q) for u, q in rows])

    def test_summarize(self):
        s = self.ns.Stats.summarize(self.listings([(100, 1), (200, 1), (1000, 1)]))
        self.assertEqual((s.low, s.median, s.qty, s.n), (100, 200, 3, 3))
        self.assertAlmostEqual(s.avg, 1300 / 3)

    def test_median_is_weighted_by_quantity(self):
        s = self.ns.Stats.summarize(self.listings([(100, 1), (300, 20)]))
        self.assertEqual(s.median, 300)

    def test_summarize_empty(self):
        self.assertIsNone(self.ns.Stats.summarize(self.listings([])))

    def history(self, medians, step=86400):
        return self.lua.table_from(
            [self.lua.table(t=1_000_000 + i * step, median=m, low=m, avg=m) for i, m in enumerate(medians)]
        )

    def test_trend_up_down_flat(self):
        self.assertEqual(self.ns.Stats.trend(self.history([100, 100, 100, 150])).dir, "up")
        self.assertEqual(self.ns.Stats.trend(self.history([100, 100, 100, 70])).dir, "down")
        self.assertEqual(self.ns.Stats.trend(self.history([100, 101, 99, 102])).dir, "flat")

    def test_trend_needs_three_points(self):
        self.assertIsNone(self.ns.Stats.trend(self.history([100, 120])))

    def test_trend_ignores_old_points(self):
        # punkt sprzed 30 dni nie wchodzi do okna 7 dni
        h = self.history([1000, 100, 100, 100, 100], step=10 * 86400)
        self.assertIsNone(self.ns.Stats.trend(h))


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load_engine()
        self.db = self.lua.table()
        self.s = self.lua.table(low=1, median=2, avg=3, qty=4)

    def test_close_scans_overwrite(self):
        self.ns.History.add(self.db, 5, self.s, 1000)
        self.ns.History.add(self.db, 5, self.s, 1500)
        self.assertEqual(len(self.db["items"][5].history), 1)

    def test_spaced_scans_append_and_cap(self):
        for i in range(70):
            self.ns.History.add(self.db, 5, self.s, i * 7200)
        self.assertEqual(len(self.db["items"][5].history), 60)
        self.assertEqual(self.ns.History.latest(self.db, 5).t, 69 * 7200)


class FeesTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load_engine()

    def test_cut_by_ah_type_and_override(self):
        F = self.ns.Fees
        self.assertAlmostEqual(F.net(1000, self.lua.table(ahType="faction")), 950)
        self.assertAlmostEqual(F.net(1000, self.lua.table(ahType="neutral")), 850)
        o = self.lua.table(itemId=7, cutOverrides=self.lua.table_from({7: 0.0}))
        self.assertAlmostEqual(F.net(1000, o), 1000)

    def test_deposit_subtracted(self):
        self.assertAlmostEqual(self.ns.Fees.net(1000, self.lua.table(deposit=50)), 900)


class ValuationTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load_engine()

    def test_picks_best_of_three(self):
        # item 1: vendor 100, AH 1000 (netto 950), DE: 0.5 * 2 szt. materiału 2 po 600 => 0.5*2*570=570
        ctx = ctx_from(self.lua, {1: 1000, 2: 600}, vendor_sell={1: 100}, de={1: [(2, 2, 0.5)]})
        v = self.ns.Valuation.itemValue(1, ctx)
        self.assertEqual(v.best, "ah")
        self.assertAlmostEqual(v.ah, 950)
        self.assertAlmostEqual(v.disenchant, 570)
        self.assertEqual(v.vendor, 100)

    def test_disenchant_wins_and_incomplete_flag(self):
        ctx = ctx_from(self.lua, {2: 3000}, vendor_sell={1: 100}, de={1: [(2, 1, 1.0), (3, 1, 0.1)]})
        v = self.ns.Valuation.itemValue(1, ctx)
        self.assertEqual(v.best, "disenchant")
        self.assertTrue(v.deIncomplete)

    def test_nothing_known(self):
        self.assertIsNone(self.ns.Valuation.itemValue(1, ctx_from(self.lua, {})))


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.lua, self.ns = load_engine()

    def recipe(self, rid, produces, reagents, qty=1, prof="TestProf"):
        return self.lua.table(
            id=rid, name=f"r{rid}", profession=prof, produces=produces, qty=qty,
            reagents=self.lua.table_from([self.lua.table(item=i, count=c) for i, c in reagents]),
        )

    def test_profit_uses_low_to_buy_and_median_to_sell(self):
        prices = {(10, "low"): 100, (10, "median"): 150, (99, "median"): 1000, (99, "low"): 900}
        ctx = ctx_from(self.lua, prices)
        res = self.ns.Recipes.evaluate(self.recipe(1, 99, [(10, 4)]), ctx)
        self.assertEqual(res.cost, 400)
        self.assertAlmostEqual(res.value, 950)
        self.assertAlmostEqual(res.profit, 550)
        self.assertTrue(res.complete)

    def test_vendor_reagent_cheaper_than_ah(self):
        ctx = ctx_from(self.lua, {(10, "low"): 100, (99, "median"): 1000}, vendor_buy={10: 40})
        res = self.ns.Recipes.evaluate(self.recipe(1, 99, [(10, 2)]), ctx)
        self.assertEqual(res.cost, 80)

    def test_missing_reagent_marks_incomplete(self):
        ctx = ctx_from(self.lua, {(99, "median"): 1000})
        res = self.ns.Recipes.evaluate(self.recipe(1, 99, [(10, 1)]), ctx)
        self.assertFalse(res.complete)
        self.assertEqual(len(res.missing), 1)

    def test_rank_sorted_filtered_and_known_flag(self):
        prices = {(10, "low"): 100, (98, "median"): 500, (99, "median"): 2000}
        ctx = ctx_from(self.lua, prices)
        recipes = self.lua.table_from([
            self.recipe(1, 98, [(10, 1)]),
            self.recipe(2, 99, [(10, 1)]),
            self.recipe(3, 99, [(10, 1)], prof="Other"),
        ])
        opts = self.lua.table(profession="TestProf", known=self.lua.table_from({1: True}))
        ranked = self.ns.Recipes.rank(recipes, ctx, opts)
        self.assertEqual([ranked[i].recipe.id for i in (1, 2)], [2, 1])
        self.assertFalse(ranked[1].known)
        self.assertTrue(ranked[2].known)
        self.assertEqual(len(ranked), 2)


if __name__ == "__main__":
    unittest.main()
