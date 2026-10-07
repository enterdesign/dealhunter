# pokerai

Poker bot learned by **self-play** (CFR, a game-theory algorithm), for 2 to 6 players at the table.
No hand histories are needed: the bot computes a strategy by playing against itself.

## What is in here
| Part | What it does |
|---|---|
| `holdem/holdem.cpp` | **No-limit Texas hold'em, 2-6 players**: training, play, evaluation (C++, no dependencies) |
| `gui.py` | window to set parameters, train, stop, resume, evaluate, compare, play |
| `pokerai/`, `train.py`, `play.py` | small teaching games (Kuhn, Leduc) with exact exploitability |
| `strategies/hu_20bb.bin` | ready heads-up bot, 20 big blinds |
| `PLAN.md` | design and honest limits, read this first |

## Quick start (Windows ZIP)
- `PLAY_20bb.bat`: play the ready heads-up bot (no Python needed).
- `START_GUI.bat`: the GUI (needs Python 3 with tkinter). Pick a preset, press *Start new training*.
- Command line: see below. `QUICKSTART_PL.txt` has the same in Polish.

## holdem command line
```
cd holdem
g++ -O3 -march=native -std=c++17 -pthread holdem.cpp -o holdem    # Windows: MinGW-w64 (or WSL)
./holdem test                                  # evaluator, side pots, game rules for 2..6 players
./holdem train --players 6 --stack 20 --buckets 12 --sizes 1.0 --post-sizes 1.0 --maxraises 2 --post-maxraises 2 \
               --iters 300000000 --threads 14 --slots 25 --eval-every 50000000 --out s6.bin
./holdem play s6.bin                           # you against N-1 bots (your seat rotates every hand)
./holdem eval s6.bin --hands 100000            # bot vs simple baseline bots
./holdem compare new.bin old.bin --hands 100000   # one copy of A against N-1 copies of B
```
- Ctrl+C (or the GUI's Stop button, or creating `<out>.stop`) saves and stops. Progress is also saved every 10 minutes
  to `<out>` (play file) and `<out>.ckpt` (full training state). Continue with `--resume <out>.ckpt --iters <bigger total>`.
- `--slots N` = hash table of 2^N info sets, 72 bytes each (25 -> 2.4 GB, 27 -> 9.7 GB, 28 -> 19 GB). Training stops at 85% full.
- GPU is not used: this algorithm is branchy and memory bound, the CPU is the right tool.
- Don't commit big `.bin` / `.ckpt` files.

## How it works
- **Training**: external-sampling Monte Carlo CFR. Every iteration deals random cards and walks the game for every player:
  at the player's own decisions all actions are tried and the *regret* (how much better the alternative would have been) is
  recorded; at the other players' decisions one action is sampled from their current strategy. Actions with regret get more
  probability next time. The strategy you play is the **average over all iterations** (that is what converges).
  Multithreaded lock-free ("hogwild"), linear averaging.
- **Card abstraction**: preflop = 169 lossless hand classes; flop/turn/river = equity buckets against the number of live opponents.
- **Action abstraction**: fold, call/check, raises of configurable pot fractions (separately preflop and postflop) or all-in,
  limited number of raises per street. Side pots are handled.
- **Seats**: 0 = button, 1 = small blind, 2 = big blind, then UTG, HJ, CO. Heads-up: button = small blind.
- **Progress check**: `--eval-every N` plays the current strategy against a snapshot of itself from the previous check and
  prints `EVAL ...` lines: clearly positive = still improving, around 0 = converged for these settings.

## GUI presets
| Preset | Players | Stack | What it is | Rough time (14 threads) | RAM |
|---|---|---|---|---|---|
| Heads-up 20 bb - quick test | 2 | 20 bb | check that everything works; about as strong as the included `hu_20bb.bin` | ~5 min | 0.3 GB |
| Heads-up 20 bb - thorough | 2 | 20 bb | finer card buckets (50), for a properly trained heads-up bot | ~6-8 h | 2.4 GB |
| Heads-up 100 bb (overnight) | 2 | 100 bb | deep stacks, 3 bet sizes, much bigger game | ~10-20 h | 19 GB |
| 3-handed 20 bb | 3 | 20 bb | BTN/SB/BB, saturates at ~0.5 M info sets | ~1-2 h | 1.2 GB |
| 6-max 20 bb - lite (fast) | 6 | 20 bb | 1 bet size, 2 raises per street, ~2 M info sets | ~1-2 h | 2.4 GB |
| 6-max 20 bb - standard (overnight) | 6 | 20 bb | 2 preflop sizes, grows to tens of millions of info sets | ~15-20 h | 19 GB |

Times are very rough (measured on 4 threads, scaled linearly). Stop any time with *Stop and save*; the "progress check" line
tells you whether more training still helps. The preset description is also shown in the GUI.

## Honest limits
See `PLAN.md`. Short version: heads-up is theoretically sound; with 3+ players CFR has no convergence guarantee (it works
well in practice, e.g. Pluribus, but that took a supercomputer and live search). The 6-player bots here use a small
game (20 bb stacks, few bet sizes) so they can be trained on one PC. Don't expect a professional-level 6-max 100 bb bot.
