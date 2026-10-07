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
| Heads-up **no-limit Texas hold'em** | `holdem/holdem.cpp`, C++ (see below) |

*Exploitability* = how much a perfect opponent could win per hand against the strategy (0 = unbeatable).
Since the bot plays an equilibrium, it can't be beaten in the long run, but in a few dozen hands a human can still win by luck.

## No-limit Texas hold'em (`holdem/`)

Heads-up, fixed stack depth (default **20 big blinds**), single C++ file, no dependencies.

```
cd holdem
g++ -O3 -std=c++17 holdem.cpp -o holdem      # on Windows: MinGW-w64 or WSL
./holdem test                                # evaluator, abstraction and game-rule checks
./holdem train --iters 8000000 --out strategy.bin
./holdem play strategy.bin                   # play against the bot (pick actions by number)
./holdem eval strategy.bin --hands 100000    # bot vs simple baseline bots
```

How it works:
- **Training**: external-sampling Monte Carlo CFR (self-play), ~6000 iterations/s per core.
- **Card abstraction**: preflop = 169 lossless hand classes; flop/turn/river = 24 buckets by hand equity vs a random hand.
- **Action abstraction**: fold, call/check, raise to 0.5x pot, 1x pot, or all-in; at most 3 raises per street. You can only choose from the bot's bet sizes (no free-form amounts yet).
- Button/blind positions alternate each hand; stacks reset to 20 bb every hand (cash-game style).

Limits (be realistic): this is a *solved-ish simplified* game, not a full no-limit solver. The bot is strong against weak and
average players at 20 bb, but a good opponent can find leaks because of the abstraction (similar hands are merged,
bet sizes are limited, deeper stacks and 4-bet+ lines are cut). There is no exploitability number for a game this size;
quality is measured by results against baseline bots and, best of all, against real opponents (many hundreds of hands, because poker variance is huge).

## Layout
- `pokerai/kuhn.py`, `pokerai/leduc.py`: games (one common interface)
- `pokerai/cfr.py`: CFR+ solver; `pokerai/exploit.py`: exact exploitability / game value
- `train.py`, `play.py`, `tests/`: Kuhn/Leduc tools (Python)
- `holdem/holdem.cpp`: heads-up no-limit hold'em (C++)
