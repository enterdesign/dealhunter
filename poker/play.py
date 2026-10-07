#!/usr/bin/env python3
"""Play against the bot in the terminal.   python play.py leduc
Leduc: you and the bot get 1 private card (J<Q<K); a public card comes after round 1;
pair with the public card beats high card. Actions: f = fold, c = check/call, r = bet/raise."""
import argparse, random
from pokerai import kuhn, leduc
from pokerai.cfr import load_strategy, sample_action

GAMES = {"kuhn": kuhn, "leduc": leduc}
NAMES = {"kuhn": "JQK", "leduc": "JQK"}

ap = argparse.ArgumentParser()
ap.add_argument("game", choices=GAMES)
ap.add_argument("--strategy")
ap.add_argument("--seed", type=int)
a = ap.parse_args()

rng = random.Random(a.seed)
strat = load_strategy(a.strategy or f"strategies/{a.game}.json")
mod = GAMES[a.game]
human, total, hands = 0, 0.0, 0

def deal(s):
    while s.player() == -1:
        outs = s.chance_outcomes()
        s = s.apply(rng.choices([o for o, _ in outs], weights=[p for _, p in outs])[0])
    return s

print("q = quit. Positive total = you are ahead.\n")
while True:
    human = hands % 2          # alternate who acts first
    s = deal(mod.root())
    hands += 1
    print(f"--- hand {hands} (you act {'first' if human == 0 else 'second'}) | your card: {NAMES[a.game][s.cards[human] if a.game == 'kuhn' else s.hole[human]]}")
    while not s.is_terminal():
        if s.player() == -1:
            s = deal(s)
            print("board:", leduc.RANKS[s.board])
            continue
        acts = s.legal_actions()
        if s.player() == human:
            if a.game == "leduc":
                print(f"  pot you/bot: {s.contrib[human]}/{s.contrib[1-human]}  history: {s.history or '-'}")
            while True:
                ch = input(f"  your move {acts}: ").strip().lower()
                if ch == "q":
                    raise SystemExit(f"\nresult after {hands-1} hands: {total:+.1f}")
                if ch in acts:
                    break
            s = s.apply(ch)
        else:
            act = sample_action(strat, s.infoset(1 - human), acts, rng)
            print("  bot:", act)
            s = s.apply(act)
    u = s.utility(human)
    total += u
    if a.game == "leduc" and s.folded is None:
        print(f"  showdown: you {leduc.RANKS[s.hole[human]]}, bot {leduc.RANKS[s.hole[1-human]]}, board {leduc.RANKS[s.board]}")
    print(f"  result: {u:+.0f}   total: {total:+.1f}\n")
