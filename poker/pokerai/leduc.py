"""Leduc hold'em: deck J,Q,K x2 suits (ranks 0,1,2), ante 1, one private card each, one public card.
Two betting rounds (bet size 2 then 4), max 2 raises per round. Player 0 acts first each round.
Actions: 'f' fold, 'c' check/call, 'r' bet/raise.
"""
from dataclasses import dataclass
from typing import Optional, Tuple

BET = {1: 2, 2: 4}
MAX_RAISES = 2
RANKS = "JQK"


@dataclass(frozen=True)
class LeducState:
    hole: Tuple[int, ...] = ()
    board: Optional[int] = None
    rnd: int = 1
    contrib: Tuple[int, int] = (1, 1)
    to_act: int = 0
    raises: int = 0
    acts: int = 0            # actions taken in this round
    folded: Optional[int] = None
    over: bool = False       # showdown reached
    history: str = ""

    def is_terminal(self) -> bool:
        return self.folded is not None or self.over

    def player(self) -> int:
        if len(self.hole) < 2 or (self.rnd == 2 and self.board is None):
            return -1
        return self.to_act

    def _remaining(self):
        cards = list(self.hole) + ([self.board] if self.board is not None else [])
        deck = [0, 0, 1, 1, 2, 2]
        for c in cards:
            deck.remove(c)
        return deck

    def chance_outcomes(self):
        deck = self._remaining()
        return [(r, deck.count(r) / len(deck)) for r in sorted(set(deck))]

    def legal_actions(self):
        facing = self.contrib[1 - self.to_act] - self.contrib[self.to_act]
        acts = ["f", "c"] if facing > 0 else ["c"]
        if self.raises < MAX_RAISES:
            acts.append("r")
        return acts

    def apply(self, a):
        if self.player() == -1:
            if len(self.hole) < 2:
                return LeducState(self.hole + (a,))
            return LeducState(self.hole, a, 2, self.contrib, 0, 0, 0, None, False, self.history + "/")
        p = self.to_act
        me, opp = self.contrib[p], self.contrib[1 - p]
        h = self.history + a
        if a == "f":
            return LeducState(self.hole, self.board, self.rnd, self.contrib, p, self.raises, self.acts + 1, p, False, h)
        if a == "r":
            new = list(self.contrib)
            new[p] = opp + BET[self.rnd]
            return LeducState(self.hole, self.board, self.rnd, tuple(new), 1 - p,
                              self.raises + 1, self.acts + 1, None, False, h)
        # check / call
        new = list(self.contrib)
        new[p] = opp if opp > me else me
        ends = opp > me or self.acts >= 1
        if not ends:
            return LeducState(self.hole, self.board, self.rnd, tuple(new), 1 - p, self.raises, self.acts + 1, None, False, h)
        if self.rnd == 1:
            return LeducState(self.hole, None, 2, tuple(new), 0, 0, 0, None, False, h + "/")
        return LeducState(self.hole, self.board, 2, tuple(new), p, self.raises, self.acts + 1, None, True, h)

    def infoset(self, p: int) -> str:
        b = "-" if self.board is None else RANKS[self.board]
        return f"{RANKS[self.hole[p]]}|{b}|{self.history}"

    def utility(self, p: int) -> float:
        c0, c1 = self.contrib
        if self.folded is not None:
            u0 = -c0 if self.folded == 0 else c1
        else:
            r0, r1 = self.hole
            if r0 == self.board:
                u0 = c1
            elif r1 == self.board:
                u0 = -c0
            elif r0 > r1:
                u0 = c1
            elif r1 > r0:
                u0 = -c0
            else:
                u0 = 0
        return u0 if p == 0 else -u0


def root() -> LeducState:
    return LeducState()
