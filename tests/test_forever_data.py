"""Spójność danych i stron trybu WoW Forever z trybem TBC (te same funkcje, osobne dane)."""
import json
import pathlib
import unittest

DOCS = pathlib.Path(__file__).resolve().parent.parent / "docs"
FILES = ["recipes.json", "items.json", "vendors.json", "disenchant.json", "strategies.json"]


class ForeverDataTests(unittest.TestCase):
    def test_same_data_files_as_tbc(self):
        for name in FILES:
            self.assertTrue((DOCS / "data" / "forever" / name).exists(), name)

    def test_recipes_reference_known_items(self):
        data = DOCS / "data" / "forever"
        items = json.loads((data / "items.json").read_text(encoding="utf-8"))["items"]
        recipes = json.loads((data / "recipes.json").read_text(encoding="utf-8"))
        self.assertGreater(len(recipes), 500)
        for r in recipes:
            self.assertIn(str(r["produces"]), items)
            for g in r["reagents"]:
                self.assertIn(str(g["item"]), items)

    def test_disenchant_and_vendors_not_empty(self):
        data = DOCS / "data" / "forever"
        de = json.loads((data / "disenchant.json").read_text(encoding="utf-8"))
        self.assertGreater(len(de["brackets"]), 5)
        vendors = json.loads((data / "vendors.json").read_text(encoding="utf-8"))
        self.assertGreater(len(vendors["prices"]), 50)

    def test_pages_and_mode_selector(self):
        page = (DOCS / "forever" / "index.html").read_text(encoding="utf-8")
        tbc = (DOCS / "tbc" / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-mode="forever"', page)
        self.assertEqual(page.replace('data-mode="forever"', 'data-mode="tbc"').replace("WoW Forever", "TBC Anniversary"), tbc)
        home = (DOCS / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="forever/"', home)
        self.assertNotIn("wkrótce", home)


if __name__ == "__main__":
    unittest.main()
