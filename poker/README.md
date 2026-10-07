# pokerai

Poker bot learned by **self-play** (CFR+), to play 1v1 against a human in the terminal.
No hand histories needed: the bot computes an (approximate) Nash equilibrium strategy.

## Run

```
python3 train.py leduc --iters 10000     # ~70 s, saves strategies/leduc.json
python3 play.py leduc                    # play against it (f = fold, c = check/call, r = bet/raise)
python3 -m unittest discover -s tests -t .
```

No dependencies (pure Python 3).

## Status
| Game | Status |
|---|---|
| Kuhn poker (3 cards) | solved, exploitability ~0.002, value -0.0558 (theory: -1/18) |
| Leduc hold'em (6 cards, 2 rounds) | exploitability ~0.01 after 10k iterations, value -0.0857 (known value ~ -0.0856) |
| Heads-up Texas hold'em | **not started** (see below) |

*Exploitability* = how much a perfect opponent could win per hand against the strategy (0 = unbeatable).
Since the bot plays an equilibrium, it can't be beaten in the long run, but in a few dozen hands a human can still win by luck.

## Next: real Texas hold'em
The current code solves the whole game tree, which only works for tiny games. For heads-up hold'em we need:
1. A hold'em game implementation (hand evaluator, betting rules; use a small set of bet sizes, short stacks).
2. **Card abstraction** (bucket hands by equity) and **Monte Carlo CFR** (sampling instead of full traversal).
3. A benchmark: win rate in mbb/hand vs. simple bots (random, always-call), needing tens of thousands of hands for a reliable number.
A strong full no-limit bot needs far more compute; a restricted version should beat weak players.

## Layout
- `pokerai/kuhn.py`, `pokerai/leduc.py`: games (one common interface)
- `pokerai/cfr.py`: CFR+ solver; `pokerai/exploit.py`: exact exploitability / game value
- `train.py`, `play.py`, `tests/`
