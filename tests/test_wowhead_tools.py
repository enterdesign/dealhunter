"""Testy narzędzi tools/wowhead.py, build_disenchant.py, build_vendors.py na sztucznych fragmentach stron."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import build_disenchant as de  # noqa: E402
import build_vendors as vend  # noqa: E402
import wowhead  # noqa: E402

PAGE = """
<script>new Listview({
    template: 'item',
    id: 'sold-by',
    data: [{"id":1,"stock":-1,"cost":[[24]],"stack":1},{"id":2,"stock":5,"cost":[[10]],"stack":1}]});</script>
<script>new Listview({
    id: 'reagent-for',
    data: [{"id":99}]});</script>
"""


class ListviewTests(unittest.TestCase):
    def test_extracts_named_view(self):
        self.assertEqual([r["id"] for r in wowhead.listview(PAGE, "sold-by")], [1, 2])
        self.assertEqual(wowhead.listview(PAGE, "reagent-for"), [{"id": 99}])
        self.assertIsNone(wowhead.listview(PAGE, "nie-ma"))

    def test_does_not_leak_into_next_view(self):
        html = "new Listview({ id: 'a' });\nnew Listview({ id: 'b', data: [1,2] });"
        self.assertIsNone(wowhead.listview(html, "a"))
        self.assertEqual(wowhead.listview(html, "b"), [1, 2])


class VendorTests(unittest.TestCase):
    def test_unlimited_coin_only(self):
        self.assertEqual(vend.vendor_price(wowhead.listview(PAGE, "sold-by")), 24)

    def test_skips_limited_and_currency_and_divides_by_stack(self):
        self.assertIsNone(vend.vendor_price([{"stock": 3, "cost": [[10]], "stack": 1}]))
        self.assertIsNone(vend.vendor_price([{"stock": -1, "cost": [[0, [[1234, 2]]]], "stack": 1}]))
        self.assertEqual(vend.vendor_price([{"stock": -1, "cost": [[100]], "stack": 5},
                                            {"stock": -1, "cost": [[30]], "stack": 1}]), 20)
        self.assertIsNone(vend.vendor_price(None))


class DisenchantTests(unittest.TestCase):
    BR = [{"id": 1, "cls": 4, "quality": 2, "min": 5, "max": 15},
          {"id": 2, "cls": 4, "quality": 4, "min": 66, "max": 99},
          {"id": 3, "cls": 4, "quality": 4, "min": 90, "max": 170}]

    def test_pick_bracket_prefers_most_specific(self):
        self.assertEqual(de.pick_bracket(self.BR, 4, 2, 10), 1)
        self.assertEqual(de.pick_bracket(self.BR, 4, 4, 80), 2)
        self.assertEqual(de.pick_bracket(self.BR, 4, 4, 95), 3)
        self.assertIsNone(de.pick_bracket(self.BR, 2, 2, 10))

    def test_parse_stack(self):
        self.assertEqual(de.parse_stack("{1: 47.5,2: 52.5}"), {1: 47.5, 2: 52.5})
        self.assertEqual(de.parse_stack(None), {})

    def test_representatives_top_k(self):
        listings = {10: [{"id": 100, "outof": 50}, {"id": 101, "outof": 500}, {"id": 102, "outof": 5}]}
        reps = de.representatives(listings, {100: 1, 101: 1, 102: 1}, k=2)
        self.assertEqual(reps, {1: [101, 100]})

    def test_aggregate_chance_and_quantity_distribution(self):
        # dwa przedmioty z jednego przedziału: łącznie 200 rozbiorów, materiał 7 wypadł 150 razy
        recs = {
            100: [{"id": 7, "count": 100, "outof": 100, "pctstack": "{1: 50,2: 50}"}],
            101: [{"id": 7, "count": 50, "outof": 100, "pctstack": "{1: 100}"},
                  {"id": 8, "count": 50, "outof": 100, "pctstack": "{1: 100}"}],
        }
        out = de.aggregate(recs, {100: 1, 101: 1})
        self.assertEqual(out[1]["n"], 200)
        by = {o[0]: o for o in out[1]["outcomes"]}
        self.assertAlmostEqual(by[7][1], 0.75)
        shares = dict(by[7][2])
        self.assertAlmostEqual(shares[1], 2 / 3, places=3)   # 50 + 50 z 150 wypadnięć
        self.assertAlmostEqual(shares[2], 1 / 3, places=3)
        self.assertAlmostEqual(sum(shares.values()), 1.0, places=2)
        self.assertAlmostEqual(by[8][1], 0.25)

    def test_rare_outcomes_dropped(self):
        recs = {100: [{"id": 7, "count": 1, "outof": 1000}]}
        self.assertEqual(de.aggregate(recs, {100: 1}), {})


if __name__ == "__main__":
    unittest.main()
