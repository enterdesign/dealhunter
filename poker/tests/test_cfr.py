import unittest
from pokerai import kuhn, leduc
from pokerai.cfr import CFRPlus
from pokerai.exploit import exploitability, game_value


class Games(unittest.TestCase):
    def test_leduc_terminals_zero_sum(self):
        def walk(s):
            if s.is_terminal():
                self.assertEqual(s.utility(0), -s.utility(1))
                return 1
            if s.player() == -1:
                return sum(walk(s.apply(a)) for a, _ in s.chance_outcomes())
            return sum(walk(s.apply(a)) for a in s.legal_actions())
        self.assertGreater(walk(leduc.root()), 1000)

    def test_chance_probs_sum_to_one(self):
        s = leduc.root()
        self.assertAlmostEqual(sum(p for _, p in s.chance_outcomes()), 1.0)


class Solvers(unittest.TestCase):
    def test_kuhn_converges(self):
        root = kuhn.root()
        solver = CFRPlus(root)
        solver.train(3000)
        st = solver.average_strategy()
        self.assertLess(exploitability(root, st), 0.01)
        self.assertAlmostEqual(game_value(root, st), -1 / 18, places=2)

    def test_uniform_is_exploitable(self):
        self.assertGreater(exploitability(kuhn.root(), {}), 0.1)

    def test_leduc_improves(self):
        root = leduc.root()
        solver = CFRPlus(root)
        before = exploitability(root, {})
        solver.train(100)
        after = exploitability(root, solver.average_strategy())
        self.assertLess(after, before / 3)


if __name__ == "__main__":
    unittest.main()
