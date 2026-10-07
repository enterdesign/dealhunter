# Plan and limits

## Goal
A poker bot you can play against and that gets better with training on one PC, for **more than 2 players** (up to 6-max).

## What is solid
- Heads-up (2 players) zero-sum: CFR converges to a Nash equilibrium of the *abstracted* game. Strong bot at 20 bb is realistic.
- Engine: side pots, order of action, position, tested (`holdem test`, random playouts for 2..6 players, zero-sum checks).

## What is not
1. **3+ players**: no theoretical guarantee. In practice self-play CFR gives good strategies (Pluribus, 2019), but:
   - Pluribus used 12,400 core-hours for the blueprint **and** real-time search during play. We only have the blueprint.
   - There is no meaningful "exploitability number" for 3+ players. Quality is measured by results (vs. baseline bots, vs. older snapshots, vs. you).
2. **Size of the game**: every extra player multiplies the number of betting sequences. 6 players at 20 bb with 2 bet sizes
   and 3 raises per street has tens of millions of info sets and keeps growing; the "lite" preset (1 size, 2 raises, 12 buckets)
   saturates around 2 million info sets and is trainable in hours. 100 bb 6-max is out of reach for this approach on one PC.
3. **Abstraction**: similar hands are merged, bet sizes are limited. A good human can find leaks. Off-menu bet sizes of a human
   are not supported yet: in `play` you choose from the bots' sizes.
4. Stacks are equal and reset every hand (cash-game style, no tournament/ICM).

## Roadmap (in this order)
1. Done: N-player engine, MCCFR training, resume, progress check vs previous snapshot, compare, GUI.
2. Next, if the 6-max lite bot looks sensible: standard preset (2 preflop sizes), longer training, check with `compare`.
3. Later: real-time search for the later streets (this is what made Pluribus strong), action translation so you can bet any amount,
   deeper stacks for fewer players (3-handed 40 bb).

## How to judge progress
- `EVAL` lines during training (current vs previous snapshot).
- `holdem compare new.bin old.bin`.
- `holdem eval` against simple bots (necessary but weak test).
- Play it. A few hundred hands is the minimum for any conclusion; poker variance is huge.
