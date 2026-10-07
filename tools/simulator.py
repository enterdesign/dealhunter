#!/usr/bin/env python3
"""Fake SimHub: sends telemetry + standings in the flightware line protocol.

  python tools/simulator.py --print            # just show the lines
  python tools/simulator.py --port COM5        # send to the ESP32 (needs `pip install pyserial`)
"""
import argparse, math, sys, time

NAMES = ["M. Verstappen", "L. Norris", "C. Leclerc", "L. Hamilton",
         "G. Russell", "F. Alonso", "O. Piastri", "You"]

def telemetry(t):
    rpm = 4000 + 3800 * (0.5 + 0.5 * math.sin(t * 1.3))
    gear = 1 + int((rpm - 4000) / 760) % 6
    return "D;%d;%d;8200;%d;%d;%d;%d;22" % (60 + rpm / 40, rpm, gear, max(0, 100 - t / 3), 1 + int(t / 90), 3)

def standings(t):
    return ["S;%d;%d;%s;%s" % (i, i + 1, n, "Leader" if i == 0 else "+%.3f" % (i * 1.7 + math.sin(t) * .2))
            for i, n in enumerate(NAMES)]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port"); ap.add_argument("--print", action="store_true")
    a = ap.parse_args()
    out = None
    if a.port:
        import serial; out = serial.Serial(a.port, 115200)
    elif not a.print:
        sys.exit("give --port or --print")
    t0, tick = time.time(), 0
    while True:
        t = time.time() - t0
        lines = [telemetry(t)] + (standings(t) if tick % 15 == 0 else [])
        for l in lines:
            if out: out.write((l + "\n").encode())
            else: print(l)
        tick += 1; time.sleep(1 / 30)

if __name__ == "__main__":
    main()
