"""Test tools/build_data.py na maleńkich, sztucznych tabelach CSV (nie są to prawdziwe dane gry)."""
import csv
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import build_data  # noqa: E402


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


class BuildDataTests(unittest.TestCase):
    def make_raw(self, root):
        write_csv(root / "ItemSparse.csv", ["ID", "Display_lang", "SellPrice", "OverallQualityID", "ItemLevel", "Bonding"],
                  [[10, "Ore", 50, 1, 0, 0], [11, "Bar", 200, 1, 0, 0], [12, "Soulbound Thing", 0, 4, 70, 1], [13, "", 0, 1, 0, 0]])
        write_csv(root / "SpellEffect.csv", ["ID", "DifficultyID", "EffectIndex", "Effect", "EffectBasePoints", "EffectItemType", "SpellID"],
                  [[1, 0, 0, 24, 0, 11, 100],      # receptura 100 -> 1x Bar
                   [2, 0, 0, 24, 2, 11, 101],      # receptura 101 -> 3x Bar
                   [3, 0, 0, 24, 0, 12, 102],      # receptura 102 -> przedmiot BoP
                   [4, 0, 0, 53, 0, 0, 103],       # enchant (nie tworzy przedmiotu)
                   [5, 0, 0, 24, 0, 11, 104]])     # receptura bez składników
        write_csv(root / "SpellReagents.csv", ["ID", "SpellID"] + [f"Reagent_{i}" for i in range(8)] + [f"ReagentCount_{i}" for i in range(8)],
                  [[1, 100, 10] + [0] * 7 + [2] + [0] * 7,
                   [2, 101, 10, 11] + [0] * 6 + [1, 1] + [0] * 6,
                   [3, 102, 10] + [0] * 7 + [1] + [0] * 7,
                   [4, 103, 10] + [0] * 7 + [1] + [0] * 7])
        write_csv(root / "SkillLineAbility.csv", ["ID", "SkillLine", "Spell", "TrivialSkillLineRankHigh", "TrivialSkillLineRankLow"],
                  [[1, 164, 100, 90, 70], [2, 164, 100, 90, 70],   # duplikat
                   [3, 164, 101, 120, 100], [4, 202, 102, 50, 30],
                   [5, 333, 103, 50, 30], [6, 164, 104, 50, 30],
                   [7, 999, 100, 1, 1]])                           # nieznana linia umiejętności

    def test_build(self):
        with tempfile.TemporaryDirectory() as d:
            raw, out = pathlib.Path(d) / "raw", pathlib.Path(d) / "out"
            raw.mkdir()
            self.make_raw(raw)
            recipes, items = build_data.build(raw, out, "test")
            by_id = {r["id"]: r for r in recipes}
            self.assertEqual(sorted(by_id), [100, 101, 102])
            self.assertEqual(by_id[100]["profession"], "Blacksmithing")
            self.assertEqual((by_id[100]["produces"], by_id[100]["qty"]), (11, 1))
            self.assertEqual(by_id[100]["reagents"], [{"item": 10, "count": 2}])
            self.assertEqual(by_id[100]["skill"], 70)
            self.assertEqual(by_id[100]["grey"], 90)
            self.assertEqual(by_id[101]["qty"], 3)
            self.assertEqual(len(by_id[101]["reagents"]), 2)
            self.assertEqual(by_id[102]["profession"], "Engineering")
            self.assertTrue(items[12]["bop"])
            self.assertNotIn(13, items)  # bez nazwy
            catalog = json.loads((out / "items.json").read_text())
            self.assertEqual(catalog["items"]["11"]["vendorSell"], 200)
            self.assertEqual(catalog["build"], "test")
            self.assertEqual(len(json.loads((out / "recipes.json").read_text())), 3)


if __name__ == "__main__":
    unittest.main()
