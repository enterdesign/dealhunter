// Heads-up no-limit Texas hold'em bot: external-sampling MCCFR with card + action abstraction.
//
//   g++ -O2 -std=c++17 holdem.cpp -o holdem
//   ./holdem test
//   ./holdem train --stack 100 --iters 2000000000 --threads 16 --slots 27 --out s100.bin   (Ctrl+C = save and stop)
//   ./holdem train --resume s100.bin.ckpt --iters 2000000000 --out s100.bin           (continue training)
//   ./holdem play strategy.bin
//   ./holdem eval strategy.bin --hands 100000
//
// Abstraction (see README): fixed stack depth, bet sizes {0.5 pot, 1 pot, all-in}, max 3 raises per street,
// preflop: 169 lossless hand classes, postflop: hand-equity buckets.
#include <bits/stdc++.h>
#include <csignal>
#include <thread>
#include <atomic>
using namespace std;
typedef uint64_t u64;

static int START = 40, BB = 2, SB = 1;   // chips; stack = START (default 20 big blinds)
static int NBUCK = 24, EQSAMPLES = 100, MAXR = 3;
static vector<double> FRACS = {0.5, 1.0};   // raise sizes as fractions of the pot (after calling)
static const int MAXA = 7;                  // fold, call, up to 4 sizes, all-in
static const int MAXSIZES = 4;

// ---------------------------------------------------------------- utils
static inline u64 mix(u64 x) {
  x += 0x9E3779B97F4A7C15ULL;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
  return x ^ (x >> 31);
}
struct Rng {
  u64 s;
  explicit Rng(u64 seed = 88172645463325252ULL) : s(seed ? seed : 1) {}
  u64 next() { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s; }
  double uni() { return (next() >> 11) * (1.0 / 9007199254740992.0); }
  int below(int n) { return (int)(next() % (u64)n); }
};

// ---------------------------------------------------------------- cards & evaluator
// card = rank*4 + suit, rank 0 = deuce .. 12 = ace
static string cardStr(int c) { return string(1, "23456789TJQKA"[c >> 2]) + "cdhs"[c & 3]; }

static inline int straightHigh(int mask) {
  int m = (mask << 1) | ((mask >> 12) & 1);   // bit 0 = ace as low card
  for (int h = 13; h >= 4; h--)
    if (((m >> (h - 4)) & 31) == 31) return h - 1;
  return -1;
}

// Hand score for 5..7 cards; larger = better. Category in bits 20+.
static int eval(const int* c, int n) {
  int rc[13] = {0}, sm[4] = {0}, sc[4] = {0}, all = 0;
  for (int i = 0; i < n; i++) {
    int r = c[i] >> 2, s = c[i] & 3;
    rc[r]++; sm[s] |= 1 << r; sc[s]++; all |= 1 << r;
  }
  int best = 0;
  for (int s = 0; s < 4; s++)
    if (sc[s] >= 5) {
      int sf = straightHigh(sm[s]);
      if (sf >= 0) return (8 << 20) | sf;
      int v = 0, cnt = 0;
      for (int r = 12; r >= 0 && cnt < 5; r--)
        if ((sm[s] >> r) & 1) { v = (v << 4) | r; cnt++; }
      best = (5 << 20) | v;
    }
  int q = -1, t[2] = {-1, -1}, p[3] = {-1, -1, -1}, nt = 0, np = 0;
  for (int r = 12; r >= 0; r--) {
    if (rc[r] == 4) q = r;
    else if (rc[r] == 3) { if (nt < 2) t[nt++] = r; }
    else if (rc[r] == 2) { if (np < 3) p[np++] = r; }
  }
  auto kick = [&](int ex1, int ex2, int ex3, int count) {   // top `count` ranks not in ex*
    int v = 0, cnt = 0;
    for (int r = 12; r >= 0 && cnt < count; r--)
      if (rc[r] && r != ex1 && r != ex2 && r != ex3) { v = (v << 4) | r; cnt++; }
    return v;
  };
  if (q >= 0) return (7 << 20) | (q << 4) | kick(q, -1, -1, 1);
  if (nt >= 1 && (nt >= 2 || np >= 1)) {
    int pr = max(nt >= 2 ? t[1] : -1, np >= 1 ? p[0] : -1);
    return (6 << 20) | (t[0] << 4) | pr;
  }
  if (best) return best;
  int sh = straightHigh(all);
  if (sh >= 0) return (4 << 20) | sh;
  if (nt >= 1) return (3 << 20) | (t[0] << 8) | kick(t[0], -1, -1, 2);
  if (np >= 2) return (2 << 20) | (p[0] << 8) | (p[1] << 4) | kick(p[0], p[1], -1, 1);
  if (np == 1) return (1 << 20) | (p[0] << 12) | kick(p[0], -1, -1, 3);
  return kick(-1, -1, -1, 5);
}

// 169 strategically distinct starting hands
static int canon169(int c1, int c2) {
  int r1 = c1 >> 2, r2 = c2 >> 2;
  int hi = max(r1, r2), lo = min(r1, r2);
  if (hi == lo) return hi;
  int tri = hi * (hi - 1) / 2 + lo;   // 0..77
  return ((c1 & 3) == (c2 & 3) ? 13 : 91) + tri;
}

// Hand-strength bucket: equity vs a random hand with random runout, Monte Carlo with a seed derived from the
// cards, so the same situation always maps to the same bucket (needed for training and play to agree).
static int eqBucket(const int* hole, const int* board, int nb) {
  int h[2] = {min(hole[0], hole[1]), max(hole[0], hole[1])};
  int b[5];
  for (int i = 0; i < nb; i++) b[i] = board[i];
  sort(b, b + nb);
  u64 seed = 1469598103934665603ULL;
  for (int x : {h[0], h[1]}) seed = mix(seed ^ (x + 1));
  for (int i = 0; i < nb; i++) seed = mix(seed ^ (b[i] + 101));
  Rng rng(seed);
  int deck[52], nd = 0;
  bool used[52] = {false};
  used[h[0]] = used[h[1]] = true;
  for (int i = 0; i < nb; i++) used[b[i]] = true;
  for (int c = 0; c < 52; c++) if (!used[c]) deck[nd++] = c;
  int need = 2 + (5 - nb);
  double wins = 0;
  int me[7] = {h[0], h[1], 0, 0, 0, 0, 0}, op[7];
  for (int i = 0; i < nb; i++) me[2 + i] = b[i];
  for (int k = 0; k < EQSAMPLES; k++) {
    for (int i = 0; i < need; i++) swap(deck[i], deck[i + rng.below(nd - i)]);
    op[0] = deck[0]; op[1] = deck[1];
    for (int i = 0; i < nb; i++) op[2 + i] = b[i];
    for (int i = 0; i < 5 - nb; i++) { me[2 + nb + i] = deck[2 + i]; op[2 + nb + i] = deck[2 + i]; }
    int a = eval(me, 7), o = eval(op, 7);
    wins += a > o ? 1.0 : (a == o ? 0.5 : 0.0);
  }
  int bk = (int)(wins / EQSAMPLES * NBUCK);
  return min(bk, NBUCK - 1);
}

// ---------------------------------------------------------------- game
struct Act { int type; int to; };   // 0 fold, 1 call/check, 2 raise to `to` (total bet this street)

struct St {
  int street = 0, toAct = 0;
  int stack[2], bet[2];
  int pot0 = 0;                // chips committed on previous streets (both players)
  int nacts = 0, raises = 0, lastRaise = 0;
  bool fold = false, showdown = false;
  int folder = -1;
  u64 hist = 12345;
};

static St newHand() {
  St s;
  s.stack[0] = START - SB; s.stack[1] = START - BB;
  s.bet[0] = SB; s.bet[1] = BB;
  s.lastRaise = BB;
  return s;   // player 0 = button / small blind: acts first preflop, last postflop
}

static int legal(const St& s, Act* out) {
  int p = s.toAct, o = 1 - p, n = 0;
  int facing = s.bet[o] - s.bet[p];
  if (facing > 0) out[n++] = {0, 0};
  out[n++] = {1, 0};
  if (s.stack[o] == 0 || s.stack[p] <= facing || s.raises >= MAXR) return n;
  int maxTo = min(s.bet[p] + s.stack[p], s.bet[o] + s.stack[o]);   // can't bet more than the opponent can call
  int minTo = s.bet[o] + max(s.lastRaise, BB);
  if (minTo >= maxTo) { out[n++] = {2, maxTo}; return n; }
  int potAfterCall = s.pot0 + s.bet[0] + s.bet[1] + facing;
  int tos[MAXSIZES + 1], m = 0;
  for (size_t i = 0; i < FRACS.size(); i++) {
    int to = s.bet[o] + (int)llround(FRACS[i] * potAfterCall);
    to = max(to, minTo);
    if (to < maxTo) tos[m++] = to;
  }
  tos[m++] = maxTo;
  sort(tos, tos + m);
  m = (int)(unique(tos, tos + m) - tos);
  for (int i = 0; i < m; i++) out[n++] = {2, tos[i]};
  return n;
}

static St step(const St& s, Act a) {
  St t = s;
  int p = s.toAct, o = 1 - p;
  t.hist = mix(t.hist ^ (u64)(a.type == 2 ? a.to + 2 : a.type));
  if (a.type == 0) { t.fold = true; t.folder = p; return t; }
  t.nacts++;
  if (a.type == 2) {
    t.stack[p] -= a.to - s.bet[p];
    t.bet[p] = a.to;
    t.lastRaise = max(s.lastRaise, a.to - s.bet[o]);
    t.raises++;
    t.toAct = o;
    return t;
  }
  int facing = s.bet[o] - s.bet[p];
  int pay = min(facing, s.stack[p]);
  t.stack[p] -= pay; t.bet[p] += pay;
  bool preflopLimp = (s.street == 0 && s.nacts == 0);
  bool ends = facing > 0 ? !preflopLimp : s.nacts >= 1;
  if (t.stack[0] == 0 || t.stack[1] == 0) ends = true;
  if (!ends) { t.toAct = o; return t; }
  if (t.stack[0] == 0 || t.stack[1] == 0 || s.street == 3) { t.showdown = true; return t; }
  t.pot0 += t.bet[0] + t.bet[1];
  t.bet[0] = t.bet[1] = 0;
  t.street++; t.toAct = 1; t.nacts = 0; t.raises = 0; t.lastRaise = BB;
  t.hist = mix(t.hist ^ (u64)(1000 + t.street));
  return t;
}

struct Deal { int hole[2][2]; int board[5]; };

static void dealRandom(Deal& d, Rng& rng) {
  int deck[52];
  for (int i = 0; i < 52; i++) deck[i] = i;
  for (int i = 0; i < 9; i++) swap(deck[i], deck[i + rng.below(52 - i)]);
  d.hole[0][0] = deck[0]; d.hole[0][1] = deck[1]; d.hole[1][0] = deck[2]; d.hole[1][1] = deck[3];
  for (int i = 0; i < 5; i++) d.board[i] = deck[4 + i];
}

// utility for player `pl` at a terminal state (net chips)
static double util(const St& s, int pl, const Deal& d) {
  int com[2] = {START - s.stack[0], START - s.stack[1]};
  if (s.fold) return s.folder == pl ? -com[pl] : com[1 - pl];
  int a[7], b[7];
  for (int i = 0; i < 2; i++) { a[i] = d.hole[0][i]; b[i] = d.hole[1][i]; }
  for (int i = 0; i < 5; i++) a[2 + i] = b[2 + i] = d.board[i];
  int sa = eval(a, 7), sb = eval(b, 7), m = min(com[0], com[1]);
  if (sa == sb) return 0;
  bool p0wins = sa > sb;
  return (p0wins == (pl == 0)) ? m : -m;
}

static int bucketOf(const Deal& d, int p, int street) {
  if (street == 0) return canon169(d.hole[p][0], d.hole[p][1]);
  return eqBucket(d.hole[p], d.board, 2 + street);
}

static u64 infoKey(const St& s, int p, int bucket) {
  return mix(s.hist ^ ((u64)(bucket + 1) << 40) ^ ((u64)(p + 1) << 58));
}

// ---------------------------------------------------------------- MCCFR
// Lock-free open-addressing table shared by all training threads (updates are racy on purpose, "hogwild").
struct Slot {
  atomic<u64> key;
  float reg[MAXA];
  float sum[MAXA];
  unsigned char n;
};
static Slot* table = nullptr;
static size_t tableSize = 0, tableMask = 0;
static atomic<size_t> used{0};

static void allocTable(int logSlots) {
  tableSize = (size_t)1 << logSlots;
  tableMask = tableSize - 1;
  table = (Slot*)calloc(tableSize, sizeof(Slot));
  if (!table) { fprintf(stderr, "cannot allocate %.1f GB, use a smaller --slots\n", tableSize * sizeof(Slot) / 1e9); exit(1); }
}

static Slot& slotFor(u64 key, int n) {
  if (key == 0) key = 1;
  size_t i = key & tableMask;
  for (size_t probe = 0;; probe++) {
    u64 k = table[i].key.load(memory_order_relaxed);
    if (k == key) break;
    if (k == 0) {
      u64 e = 0;
      if (table[i].key.compare_exchange_strong(e, key)) { used.fetch_add(1, memory_order_relaxed); break; }
      if (e == key) break;
    }
    i = (i + 1) & tableMask;
    if (probe > 5000) { fprintf(stderr, "hash table full: increase --slots\n"); exit(2); }
  }
  table[i].n = (unsigned char)n;
  return table[i];
}

static inline void regretMatch(const Slot& nd, float* st) {
  float tot = 0;
  for (int i = 0; i < nd.n; i++) tot += max(0.f, nd.reg[i]);
  for (int i = 0; i < nd.n; i++) st[i] = tot > 0 ? max(0.f, nd.reg[i]) / tot : 1.f / nd.n;
}

struct Ctx { Deal d; int bk[2][4]; float w; };

static double trav(const St& s, int tr, Ctx& c, Rng& rng) {
  if (s.fold || s.showdown) return util(s, tr, c.d);
  int p = s.toAct;
  Act acts[MAXA];
  int n = legal(s, acts);
  int& b = c.bk[p][s.street];
  if (b < 0) b = bucketOf(c.d, p, s.street);
  Slot& nd = slotFor(infoKey(s, p, b), n);
  float st[MAXA];
  regretMatch(nd, st);
  if (p == tr) {
    double v[MAXA], ev = 0;
    for (int i = 0; i < n; i++) { v[i] = trav(step(s, acts[i]), tr, c, rng); ev += st[i] * v[i]; }
    for (int i = 0; i < n; i++) nd.reg[i] += (float)(v[i] - ev);
    return ev;
  }
  for (int i = 0; i < n; i++) nd.sum[i] += c.w * st[i];   // linear averaging: later rounds weigh more
  double r = rng.uni(), acc = 0;
  int pick = n - 1;
  for (int i = 0; i < n; i++) { acc += st[i]; if (r < acc) { pick = i; break; } }
  return trav(step(s, acts[pick]), tr, c, rng);
}

// ---------------------------------------------------------------- files
struct Hdr {
  int magic, kind;            // kind 1 = strategy (play), 2 = checkpoint (resume)
  int start, nbuck, maxr, eqs, nfr;
  float fr[MAXSIZES];
  long long iters, count, round;
};
static const int MAGIC = 0x48454448;

static Hdr makeHdr(int kind, long long iters, long long count, long long round) {
  Hdr h{};
  h.magic = MAGIC; h.kind = kind; h.start = START; h.nbuck = NBUCK; h.maxr = MAXR; h.eqs = EQSAMPLES;
  h.nfr = (int)FRACS.size();
  for (int i = 0; i < h.nfr; i++) h.fr[i] = (float)FRACS[i];
  h.iters = iters; h.count = count; h.round = round;
  return h;
}
static void applyHdr(const Hdr& h) {
  START = h.start; NBUCK = h.nbuck; MAXR = h.maxr; EQSAMPLES = h.eqs;
  FRACS.assign(h.fr, h.fr + h.nfr);
}

static bool saveFiles(const string& strategyPath, long long iters, long long round) {
  string tmp = strategyPath + ".tmp";
  FILE* f = fopen(tmp.c_str(), "wb");
  string ckptPath = strategyPath + ".ckpt", ctmp = ckptPath + ".tmp";
  FILE* g = fopen(ctmp.c_str(), "wb");
  if (!f || !g) return false;
  Hdr h = makeHdr(1, iters, 0, round), hc = makeHdr(2, iters, 0, round);
  fwrite(&h, sizeof h, 1, f);
  fwrite(&hc, sizeof hc, 1, g);
  long long kept = 0, ckept = 0;
  for (size_t i = 0; i < tableSize; i++) {
    Slot& nd = table[i];
    u64 key = nd.key.load(memory_order_relaxed);
    if (!key) continue;
    fwrite(&key, sizeof key, 1, g);
    fwrite(&nd.n, 1, 1, g);
    fwrite(nd.reg, sizeof(float), nd.n, g);
    fwrite(nd.sum, sizeof(float), nd.n, g);
    ckept++;
    float tot = 0;
    for (int k = 0; k < nd.n; k++) tot += nd.sum[k];
    if (tot <= 0) continue;
    fwrite(&key, sizeof key, 1, f);
    unsigned char row[MAXA + 1];
    row[0] = nd.n;
    for (int k = 0; k < nd.n; k++) row[1 + k] = (unsigned char)lround(255.0 * nd.sum[k] / tot);
    fwrite(row, 1, 1 + nd.n, f);
    kept++;
  }
  h.count = kept; hc.count = ckept;
  fseek(f, 0, SEEK_SET); fwrite(&h, sizeof h, 1, f);
  fseek(g, 0, SEEK_SET); fwrite(&hc, sizeof hc, 1, g);
  fclose(f); fclose(g);
  rename(tmp.c_str(), strategyPath.c_str());
  rename(ctmp.c_str(), ckptPath.c_str());
  return true;
}

static bool loadCheckpoint(const string& path, long long& iters, long long& round) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  Hdr h;
  if (fread(&h, sizeof h, 1, f) != 1 || h.magic != MAGIC || h.kind != 2) { fclose(f); return false; }
  applyHdr(h);
  iters = h.iters; round = h.round;
  fclose(f);
  return true;   // the caller allocates the table, then calls readCheckpointBody()
}

static bool readCheckpointBody(const string& path) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  Hdr h;
  if (fread(&h, sizeof h, 1, f) != 1) { fclose(f); return false; }
  for (long long i = 0; i < h.count; i++) {
    u64 key; unsigned char n;
    if (fread(&key, sizeof key, 1, f) != 1 || fread(&n, 1, 1, f) != 1) break;
    Slot& nd = slotFor(key, n);
    if (fread(nd.reg, sizeof(float), n, f) != n || fread(nd.sum, sizeof(float), n, f) != n) break;
  }
  fclose(f);
  return true;
}

struct Strat { unordered_map<u64, array<unsigned char, MAXA + 1>> m; };   // [0] = n, then quantised probs

static bool loadStrategy(const string& path, Strat& S) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  Hdr h;
  if (fread(&h, sizeof h, 1, f) != 1 || h.magic != MAGIC || h.kind != 1) { fclose(f); return false; }
  applyHdr(h);
  S.m.reserve(h.count);
  for (long long i = 0; i < h.count; i++) {
    u64 key;
    unsigned char n;
    if (fread(&key, sizeof key, 1, f) != 1 || fread(&n, 1, 1, f) != 1) break;
    array<unsigned char, MAXA + 1> row{};
    row[0] = n;
    if (fread(&row[1], 1, n, f) != n) break;
    S.m[key] = row;
  }
  fclose(f);
  return true;
}

// Chooses an action index for the player to act. Unknown situations default to check/call.
static int botChoose(const Strat& S, const St& s, const Deal& d, Act* acts, int n, Rng& rng) {
  int p = s.toAct;
  auto it = S.m.find(infoKey(s, p, bucketOf(d, p, s.street)));
  if (it == S.m.end() || it->second[0] != n) {
    for (int i = 0; i < n; i++) if (acts[i].type == 1) return i;
    return 0;
  }
  int tot = 0;
  for (int i = 0; i < n; i++) tot += it->second[1 + i];
  if (tot == 0) return 0;
  int r = rng.below(tot), acc = 0;
  for (int i = 0; i < n; i++) { acc += it->second[1 + i]; if (r < acc) return i; }
  return n - 1;
}

// ---------------------------------------------------------------- commands
static string actStr(const St& s, Act a) {
  int p = s.toAct, o = 1 - p;
  if (a.type == 0) return "fold";
  if (a.type == 1) { int f = s.bet[o] - s.bet[p]; return f > 0 ? "call " + to_string(min(f, s.stack[p])) : "check"; }
  bool allin = a.to - s.bet[p] >= s.stack[p];
  return string(s.bet[o] > 0 ? "raise to " : "bet ") + to_string(a.to) + (allin ? " (all-in)" : "");
}

static atomic<bool> g_stop{false};
static void onSigint(int) { g_stop = true; }

struct TrainOpts {
  long long iters = 1000000;
  int threads = 1, logSlots = 24;
  long long roundIters = 1000000;
  string out = "strategy.bin", resume;
};

static int cmdTrain(const TrainOpts& o) {
  long long done = 0, round = 0;
  if (!o.resume.empty()) {
    if (!loadCheckpoint(o.resume, done, round)) { fprintf(stderr, "cannot read checkpoint %s\n", o.resume.c_str()); return 1; }
    allocTable(o.logSlots);
    readCheckpointBody(o.resume);
    printf("resumed: %lld iterations, %zu infosets\n", done, used.load());
  } else {
    allocTable(o.logSlots);
  }
  signal(SIGINT, onSigint);
  printf("stack %d bb, %d buckets, sizes", START / BB, NBUCK);
  for (double f : FRACS) printf(" %.2f", f);
  printf(", max %d raises, %d threads, table %.1f GB\n", MAXR, o.threads, tableSize * sizeof(Slot) / 1e9);
  auto t0 = chrono::steady_clock::now();
  auto lastSave = t0;
  long long start = done;
  while (done < o.iters && !g_stop) {
    round++;
    long long per = max(1LL, o.roundIters / o.threads);
    vector<thread> th;
    for (int t = 0; t < o.threads; t++)
      th.emplace_back([&, t]() {
        Rng rng(mix((u64)round * 1000003ULL + t + 17));
        Ctx c;
        c.w = (float)round;
        for (long long i = 0; i < per; i++) {
          dealRandom(c.d, rng);
          for (int tr = 0; tr < 2; tr++) {
            memset(c.bk, -1, sizeof c.bk);
            trav(newHand(), tr, c, rng);
          }
        }
      });
    for (auto& x : th) x.join();
    done += per * o.threads;
    double sec = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
    printf("round %lld  iter %lld  infosets %zu (%.0f%% of table)  %.0f it/s  %.0fs\n", round, done, used.load(),
           100.0 * used.load() / tableSize, (done - start) / sec, sec);
    fflush(stdout);
    if (used.load() > tableSize * 0.85) { printf("table is 85%% full, stopping (use a larger --slots next time)\n"); break; }
    if (chrono::duration<double>(chrono::steady_clock::now() - lastSave).count() > 600) {
      saveFiles(o.out, done, round);
      lastSave = chrono::steady_clock::now();
      printf("checkpoint saved\n");
    }
  }
  saveFiles(o.out, done, round);
  printf("saved %s (+ %s.ckpt for resuming)\n", o.out.c_str(), o.out.c_str());
  return 0;
}

enum Policy { P_BOT, P_RANDOM, P_CALL, P_AGGRO };

static int policyChoose(Policy pol, const Strat& S, const St& s, const Deal& d, Act* acts, int n, Rng& rng) {
  if (pol == P_BOT) return botChoose(S, s, d, acts, n, rng);
  if (pol == P_RANDOM) return rng.below(n);
  if (pol == P_CALL) { for (int i = 0; i < n; i++) if (acts[i].type == 1) return i; }
  // aggro: smallest raise if available else call
  for (int i = 0; i < n; i++) if (acts[i].type == 2) return i;
  for (int i = 0; i < n; i++) if (acts[i].type == 1) return i;
  return 0;
}

static int cmdEval(const string& path, long long hands) {
  Strat S;
  if (!loadStrategy(path, S)) { fprintf(stderr, "cannot load %s\n", path.c_str()); return 1; }
  printf("stack %d bb, %zu infosets\n", START / BB, S.m.size());
  Rng rng(12345);
  const char* names[] = {"bot", "random", "always call", "always raise (min)"};
  for (int opp = P_RANDOM; opp <= P_AGGRO; opp++) {
    double total = 0, sq = 0;
    for (long long h = 0; h < hands; h++) {
      Deal d; dealRandom(d, rng);
      int botSeat = (int)(h & 1);
      St s = newHand();
      while (!(s.fold || s.showdown)) {
        Act acts[MAXA];
        int n = legal(s, acts);
        Policy pol = s.toAct == botSeat ? P_BOT : (Policy)opp;
        s = step(s, acts[policyChoose(pol, S, s, d, acts, n, rng)]);
      }
      double u = util(s, botSeat, d);
      total += u; sq += u * u;
    }
    double mean = total / hands, var = sq / hands - mean * mean;
    double se = sqrt(max(var, 0.0) / hands);
    printf("bot vs %-20s %+9.1f mbb/hand  (+-%.1f)\n", names[opp], mean / BB * 1000, se / BB * 1000 * 1.96);
  }
  return 0;
}

static string showCards(const int* c, int n) {
  string r;
  for (int i = 0; i < n; i++) r += cardStr(c[i]) + (i + 1 < n ? " " : "");
  return r;
}

static int cmdPlay(const string& path) {
  Strat S;
  if (!loadStrategy(path, S)) { fprintf(stderr, "cannot load %s\n", path.c_str()); return 1; }
  Rng rng((u64)chrono::steady_clock::now().time_since_epoch().count());
  double total = 0;
  int hands = 0;
  printf("Heads-up NLHE, %d bb stacks, blinds %d/%d. Type the number of your action, q to quit.\n", START / BB, SB, BB);
  printf("(You can only choose from the bot's bet sizes.)\n\n");
  while (true) {
    Deal d; dealRandom(d, rng);
    int me = hands % 2;   // seat 0 = button
    hands++;
    St s = newHand();
    printf("=== hand %d | you are %s | your cards: %s\n", hands, me == 0 ? "button/SB" : "BB", showCards(d.hole[me], 2).c_str());
    int shown = 0;
    while (!(s.fold || s.showdown)) {
      if (s.street > shown) { shown = s.street; printf("board: %s\n", showCards(d.board, 2 + s.street).c_str()); }
      Act acts[MAXA];
      int n = legal(s, acts);
      int pot = s.pot0 + s.bet[0] + s.bet[1];
      if (s.toAct == me) {
        printf("pot %d | you %d behind (bet %d) | bot %d behind (bet %d)\n", pot, s.stack[me], s.bet[me], s.stack[1 - me], s.bet[1 - me]);
        for (int i = 0; i < n; i++) printf("  [%d] %s\n", i + 1, actStr(s, acts[i]).c_str());
        int ch = 0;
        while (true) {
          printf("> "); fflush(stdout);
          string line;
          if (!getline(cin, line) || line == "q") { printf("\nresult after %d hands: %+.1f bb\n", hands - 1, total / BB); return 0; }
          ch = atoi(line.c_str());
          if (ch >= 1 && ch <= n) break;
        }
        s = step(s, acts[ch - 1]);
      } else {
        int i = botChoose(S, s, d, acts, n, rng);
        printf("bot: %s\n", actStr(s, acts[i]).c_str());
        s = step(s, acts[i]);
      }
    }
    double u = util(s, me, d);
    total += u;
    if (!s.fold) printf("showdown: bot has %s | board %s\n", showCards(d.hole[1 - me], 2).c_str(), showCards(d.board, 5).c_str());
    printf("result: %+.1f bb | session: %+.1f bb\n\n", u / BB, total / BB);
  }
}

static int cmdTest() {
  int fails = 0;
  auto check = [&](bool ok, const char* what) { printf("%s %s\n", ok ? "ok  " : "FAIL", what); if (!ok) fails++; };

  // 1. five-card category counts (all 2,598,960 hands)
  long long cnt[9] = {0};
  int c[5];
  for (c[0] = 0; c[0] < 52; c[0]++) for (c[1] = c[0] + 1; c[1] < 52; c[1]++) for (c[2] = c[1] + 1; c[2] < 52; c[2]++)
    for (c[3] = c[2] + 1; c[3] < 52; c[3]++) for (c[4] = c[3] + 1; c[4] < 52; c[4]++) cnt[eval(c, 5) >> 20]++;
  long long want[9] = {1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40};
  bool same = true;
  for (int i = 0; i < 9; i++) same &= cnt[i] == want[i];
  check(same, "5-card hand category frequencies match the known table");

  // 2. ordering spot checks
  auto sc = [&](vector<int> v) { return eval(v.data(), (int)v.size()); };
  auto C = [](const char* s) -> int {
    int r = (int)(strchr("23456789TJQKA", s[0]) - "23456789TJQKA");
    int u = (int)(strchr("cdhs", s[1]) - "cdhs");
    return r * 4 + u;
  };
  check(sc({C("Ah"), C("Kh"), C("Qh"), C("Jh"), C("Th"), C("2c"), C("3d")}) > sc({C("9h"), C("8h"), C("7h"), C("6h"), C("5h"), C("2c"), C("3d")}), "royal flush > 9-high straight flush");
  check(sc({C("Ah"), C("2c"), C("3d"), C("4s"), C("5h"), C("Kc"), C("Qd")}) < sc({C("2h"), C("3c"), C("4d"), C("5s"), C("6h"), C("Kc"), C("Qd")}), "wheel < 6-high straight");
  check(sc({C("Ah"), C("Ac"), C("Ad"), C("Ks"), C("Kh"), C("2c"), C("2d")}) > sc({C("Ah"), C("Kh"), C("2h"), C("7h"), C("9h"), C("Ac"), C("Ad")}), "full house > flush");
  check(sc({C("Ah"), C("Ac"), C("Kd"), C("Ks"), C("Qh"), C("2c"), C("2d")}) == sc({C("Ah"), C("Ac"), C("Kd"), C("Ks"), C("Qh"), C("3c"), C("3d")}), "two pair: third pair doesn't change score");
  check(sc({C("Ah"), C("Ac"), C("Kd"), C("Ks"), C("Qh"), C("Jc"), C("2d")}) > sc({C("Ah"), C("Ac"), C("Kd"), C("Ks"), C("Jh"), C("Tc"), C("2d")}), "two pair kickers");

  // 3. buckets deterministic and sensible
  int aa[2] = {C("Ah"), C("Ad")}, seven2[2] = {C("7c"), C("2d")}, flop[3] = {C("As"), C("Kd"), C("3c")};
  check(eqBucket(aa, flop, 3) == eqBucket(aa, flop, 3), "bucket deterministic");
  check(eqBucket(aa, flop, 3) > eqBucket(seven2, flop, 3), "set of aces ranks above 7-2 on A-K-3");
  check(canon169(C("Ah"), C("Ad")) != canon169(C("Ah"), C("Kd")) && canon169(C("Ah"), C("Kh")) != canon169(C("Ah"), C("Kd")), "preflop classes distinct");
  { set<int> seen; for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++) seen.insert(canon169(a, b)); check(seen.size() == 169, "169 preflop classes"); }

  // 4. random playouts: zero-sum, chips conserved, terminate
  Rng rng(7);
  bool ok = true;
  long long streets[4] = {0};
  for (int g = 0; g < 200000 && ok; g++) {
    Deal d; dealRandom(d, rng);
    St s = newHand();
    int steps = 0;
    while (!(s.fold || s.showdown)) {
      Act acts[MAXA];
      int n = legal(s, acts);
      if (n < 1 || ++steps > 60) { ok = false; break; }
      if (s.stack[0] < 0 || s.stack[1] < 0) { ok = false; break; }
      s = step(s, acts[rng.below(n)]);
    }
    if (!ok) break;
    streets[s.street]++;
    ok &= fabs(util(s, 0, d) + util(s, 1, d)) < 1e-9;
    ok &= s.stack[0] >= 0 && s.stack[1] >= 0;
  }
  check(ok, "200k random hands: terminate, stacks >= 0, zero-sum");
  printf("     (hands ending on street 0..3: %lld %lld %lld %lld)\n", streets[0], streets[1], streets[2], streets[3]);

  // 5. all-in action set sanity
  { St s = newHand(); Act a[MAXA]; int n = legal(s, a);
    string acts; for (int i = 0; i < n; i++) acts += actStr(s, a[i]) + "; ";
    printf("     SB first action: %s\n", acts.c_str());
    check(n >= 4, "SB has fold/call/raise options"); }
  printf("%s\n", fails ? "SOME TESTS FAILED" : "all tests passed");
  return fails != 0;
}

int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: holdem test | train | play FILE | eval FILE\n"); return 1; }
  string cmd = argv[1];
  auto arg = [&](const char* name, const char* def) -> string {
    for (int i = 2; i + 1 < argc; i++) if (!strcmp(argv[i], name)) return argv[i + 1];
    return def;
  };
  if (cmd == "test") return cmdTest();
  if (cmd == "train") {
    TrainOpts o;
    o.iters = atoll(arg("--iters", "1000000").c_str());
    o.threads = atoi(arg("--threads", "1").c_str());
    o.logSlots = atoi(arg("--slots", "24").c_str());
    o.roundIters = atoll(arg("--round", "1000000").c_str());
    o.out = arg("--out", "strategy.bin");
    o.resume = arg("--resume", "");
    if (o.resume.empty()) {
      START = BB * atoi(arg("--stack", "20").c_str());
      NBUCK = atoi(arg("--buckets", "24").c_str());
      MAXR = atoi(arg("--maxraises", "3").c_str());
      EQSAMPLES = atoi(arg("--eqsamples", "100").c_str());
      string sz = arg("--sizes", "0.5,1.0");
      FRACS.clear();
      stringstream ss(sz);
      string tok;
      while (getline(ss, tok, ',') && FRACS.size() < (size_t)MAXSIZES) FRACS.push_back(atof(tok.c_str()));
    }
    return cmdTrain(o);
  }
  if (cmd == "play" && argc >= 3) return cmdPlay(argv[2]);
  if (cmd == "eval" && argc >= 3) return cmdEval(argv[2], atoll(arg("--hands", "50000").c_str()));
  fprintf(stderr, "bad arguments\n");
  return 1;
}
