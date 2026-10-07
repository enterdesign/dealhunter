#!/usr/bin/env python3
"""Small GUI to train, evaluate and play the hold'em bot.   python gui.py   (needs Python 3 with tkinter)"""
import datetime, os, queue, shutil, subprocess, sys, threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import trainer_core as core

BASE = os.path.dirname(os.path.abspath(__file__))
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
NEWCON = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("pokerai trainer")
        self.geometry("860x820")
        self.proc = None
        self.q = queue.Queue()
        self.vars = {}
        self._build()
        self.after(150, self._pump)
        self.protocol("WM_DELETE_WINDOW", self._close)

    # ---------------------------------------------------------------- layout
    def _field(self, parent, key, label, default, row, col=0, width=14, hint=""):
        ttk.Label(parent, text=label).grid(row=row, column=col * 3, sticky="e", padx=(8, 4), pady=3)
        v = tk.StringVar(value=str(default))
        self.vars[key] = v
        ttk.Entry(parent, textvariable=v, width=width).grid(row=row, column=col * 3 + 1, sticky="w", pady=3)
        if hint:
            ttk.Label(parent, text=hint, foreground="#666").grid(row=row, column=col * 3 + 2, sticky="w", padx=4)
        return v

    def _build(self):
        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Label(top, text="holdem program:").grid(row=0, column=0, sticky="e")
        self.vars["bin"] = tk.StringVar(value=core.find_binary(BASE))
        ttk.Entry(top, textvariable=self.vars["bin"], width=58).grid(row=0, column=1, padx=4)
        ttk.Button(top, text="Browse", command=self._browse_bin).grid(row=0, column=2)
        ttk.Button(top, text="Build (g++)", command=self._build_bin).grid(row=0, column=3, padx=4)

        pf = ttk.LabelFrame(self, text="Training parameters", padding=8)
        pf.pack(fill="x", padx=8, pady=4)
        ttk.Label(pf, text="Preset:").grid(row=0, column=0, sticky="e", padx=(8, 4))
        self.preset = ttk.Combobox(pf, values=list(core.PRESETS), state="readonly", width=28)
        self.preset.grid(row=0, column=1, columnspan=2, sticky="w")
        self.preset.bind("<<ComboboxSelected>>", self._apply_preset)
        self._field(pf, "players", "Players at the table (2-6)", 2, 1, hint="more players = much bigger game")
        self._field(pf, "stack", "Stack depth (big blinds)", 20, 2)
        self._field(pf, "buckets", "Hand buckets / street", 24, 3, hint="more = finer, bigger game")
        self._field(pf, "sizes", "Bet sizes preflop (pot fractions)", "0.5,1.0", 4, hint="1-4 values; all-in is always available")
        self._field(pf, "postsizes", "Bet sizes postflop", "0.5,1.0", 5)
        self._field(pf, "maxraises", "Max raises per street, preflop", 3, 6)
        self._field(pf, "postmaxraises", "Max raises per street, postflop", 3, 7)
        self._field(pf, "eqsamples", "Equity samples", 100, 8, hint="accuracy of the buckets (slower)")
        self._field(pf, "threads", "CPU threads", max(1, (os.cpu_count() or 4) - 2), 9)
        self._field(pf, "slots", "Table size (log2 slots)", 24, 10)
        self.mem = ttk.Label(pf, text="", foreground="#a60")
        self.mem.grid(row=10, column=2, sticky="w", padx=4)
        self.vars["slots"].trace_add("write", lambda *a: self._mem())
        self._field(pf, "iters", "Iterations (target)", "20M", 11, hint="e.g. 500M, 3G, 3e9")
        self._field(pf, "evalevery", "Check vs previous every (iter.)", "5M", 12, hint="progress check: current bot vs its older self (0 = off)")
        self._field(pf, "out", "Output file", os.path.join(BASE, "strategies", "my_strategy.bin"), 13, width=50)
        self._mem()

        bf = ttk.Frame(self, padding=(8, 4))
        bf.pack(fill="x")
        self.b_start = ttk.Button(bf, text="Start new training", command=lambda: self._start(False))
        self.b_resume = ttk.Button(bf, text="Resume (from .ckpt)", command=lambda: self._start(True))
        self.b_stop = ttk.Button(bf, text="Stop and save", command=self._stop, state="disabled")
        for b in (self.b_start, self.b_resume, self.b_stop):
            b.pack(side="left", padx=4)
        ttk.Button(bf, text="Evaluate vs baselines", command=self._eval).pack(side="left", padx=(24, 4))
        ttk.Button(bf, text="Play against the bot", command=self._play).pack(side="left", padx=4)
        bf2 = ttk.Frame(self, padding=(8, 0))
        bf2.pack(fill="x")
        ttk.Button(bf2, text="Save snapshot of current strategy", command=self._snapshot).pack(side="left", padx=4)
        ttk.Button(bf2, text="Compare two strategies...", command=self._compare).pack(side="left", padx=4)

        sf = ttk.LabelFrame(self, text="Progress", padding=8)
        sf.pack(fill="x", padx=8, pady=4)
        self.bar = ttk.Progressbar(sf, maximum=100)
        self.bar.pack(fill="x")
        self.stat = ttk.Label(sf, text="idle")
        self.stat.pack(anchor="w", pady=(4, 0))
        self.chk = ttk.Label(sf, text="progress check: -", foreground="#06c")
        self.chk.pack(anchor="w")

        self.log = tk.Text(self, height=14, state="disabled", font=("Courier", 9))
        self.log.pack(fill="both", expand=True, padx=8, pady=(4, 8))

    # ---------------------------------------------------------------- helpers
    def _p(self):
        return {k: v.get() for k, v in self.vars.items()}

    def _mem(self):
        try:
            self.mem.config(text=f"= {core.slots_gb(self.vars['slots'].get()):.1f} GB RAM")
        except ValueError:
            self.mem.config(text="")

    def _apply_preset(self, _=None):
        for k, v in core.PRESETS[self.preset.get()].items():
            self.vars[k].set(str(v))

    def _write(self, text):
        self.log.config(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.config(state="disabled")

    def _browse_bin(self):
        p = filedialog.askopenfilename(title="holdem program")
        if p:
            self.vars["bin"].set(p)

    def _binary(self):
        b = self.vars["bin"].get()
        if not b or not os.path.isfile(b):
            messagebox.showerror("holdem program missing", "Choose the compiled holdem program or press 'Build (g++)'.")
            return None
        return b

    def _run(self, cmd, on_done=None):
        if self.proc:
            messagebox.showinfo("busy", "Something is already running.")
            return
        self._write("$ " + " ".join(cmd) + "\n")
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                                         creationflags=NOWIN)
        except OSError as e:
            self.proc = None
            messagebox.showerror("cannot start", str(e))
            return
        self.b_start.config(state="disabled"); self.b_resume.config(state="disabled"); self.b_stop.config(state="normal")
        threading.Thread(target=self._reader, args=(self.proc, on_done), daemon=True).start()

    def _reader(self, proc, on_done):
        for line in proc.stdout:
            self.q.put(("line", line))
        proc.wait()
        self.q.put(("done", proc.returncode))

    def _pump(self):
        try:
            while True:
                kind, val = self.q.get_nowait()
                if kind == "line":
                    self._write(val)
                    ev = core.parse_eval(val)
                    if ev:
                        verdict = "still improving" if ev["mbb"] - ev["ci"] > 0 else "no clear change (close to converged for these settings)"
                        self.chk.config(text=f"progress check @ {ev['iters']:,}: {ev['mbb']:+.0f} +-{ev['ci']:.0f} mbb/hand vs bot from {ev['prev']:,} iterations ago: {verdict}")
                    pr = core.parse_progress(val)
                    if pr:
                        total = core.parse_count(self.vars["iters"].get())
                        self.bar["value"] = min(100, 100.0 * pr["iters"] / total)
                        self.stat.config(text=f"iter {pr['iters']:,} / {total:,}   infosets {pr['infosets']:,} ({pr['fill']:.0f}% of table)   "
                                              f"{pr['rate']:,} it/s   elapsed {pr['seconds'] // 60} min   ETA {core.fmt_eta(pr['iters'], total, pr['rate'])}")
                else:
                    self._write(f"[finished, exit code {val}]\n")
                    self.proc = None
                    self.b_start.config(state="normal"); self.b_resume.config(state="normal"); self.b_stop.config(state="disabled")
        except queue.Empty:
            pass
        self.after(150, self._pump)

    # ---------------------------------------------------------------- actions
    def _start(self, resume):
        b = self._binary()
        if not b:
            return
        p = self._p()
        try:
            cmd = core.train_command(b, p, resume)
        except ValueError as e:
            messagebox.showerror("bad parameters", str(e))
            return
        gb = core.slots_gb(p["slots"])
        if gb > 40 and not messagebox.askyesno("lots of memory", f"The table needs {gb:.0f} GB of RAM. Continue?"):
            return
        os.makedirs(os.path.dirname(p["out"]) or ".", exist_ok=True)
        self.bar["value"] = 0
        self._run(cmd)

    def _stop(self):
        out = self.vars["out"].get()
        open(out + ".stop", "w").close()   # the trainer finishes the current round, saves, exits
        self._write("stop requested, saving after the current round...\n")

    def _eval(self):
        b = self._binary()
        if b:
            self._run([b, "eval", self.vars["out"].get(), "--hands", "50000"])

    def _play(self):
        b = self._binary()
        if not b:
            return
        out = self.vars["out"].get()
        if sys.platform == "win32":
            subprocess.Popen([b, "play", out], creationflags=NEWCON)
        else:
            for term in (["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["xterm", "-e"], ["open", "-a", "Terminal"]):
                try:
                    subprocess.Popen(term + [b, "play", out])
                    return
                except OSError:
                    continue
            messagebox.showinfo("play", f"Run in a terminal:\n{b} play {out}")

    def _snapshot(self):
        out = self.vars["out"].get()
        if not os.path.isfile(out):
            messagebox.showinfo("no strategy yet", "The strategy file does not exist yet (it is saved every 10 minutes and on Stop).")
            return
        dst = os.path.splitext(out)[0] + "_snap_" + datetime.datetime.now().strftime("%Y%m%d_%H%M") + ".bin"
        shutil.copyfile(out, dst)
        self._write(f"snapshot saved: {dst}\n")

    def _compare(self):
        b = self._binary()
        if not b:
            return
        d = os.path.dirname(self.vars["out"].get()) or "."
        a = filedialog.askopenfilename(title="Strategy A (e.g. the newer one)", initialdir=d, filetypes=[("strategy", "*.bin")])
        if not a:
            return
        c = filedialog.askopenfilename(title="Strategy B (e.g. the older snapshot)", initialdir=d, filetypes=[("strategy", "*.bin")])
        if c:
            self._run([b, "compare", a, c, "--hands", "200000"])

    def _build_bin(self):
        cmd, out = core.build_command(BASE)
        self.vars["bin"].set(out)
        self._run(cmd)

    def _close(self):
        if self.proc:
            if not messagebox.askyesno("training running", "Stop training (it will save first) and quit?"):
                return
            self._stop()
            self.after(1500, self.destroy)
            return
        self.destroy()


if __name__ == "__main__":
    App().mainloop()
