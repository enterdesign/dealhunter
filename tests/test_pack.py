"""ZIP addona na stronie (docs/DealHunterAH.zip) musi odpowiadać plikom w addon/DealHunterAH."""
import pathlib
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon" / "DealHunterAH"
ZIP = ROOT / "docs" / "DealHunterAH.zip"


class PackTests(unittest.TestCase):
    def test_zip_matches_addon_sources(self):
        with zipfile.ZipFile(ZIP) as z:
            names = sorted(z.namelist())
            expected = sorted(f"DealHunterAH/{p.relative_to(ADDON).as_posix()}" for p in ADDON.rglob("*") if p.is_file())
            self.assertEqual(names, expected, "uruchom: python3 tools/pack_addon.py")
            for name in names:
                self.assertEqual(z.read(name), (ADDON / name.split("/", 1)[1]).read_bytes(), name)

    def test_zip_has_toc_in_addon_folder(self):
        with zipfile.ZipFile(ZIP) as z:
            self.assertIn("DealHunterAH/DealHunterAH.toc", z.namelist())


if __name__ == "__main__":
    unittest.main()
