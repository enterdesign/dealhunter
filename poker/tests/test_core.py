import unittest
import trainer_core as c


class Core(unittest.TestCase):
    def test_parse_count(self):
        self.assertEqual(c.parse_count("3e9"), 3_000_000_000)
        self.assertEqual(c.parse_count("500M"), 500_000_000)
        self.assertEqual(c.parse_count("3G"), 3_000_000_000)
        self.assertEqual(c.parse_count("20_000"), 20000)
        self.assertEqual(c.parse_count("1 000 000"), 1000000)

    def test_slots_gb(self):
        self.assertAlmostEqual(c.slots_gb(28), 2 ** 28 * 72 / 1e9)

    def test_sizes(self):
        self.assertEqual(c.parse_sizes("0.33, 0.75,1.5"), [0.33, 0.75, 1.5])
        for bad in ("", "0", "1,2,3,4,5", "a"):
            with self.assertRaises(ValueError):
                c.parse_sizes(bad)

    def test_commands(self):
        p = dict(players=6, stack=100, buckets=30, eqsamples=100, maxraises=3, sizes="0.33, 0.75", slots=28, iters="3G", threads=14, out="s.bin")
        cmd = c.train_command("./holdem", p)
        self.assertIn("--stack", cmd)
        self.assertEqual(cmd[cmd.index("--sizes") + 1], "0.33,0.75")
        self.assertEqual(cmd[cmd.index("--post-sizes") + 1], "0.33,0.75")
        self.assertEqual(cmd[cmd.index("--players") + 1], "6")
        self.assertEqual(cmd[cmd.index("--iters") + 1], "3000000000")
        r = c.train_command("./holdem", p, resume=True)
        self.assertEqual(r[2:4], ["--resume", "s.bin.ckpt"])
        self.assertNotIn("--stack", r)

    def test_presets_are_valid(self):
        for name, pr in c.PRESETS.items():
            p = dict(pr, threads=2, out="x.bin")
            cmd = c.train_command("./h", p)
            self.assertIn("--players", cmd, name)
            self.assertTrue(2 <= pr["players"] <= 6, name)
            self.assertLess(c.slots_gb(pr["slots"]), 40, name)

    def test_every_preset_has_a_description(self):
        self.assertEqual(set(c.PRESETS), set(c.PRESET_INFO))
        for name, text in c.PRESET_INFO.items():
            self.assertIn("RAM", text, name)
            self.assertIn("Czas", text, name)

    def test_eval_line(self):
        e = c.parse_eval("EVAL iter 3000000: current vs snapshot from iter 2000000: -30.9 mbb/hand (+-54.2)")
        self.assertEqual((e["iters"], e["prev"], e["mbb"], e["ci"]), (3000000, 2000000, -30.9, 54.2))
        self.assertIsNone(c.parse_eval("round 1 iter 5"))

    def test_eval_every_in_command(self):
        p = dict(stack=20, buckets=24, eqsamples=100, maxraises=3, sizes="0.5,1", slots=20, iters="1G", threads=2, out="s.bin", evalevery="50M")
        cmd = c.train_command("./h", p)
        self.assertEqual(cmd[cmd.index("--eval-every") + 1], "50000000")

    def test_progress(self):
        line = "round 12  iter 12000000  infosets 5300511 (32% of table)  12097 it/s  89s"
        pr = c.parse_progress(line)
        self.assertEqual((pr["iters"], pr["infosets"], pr["rate"], pr["fill"]), (12000000, 5300511, 12097, 32.0))
        self.assertIsNone(c.parse_progress("saved x"))
        self.assertEqual(c.fmt_eta(0, 3600 * 10, 10), "1h 00m")


if __name__ == "__main__":
    unittest.main()
