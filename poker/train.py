#!/usr/bin/env python3
"""Train a strategy by self-play.   python train.py leduc --iters 2000"""
import argparse, time
from pokerai import kuhn, leduc
from pokerai.cfr import CFRPlus, save_strategy
from pokerai.exploit import exploitability, game_value

GAMES = {"kuhn": kuhn.root, "leduc": leduc.root}

ap = argparse.ArgumentParser()
ap.add_argument("game", choices=GAMES)
ap.add_argument("--iters", type=int, default=1000)
ap.add_argument("--every", type=int, default=100)
ap.add_argument("--out")
a = ap.parse_args()

root = GAMES[a.game]()
solver = CFRPlus(root)
t0 = time.time()

def report(s):
    st = s.average_strategy()
    print(f"iter {s.t:6d}  exploitability {exploitability(root, st):.5f}  value(p0) {game_value(root, st):+.4f}  {time.time()-t0:.0f}s", flush=True)

solver.train(a.iters, report, a.every)
out = a.out or f"strategies/{a.game}.json"
save_strategy(solver.average_strategy(), out)
print("saved", out)
