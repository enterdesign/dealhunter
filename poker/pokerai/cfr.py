"""CFR+ (regret floor + linear averaging) with full tree traversal, for small games (Kuhn, Leduc)."""
import json
import random
from collections import defaultdict


class CFRPlus:
    def __init__(self, root):
        self.root = root
        self.regret = defaultdict(lambda: None)
        self.strat_sum = defaultdict(lambda: None)
        self.t = 0

    def _strategy(self, key, n):
        r = self.regret[key]
        if r is None:
            r = self.regret[key] = [0.0] * n
            self.strat_sum[key] = [0.0] * n
        total = sum(r)
        return [x / total for x in r] if total > 0 else [1.0 / n] * n

    def _walk(self, s, pi0, pi1, pic):
        """Returns expected utility for player 0."""
        if s.is_terminal():
            return s.utility(0)
        p = s.player()
        if p == -1:
            return sum(prob * self._walk(s.apply(a), pi0, pi1, pic * prob) for a, prob in s.chance_outcomes())
        acts = s.legal_actions()
        key = s.infoset(p)
        strat = self._strategy(key, len(acts))
        utils = []
        for a, pr in zip(acts, strat):
            if p == 0:
                utils.append(self._walk(s.apply(a), pi0 * pr, pi1, pic))
            else:
                utils.append(self._walk(s.apply(a), pi0, pi1 * pr, pic))
        node = sum(pr * u for pr, u in zip(strat, utils))
        my, opp = (pi0, pi1) if p == 0 else (pi1, pi0)
        sign = 1 if p == 0 else -1
        reg, ss = self.regret[key], self.strat_sum[key]
        for i in range(len(acts)):
            reg[i] = max(0.0, reg[i] + opp * pic * sign * (utils[i] - node))
            ss[i] += self.t * my * strat[i]
        return node

    def train(self, iterations, callback=None, every=100):
        for _ in range(iterations):
            self.t += 1
            self._walk(self.root, 1.0, 1.0, 1.0)
            if callback and self.t % every == 0:
                callback(self)

    def average_strategy(self):
        """infoset -> list of action probabilities (same order as legal_actions())."""
        out = {}
        for key, ss in self.strat_sum.items():
            tot = sum(ss)
            out[key] = [x / tot for x in ss] if tot > 0 else [1.0 / len(ss)] * len(ss)
        return out


def save_strategy(strategy, path):
    with open(path, "w") as f:
        json.dump(strategy, f)


def load_strategy(path):
    with open(path) as f:
        return json.load(f)


def sample_action(strategy, key, actions, rng=random):
    probs = strategy.get(key) or [1.0 / len(actions)] * len(actions)
    return rng.choices(actions, weights=probs)[0]
