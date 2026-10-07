"""Logic behind gui.py (no tkinter here, so it can be unit-tested)."""
import os, re, sys

SLOT_BYTES = 72

PRESETS = {
    "Quick test (20 bb)":      dict(stack=20,  buckets=24, eqsamples=100, maxraises=3, sizes="0.5,1.0",       slots=22, iters="20M"),
    "20 bb, thorough (finer cards)": dict(stack=20, buckets=50, eqsamples=150, maxraises=3, sizes="0.5,1.0", slots=25, iters="1G"),
    "Medium (40 bb)":          dict(stack=40,  buckets=30, eqsamples=100, maxraises=3, sizes="0.5,1.0",       slots=25, iters="500M"),
    "Deep (100 bb, overnight)": dict(stack=100, buckets=30, eqsamples=100, maxraises=3, sizes="0.33,0.75,1.5", slots=28, iters="3G"),
}


def parse_count(text):
    """'3e9', '3G', '500M', '20_000', '1 000 000' -> int"""
    t = text.strip().replace("_", "").replace(" ", "").replace(",", "")
    mult = {"k": 10**3, "m": 10**6, "g": 10**9, "b": 10**9}
    if t and t[-1].lower() in mult:
        return int(float(t[:-1]) * mult[t[-1].lower()])
    return int(float(t))


def slots_gb(log_slots):
    return (2 ** int(log_slots)) * SLOT_BYTES / 1e9


def parse_sizes(text):
    vals = [float(x) for x in text.replace(" ", "").split(",") if x]
    if not 1 <= len(vals) <= 4 or any(v <= 0 for v in vals):
        raise ValueError("bet sizes: 1-4 positive numbers separated by commas, e.g. 0.33,0.75,1.5")
    return vals


def train_command(binary, p, resume=False):
    iters = str(parse_count(p["iters"]))
    base = [binary, "train", "--iters", iters, "--threads", str(int(p["threads"])), "--slots", str(int(p["slots"])), "--out", p["out"]]
    if resume:
        return [binary, "train", "--resume", p["out"] + ".ckpt"] + base[2:]
    parse_sizes(p["sizes"])
    return base + ["--stack", str(int(p["stack"])), "--buckets", str(int(p["buckets"])),
                   "--eqsamples", str(int(p["eqsamples"])), "--maxraises", str(int(p["maxraises"])),
                   "--sizes", p["sizes"].replace(" ", "")]


PROGRESS = re.compile(r"round (\d+)\s+iter (\d+)\s+infosets (\d+) \(([\d.]+)% of table\)\s+(\d+) it/s\s+(\d+)s")


def parse_progress(line):
    m = PROGRESS.search(line)
    if not m:
        return None
    r, it, n, fill, rate, sec = m.groups()
    return dict(round=int(r), iters=int(it), infosets=int(n), fill=float(fill), rate=int(rate), seconds=int(sec))


def fmt_eta(done, total, rate):
    if rate <= 0 or done >= total:
        return "-"
    s = int((total - done) / rate)
    return f"{s // 3600}h {s % 3600 // 60:02d}m"


def find_binary(base_dir):
    for name in ("holdem.exe", "holdem"):
        for d in (os.path.join(base_dir, "holdem"), base_dir):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                return p
    return ""


def build_command(base_dir):
    src = os.path.join(base_dir, "holdem", "holdem.cpp")
    out = os.path.join(base_dir, "holdem", "holdem.exe" if sys.platform == "win32" else "holdem")
    return ["g++", "-O3", "-march=native", "-std=c++17", "-pthread", src, "-o", out], out
