"""Logic behind gui.py (no tkinter here, so it can be unit-tested)."""
import os, re, sys

SLOT_BYTES = 72

def _p(players, stack, buckets, sizes, post, maxr, pmaxr, slots, iters, evalevery, eqs=100):
    return dict(players=players, stack=stack, buckets=buckets, eqsamples=eqs, maxraises=maxr, postmaxraises=pmaxr,
                sizes=sizes, postsizes=post, slots=slots, iters=iters, evalevery=evalevery)


PRESETS = {
    "Heads-up 20 bb - quick test":          _p(2, 20, 24, "0.5,1.0", "0.5,1.0", 3, 3, 22, "20M", "5M"),
    "Heads-up 20 bb - thorough":            _p(2, 20, 50, "0.5,1.0", "0.5,1.0", 3, 3, 25, "1G", "100M", 150),
    "Heads-up 100 bb (overnight)":          _p(2, 100, 30, "0.33,0.75,1.5", "0.33,0.75,1.5", 3, 3, 28, "3G", "200M"),
    "3-handed 20 bb":                       _p(3, 20, 16, "0.5,1.0", "0.5,1.0", 3, 3, 27, "500M", "50M"),
    "6-max 20 bb - lite (fast)":            _p(6, 20, 12, "1.0", "1.0", 2, 2, 25, "300M", "50M"),
    "6-max 20 bb - standard (overnight)":   _p(6, 20, 12, "0.5,1.0", "1.0", 3, 2, 28, "3G", "200M"),
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
    ev = parse_count(p.get("evalevery", "0") or "0")
    base = [binary, "train", "--iters", iters, "--threads", str(int(p["threads"])), "--slots", str(int(p["slots"])), "--out", p["out"],
            "--eval-every", str(ev)]
    if resume:
        return [binary, "train", "--resume", p["out"] + ".ckpt"] + base[2:]
    parse_sizes(p["sizes"])
    post = p.get("postsizes") or p["sizes"]
    parse_sizes(post)
    return base + ["--players", str(int(p.get("players", 2))), "--stack", str(int(p["stack"])), "--buckets", str(int(p["buckets"])),
                   "--eqsamples", str(int(p["eqsamples"])), "--maxraises", str(int(p["maxraises"])),
                   "--post-maxraises", str(int(p.get("postmaxraises") or p["maxraises"])),
                   "--sizes", p["sizes"].replace(" ", ""), "--post-sizes", post.replace(" ", "")]


PROGRESS = re.compile(r"round (\d+)\s+iter (\d+)\s+infosets (\d+) \(([\d.]+)% of table\)\s+(\d+) it/s\s+(\d+)s")


def parse_progress(line):
    m = PROGRESS.search(line)
    if not m:
        return None
    r, it, n, fill, rate, sec = m.groups()
    return dict(round=int(r), iters=int(it), infosets=int(n), fill=float(fill), rate=int(rate), seconds=int(sec))


EVAL = re.compile(r"EVAL iter (\d+): current vs snapshot from iter (\d+): ([+-][\d.]+) mbb/hand \(\+-([\d.]+)\)")


def parse_eval(line):
    m = EVAL.search(line)
    if not m:
        return None
    it, prev, mean, ci = m.groups()
    return dict(iters=int(it), prev=int(prev), mbb=float(mean), ci=float(ci))


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
