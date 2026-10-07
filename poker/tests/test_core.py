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
        p = dict(stack=100, buckets=30, eqsamples=100, maxraises=3, sizes="0.33, 0.75", slots=28, iters="3G", threads=14, out="s.bin")
        cmd = c.train_command("./holdem", p)
        self.assertIn("--stack", cmd)
        self.assertEqual(cmd[cmd.index("--sizes") + 1], "0.33,0.75")
        self.assertEqual(cmd[cmd.index("--iters") + 1], "3000000000")
        r = c.train_command("./holdem", p, resume=True)
        self.assertEqual(r[2:4], ["--resume", "s.bin.ckpt"])
        self.assertNotIn("--stack", r)

    def test_progress(self):
        line = "round 12  iter 12000000  infosets 5300511 (32% of table)  12097 it/s  89s"
        pr = c.parse_progress(line)
        self.assertEqual((pr["iters"], pr["infosets"], pr["rate"], pr["fill"]), (12000000, 5300511, 12097, 32.0))
        self.assertIsNone(c.parse_progress("saved x"))
        self.assertEqual(c.fmt_eta(0, 3600 * 10, 10), "1h 00m")


if __name__ == "__main__":
    unittest.main()
