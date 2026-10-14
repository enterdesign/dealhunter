"""Spójność danych strategii (docs/data/tbc/strategies.json) z katalogiem przedmiotów."""
import json
import pathlib
import unittest

DATA = pathlib.Path(__file__).resolve().parent.parent / "docs" / "data" / "tbc"


class StrategyDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.strategies = json.loads((DATA / "strategies.json").read_text(encoding="utf-8"))["strategies"]
        items = json.loads((DATA / "items.json").read_text(encoding="utf-8"))["items"]
        cls.names = {v["name"] for v in items.values()}
        cls.professions = {r["profession"] for r in json.loads((DATA / "recipes.json").read_text(encoding="utf-8"))}

    def test_ids_unique_and_fields_present(self):
        ids = [s["id"] for s in self.strategies]
        self.assertEqual(len(ids), len(set(ids)))
        for s in self.strategies:
            for key in ("title", "summary", "profession", "sources"):
                self.assertTrue(s.get(key), f"{s['id']}: brak {key}")
            self.assertIn(s.get("tier"), (None, "S", "A", "B"))

    def test_every_source_has_url_and_reliability(self):
        for s in self.strategies:
            for src in s["sources"]:
                self.assertTrue(src["url"].startswith("https://"))
                self.assertIn(src["reliability"], ("wysoka", "średnia", "niska"))

    def test_item_names_exist_in_catalog(self):
        missing = [i["name"] for s in self.strategies for i in s.get("items", []) if i["name"] not in self.names]
        self.assertEqual(missing, [])

    def test_check_professions_are_known(self):
        for s in self.strategies:
            check = s.get("check")
            if check and check["type"] == "topRecipes":
                self.assertIn(check["profession"], self.professions)

    def test_every_crafting_profession_covered(self):
        covered = {s["profession"] for s in self.strategies}
        for p in ("Tailoring", "Alchemy", "Jewelcrafting", "Enchanting", "Mining", "Herbalism", "Skinning",
                  "Leatherworking", "Blacksmithing", "Engineering"):
            self.assertIn(p, covered)


if __name__ == "__main__":
    unittest.main()
