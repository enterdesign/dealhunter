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

## GUI

```
python gui.py          # Python 3 with tkinter (included in the python.org installer for Windows)
```
Set parameters (or pick a preset), press **Start new training**, watch progress/ETA, **Stop and save** any time,
**Resume** later, **Evaluate** against baseline bots, **Play** against the bot. It drives the `holdem` program below
(press *Build (g++)* once, or download the Windows build from the GitHub Actions run).

## No-limit Texas hold'em (`holdem/`)

Heads-up, fixed stack depth (default **20 big blinds**), single C++ file, no dependencies.

```
cd holdem
g++ -O3 -march=native -std=c++17 -pthread holdem.cpp -o holdem    # Windows: MinGW-w64 (or WSL)
./holdem test                                # evaluator, abstraction and game-rule checks
./holdem train --stack 20 --iters 8000000 --threads 8 --out s20.bin
./holdem play s20.bin                        # play against the bot (pick actions by number)
./holdem eval s20.bin --hands 100000         # bot vs simple baseline bots
./holdem compare new.bin old.bin --hands 200000   # which of two strategies is stronger (duplicate-style, seats swapped)
```

Is more training better? Save a snapshot (GUI button), train on, then `compare` the new file with the snapshot:
a clearly positive result (beyond the printed +-) means the extra training helped; around 0 means it has converged for this abstraction.

Deeper stacks (long run, e.g. overnight on a Ryzen 7800X3D, 16 threads):
```
./holdem train --stack 100 --iters 3000000000 --threads 14 --slots 28 \
               --buckets 30 --sizes 0.33,0.75,1.5 --out s100.bin
```
- `--slots N` = hash table of 2^N info sets, 72 bytes each (26 -> 4.8 GB, 27 -> 9.7 GB, 28 -> 19 GB; with 64 GB RAM use 28). Training stops when it is 85% full. 100 bb with 3 sizes grows to several million info sets within the first million iterations.
- Ctrl+C (or the GUI's Stop button, or creating `<out>.stop`) saves and stops. Progress is also saved every 10 minutes to `s100.bin` (play file) and `s100.bin.ckpt` (full training state).
- Continue later: `./holdem train --resume s100.bin.ckpt --iters 6000000000 --threads 14 --slots 26 --out s100.bin`
- Other options: `--maxraises 3`, `--eqsamples 100`, up to 4 `--sizes` (fractions of the pot).
- GPU is not used: this algorithm is branchy and memory bound, the CPU is the right tool.
- Don't commit big `.bin`/`.ckpt` files.

How it works:
- **Training**: external-sampling Monte Carlo CFR (self-play), multithreaded lock-free ("hogwild"), linear averaging of strategies; ~6000 iterations/s per core at 20 bb.
- **Card abstraction**: preflop = 169 lossless hand classes; flop/turn/river = equity buckets (default 24) by hand equity vs a random hand.
- **Action abstraction**: fold, call/check, raises of configurable pot fractions (default 0.5x and 1x pot) or all-in; at most 3 raises per street. You can only choose from the bot's bet sizes (no free-form amounts yet).
- Button/blind positions alternate each hand; stacks reset every hand (cash-game style).

Limits (be realistic): this is a *solved-ish simplified* game, not a full no-limit solver. The bot is strong against weak and
average players at 20 bb, but a good opponent can find leaks because of the abstraction (similar hands are merged,
bet sizes are limited, deeper stacks and 4-bet+ lines are cut). There is no exploitability number for a game this size;
quality is measured by results against baseline bots and, best of all, against real opponents (many hundreds of hands, because poker variance is huge).

## Layout
- `pokerai/kuhn.py`, `pokerai/leduc.py`: games (one common interface)
- `pokerai/cfr.py`: CFR+ solver; `pokerai/exploit.py`: exact exploitability / game value
- `gui.py` + `trainer_core.py`: tkinter front end (logic unit-tested in `tests/test_core.py`)
- `train.py`, `play.py`, `tests/`: Kuhn/Leduc tools (Python)
- `holdem/holdem.cpp`: heads-up no-limit hold'em (C++)
