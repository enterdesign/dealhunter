"""Kuhn poker: 3 cards (0<1<2), 1 ante each, one bet of 1. Actions: 'p' pass (check/fold), 'b' bet (bet/call).

Generic game interface used by cfr.py / exploit.py:
  state.is_terminal(), state.utility(p), state.player() (0, 1 or -1 = chance),
  state.chance_outcomes(), state.legal_actions(), state.apply(a), state.infoset(p)
"""
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass(frozen=True)
class KuhnState:
    cards: Tuple[int, ...] = ()
    history: str = ""

    def is_terminal(self) -> bool:
        h = self.history
        return h in ("pp", "bp", "bb", "pbp", "pbb")

    def player(self) -> int:
        if len(self.cards) < 2:
            return -1
        return len(self.history) % 2

    def chance_outcomes(self):
        left = [c for c in range(3) if c not in self.cards]
        return [(c, 1 / len(left)) for c in left]

    def legal_actions(self):
        return ["p", "b"]

    def apply(self, a):
        if self.player() == -1:
            return KuhnState(self.cards + (a,), self.history)
        return KuhnState(self.cards, self.history + a)

    def infoset(self, p: int) -> str:
        return f"{self.cards[p]}|{self.history}"

    def utility(self, p: int) -> float:
        h, c = self.history, self.cards
        if h == "bp":
            u0 = 1
        elif h == "pbp":
            u0 = -1
        else:
            win = 1 if c[0] > c[1] else -1
            u0 = win * (2 if "b" in h else 1)
        return u0 if p == 0 else -u0


def root() -> KuhnState:
    return KuhnState()
