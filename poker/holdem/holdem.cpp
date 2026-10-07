// No-limit Texas hold'em bot for 2 to 6 players: external-sampling MCCFR with card + action abstraction.
//
//   g++ -O3 -std=c++17 -pthread holdem.cpp -o holdem
//   ./holdem test
//   ./holdem train --players 6 --stack 20 --iters 2000000000 --threads 14 --slots 28 --out s6.bin   (Ctrl+C = save and stop)
//   ./holdem train --resume s6.bin.ckpt --iters 4000000000 --out s6.bin --slots 28                   (continue training)
//   (add --eval-every 50000000 to print "current vs previous snapshot" progress checks during training)
//   ./holdem play s6.bin
//   ./holdem eval s6.bin --hands 100000             (bot vs simple baseline bots)
//   ./holdem compare new.bin old.bin --hands 100000  (which of two strategies is stronger)
//
// Seats: 0 = button, 1 = small blind, 2 = big blind (heads-up: seat 0 is button and small blind, seat 1 big blind),
// then UTG, HJ, CO. The button is fixed in the game tree; in play() the human's seat rotates every hand.
// Abstraction (see README): fixed equal stacks, bet sizes as pot fractions, max N raises per street,
// preflop: 169 lossless hand classes, postflop: hand-equity buckets (equity against the number of live opponents).
#include <bits/stdc++.h>
#include <csignal>
#include <thread>
#include <atomic>
using namespace std;
typedef uint64_t u64;

static const int MAXN = 6;
static int NP = 2;                                   // number of players at the table
static int START = 40, BB = 2, SB = 1;               // chips; stack = START (default 20 big blinds)
static int NBUCK = 24, EQSAMPLES = 100, MAXR = 3, PMAXR = 3;   // max raises per street: preflop / postflop
static vector<double> FRACS = {0.5, 1.0};            // raise sizes as fractions of the pot (after calling), preflop
static vector<double> PFRACS = {0.5, 1.0};           // same, postflop
static const int MAXA = 7;                           // fold, call, up to 4 sizes, all-in
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

// Hand-strength bucket: equity against `k` random hands (live opponents) with a random runout, Monte Carlo with a
// seed derived from the cards, so the same situation always maps to the same bucket (training and play must agree).
// The equity is mapped with eq^(1/k) so that buckets are spread out also in multiway pots (k = 1: plain equity).
static int eqBucket(const int* hole, const int* board, int nb, int k) {
  int h[2] = {min(hole[0], hole[1]), max(hole[0], hole[1])};
  int b[5];
  for (int i = 0; i < nb; i++) b[i] = board[i];
  sort(b, b + nb);
  u64 seed = 1469598103934665603ULL;
  for (int x : {h[0], h[1]}) seed = mix(seed ^ (x + 1));
  for (int i = 0; i < nb; i++) seed = mix(seed ^ (b[i] + 101));
  seed = mix(seed ^ (k + 7777));
  Rng rng(seed);
  int deck[52], nd = 0;
  bool used[52] = {false};
  used[h[0]] = used[h[1]] = true;
  for (int i = 0; i < nb; i++) used[b[i]] = true;
  for (int c = 0; c < 52; c++) if (!used[c]) deck[nd++] = c;
  int need = 2 * k + (5 - nb);
  double wins = 0;
  int me[7] = {h[0], h[1], 0, 0, 0, 0, 0}, op[7];
  for (int i = 0; i < nb; i++) me[2 + i] = b[i];
  for (int s = 0; s < EQSAMPLES; s++) {
    for (int i = 0; i < need; i++) swap(deck[i], deck[i + rng.below(nd - i)]);
    for (int i = 0; i < 5 - nb; i++) me[2 + nb + i] = deck[2 * k + i];
    int a = eval(me, 7);
    int better = 0, ties = 0;
    for (int o = 0; o < k && better == 0; o++) {
      op[0] = deck[2 * o]; op[1] = deck[2 * o + 1];
      for (int i = 0; i < nb; i++) op[2 + i] = b[i];
      for (int i = 0; i < 5 - nb; i++) op[2 + nb + i] = deck[2 * k + i];
      int sc = eval(op, 7);
      if (sc > a) better++;
      else if (sc == a) ties++;
    }
    if (better == 0) wins += 1.0 / (ties + 1);
  }
  double eq = wins / EQSAMPLES;
  if (k > 1) eq = pow(eq, 1.0 / k);
  return min((int)(eq * NBUCK), NBUCK - 1);
}

// ---------------------------------------------------------------- game
struct Act { int type; int to; };   // 0 fold, 1 call/check, 2 raise to `to` (total bet this street)

static int ORD[2][MAXN];            // acting order: [0] preflop, [1] postflop
static void initOrders() {
  if (NP == 2) { ORD[0][0] = 0; ORD[0][1] = 1; ORD[1][0] = 1; ORD[1][1] = 0; return; }
  for (int i = 0; i < NP; i++) ORD[0][i] = (3 + i) % NP;   // UTG ... BB (3 players: BTN, SB, BB)
  for (int i = 0; i < NP; i++) ORD[1][i] = (1 + i) % NP;   // SB first, button last
}
static inline int sbSeat() { return NP == 2 ? 0 : 1; }
static inline int bbSeat() { return NP == 2 ? 1 : 2; }

static string seatName(int seat) {
  static const char* two[] = {"BTN/SB", "BB"};
  static const char* names[] = {"BTN", "SB", "BB", "UTG", "HJ", "CO"};
  if (NP == 2) return two[seat];
  if (NP == 3 || NP == 4) return seat == 3 ? "UTG" : names[seat];
  if (NP == 5) return seat == 4 ? "CO" : names[seat];
  return names[seat];
}

struct St {
  int street = 0, toAct = 0;
  int stack[MAXN], bet[MAXN];
  int pot0 = 0;                // chips committed on previous streets (all players)
  int raises = 0, lastRaise = 0;
  int folded = 0, pending = 0; // bit masks of seats
  int winner = -1;             // set when everybody else folded
  bool over = false;           // hand finished (fold win or showdown)
  bool showdown = false;
  u64 hist = 12345;
};

static St newHand() {
  St s;
  for (int i = 0; i < NP; i++) { s.stack[i] = START; s.bet[i] = 0; }
  s.stack[sbSeat()] -= SB; s.bet[sbSeat()] = SB;
  s.stack[bbSeat()] -= BB; s.bet[bbSeat()] = BB;
  s.lastRaise = BB;
  s.pending = (1 << NP) - 1;
  s.toAct = ORD[0][0];
  return s;
}

static inline int maxBetOf(const St& s) {
  int m = 0;
  for (int i = 0; i < NP; i++) m = max(m, s.bet[i]);
  return m;
}

static int legal(const St& s, Act* out) {
  int p = s.toAct, n = 0;
  int maxBet = maxBetOf(s), facing = maxBet - s.bet[p];
  if (facing > 0) out[n++] = {0, 0};
  out[n++] = {1, 0};
  const bool pre = s.street == 0;
  if (s.raises >= (pre ? MAXR : PMAXR) || s.stack[p] <= facing) return n;
  const vector<double>& fracs = pre ? FRACS : PFRACS;
  int capOpp = 0, total = s.pot0;
  for (int i = 0; i < NP; i++) {
    total += s.bet[i];
    if (i != p && !((s.folded >> i) & 1) && s.stack[i] > 0) capOpp = max(capOpp, s.bet[i] + s.stack[i]);
  }
  int maxTo = min(s.bet[p] + s.stack[p], capOpp);   // can't bet more than the richest opponent can call
  if (maxTo <= maxBet) return n;
  int minTo = maxBet + max(s.lastRaise, BB);
  if (minTo >= maxTo) { out[n++] = {2, maxTo}; return n; }
  int potAfterCall = total + facing;
  int tos[MAXSIZES + 1], m = 0;
  for (size_t i = 0; i < fracs.size(); i++) {
    int to = maxBet + (int)llround(fracs[i] * potAfterCall);
    to = max(to, minTo);
    if (to < maxTo) tos[m++] = to;
  }
  tos[m++] = maxTo;
  sort(tos, tos + m);
  m = (int)(unique(tos, tos + m) - tos);
  for (int i = 0; i < m; i++) out[n++] = {2, tos[i]};
  return n;
}

static inline int popc(int x) { return __builtin_popcount((unsigned)x); }

static int firstPending(const St& s, int street) {
  const int* o = ORD[street == 0 ? 0 : 1];
  for (int i = 0; i < NP; i++) if ((s.pending >> o[i]) & 1) return o[i];
  return -1;
}

static int nextPending(const St& s, int p) {
  const int* o = ORD[s.street == 0 ? 0 : 1];
  int pos = 0;
  for (int i = 0; i < NP; i++) if (o[i] == p) pos = i;
  for (int k = 1; k <= NP; k++) {
    int q = o[(pos + k) % NP];
    if ((s.pending >> q) & 1) return q;
  }
  return -1;
}

static St step(const St& s, Act a) {
  St t = s;
  int p = s.toAct;
  int maxBet = maxBetOf(s);
  t.hist = mix(t.hist ^ (u64)(a.type == 2 ? a.to + 2 : a.type) ^ ((u64)(p + 1) << 50));
  const int all = (1 << NP) - 1;
  if (a.type == 0) {
    t.folded |= 1 << p;
    t.pending &= ~(1 << p);
    int live = all & ~t.folded;
    if (popc(live) == 1) { t.over = true; t.winner = __builtin_ctz(live); return t; }
  } else if (a.type == 1) {
    int pay = min(maxBet - s.bet[p], s.stack[p]);
    t.stack[p] -= pay; t.bet[p] += pay;
    t.pending &= ~(1 << p);
  } else {
    t.stack[p] -= a.to - s.bet[p];
    t.bet[p] = a.to;
    t.lastRaise = max(s.lastRaise, a.to - maxBet);
    t.raises++;
    int pend = 0;
    for (int i = 0; i < NP; i++)
      if (i != p && !((t.folded >> i) & 1) && t.stack[i] > 0) pend |= 1 << i;
    t.pending = pend;
  }
  if (t.pending != 0) { t.toAct = nextPending(t, p); return t; }
  // betting round is over
  int canAct = 0;
  for (int i = 0; i < NP; i++) if (!((t.folded >> i) & 1) && t.stack[i] > 0) canAct |= 1 << i;
  if (t.street == 3 || popc(canAct) <= 1) { t.over = true; t.showdown = true; return t; }
  for (int i = 0; i < NP; i++) { t.pot0 += t.bet[i]; t.bet[i] = 0; }
  t.street++; t.raises = 0; t.lastRaise = BB; t.pending = canAct;
  t.hist = mix(t.hist ^ (u64)(1000 + t.street));
  t.toAct = firstPending(t, t.street);
  return t;
}

struct Deal { int hole[MAXN][2]; int board[5]; };

static void dealRandom(Deal& d, Rng& rng) {
  int deck[52];
  for (int i = 0; i < 52; i++) deck[i] = i;
  int need = 2 * NP + 5;
  for (int i = 0; i < need; i++) swap(deck[i], deck[i + rng.below(52 - i)]);
  for (int p = 0; p < NP; p++) { d.hole[p][0] = deck[2 * p]; d.hole[p][1] = deck[2 * p + 1]; }
  for (int i = 0; i < 5; i++) d.board[i] = deck[2 * NP + i];
}

// Distributes the pots (including side pots). comm[i] = chips player i put in, live[i] = not folded.
// out[i] = net result of player i. Chips above the highest live commitment can't exist (they'd be uncalled).
static void settle(const int* comm, const int* live, const int* score, int n, double* out) {
  double won[MAXN] = {0};
  int levels[MAXN], nl = 0;
  for (int i = 0; i < n; i++) if (live[i]) levels[nl++] = comm[i];
  sort(levels, levels + nl);
  nl = (int)(unique(levels, levels + nl) - levels);
  int prev = 0;
  for (int li = 0; li < nl; li++) {
    int L = levels[li];
    double slice = 0;
    for (int i = 0; i < n; i++) slice += max(0, min(comm[i], L) - min(comm[i], prev));
    int bestScore = -1, cnt = 0;
    for (int i = 0; i < n; i++)
      if (live[i] && comm[i] >= L) {
        if (score[i] > bestScore) { bestScore = score[i]; cnt = 1; }
        else if (score[i] == bestScore) cnt++;
      }
    for (int i = 0; i < n; i++)
      if (live[i] && comm[i] >= L && score[i] == bestScore) won[i] += slice / cnt;
    prev = L;
  }
  for (int i = 0; i < n; i++) out[i] = won[i] - comm[i];
}

// net chips of every player at a finished hand
static void payoffs(const St& s, const Deal& d, double* out) {
  int comm[MAXN], live[MAXN], score[MAXN] = {0};
  for (int i = 0; i < NP; i++) { comm[i] = START - s.stack[i]; live[i] = !((s.folded >> i) & 1); }
  if (!s.showdown) {
    int total = 0;
    for (int i = 0; i < NP; i++) total += comm[i];
    for (int i = 0; i < NP; i++) out[i] = (i == s.winner ? total : 0) - comm[i];
    return;
  }
  for (int i = 0; i < NP; i++) {
    if (!live[i]) continue;
    int c[7] = {d.hole[i][0], d.hole[i][1], d.board[0], d.board[1], d.board[2], d.board[3], d.board[4]};
    score[i] = eval(c, 7);
  }
  settle(comm, live, score, NP, out);
}

static inline int liveOpponents(const St& s, int p) {
  int live = ((1 << NP) - 1) & ~s.folded & ~(1 << p);
  return popc(live);
}

static int bucketOf(const Deal& d, int p, int street, int k) {
  if (street == 0) return canon169(d.hole[p][0], d.hole[p][1]);
  return eqBucket(d.hole[p], d.board, 2 + street, k);
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

struct Ctx { Deal d; int bk[MAXN][4][MAXN]; float w; };

static double trav(const St& s, int tr, Ctx& c, Rng& rng) {
  if (s.over) { double u[MAXN]; payoffs(s, c.d, u); return u[tr]; }
  int p = s.toAct;
  Act acts[MAXA];
  int n = legal(s, acts);
  int k = liveOpponents(s, p);
  int& b = c.bk[p][s.street][k];
  if (b < 0) b = bucketOf(c.d, p, s.street, k);
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
  int np, start, nbuck, maxr, pmaxr, eqs, nfr, npfr;
  float fr[MAXSIZES], pfr[MAXSIZES];
  long long iters, count, round;
};
static const int MAGIC = 0x4845444A;

static Hdr makeHdr(int kind, long long iters, long long count, long long round) {
  Hdr h{};
  h.magic = MAGIC; h.kind = kind; h.np = NP; h.start = START; h.nbuck = NBUCK; h.maxr = MAXR; h.pmaxr = PMAXR; h.eqs = EQSAMPLES;
  h.nfr = (int)FRACS.size();
  for (int i = 0; i < h.nfr; i++) h.fr[i] = (float)FRACS[i];
  h.npfr = (int)PFRACS.size();
  for (int i = 0; i < h.npfr; i++) h.pfr[i] = (float)PFRACS[i];
  h.iters = iters; h.count = count; h.round = round;
  return h;
}
static void applyHdr(const Hdr& h) {
  NP = h.np; START = h.start; NBUCK = h.nbuck; MAXR = h.maxr; PMAXR = h.pmaxr; EQSAMPLES = h.eqs;
  FRACS.assign(h.fr, h.fr + h.nfr);
  PFRACS.assign(h.pfr, h.pfr + h.npfr);
  initOrders();
}

// rename() refuses to overwrite an existing file on Windows
static void replaceFile(const string& from, const string& to) {
#ifdef _WIN32
  remove(to.c_str());
#endif
  rename(from.c_str(), to.c_str());
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
  replaceFile(tmp, strategyPath);
  replaceFile(ctmp, ckptPath);
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

static bool loadStrategy(const string& path, Strat& S, Hdr* hout = nullptr) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  Hdr h;
  if (fread(&h, sizeof h, 1, f) != 1 || h.magic != MAGIC || h.kind != 1) { fclose(f); return false; }
  applyHdr(h);
  if (hout) *hout = h;
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

static int pickWeighted(const float* w, int n, const Act* acts, Rng& rng, bool ok) {
  float tot = 0;
  if (ok) for (int i = 0; i < n; i++) tot += w[i];
  if (!ok || tot <= 0) {   // unknown situation: check/call
    for (int i = 0; i < n; i++) if (acts[i].type == 1) return i;
    return 0;
  }
  double r = rng.uni() * tot, acc = 0;
  for (int i = 0; i < n; i++) { acc += w[i]; if (r < acc) return i; }
  return n - 1;
}

// Chooses an action index for the player to act from a strategy file.
static int botChoose(const Strat& S, const St& s, const Deal& d, const Act* acts, int n, Rng& rng) {
  int p = s.toAct;
  auto it = S.m.find(infoKey(s, p, bucketOf(d, p, s.street, liveOpponents(s, p))));
  float w[MAXA];
  bool ok = it != S.m.end() && it->second[0] == n;
  if (ok) for (int i = 0; i < n; i++) w[i] = it->second[1 + i];
  return pickWeighted(w, n, acts, rng, ok);
}

// ---------------------------------------------------------------- progress check during training
struct SnapRow { unsigned char p[MAXA]; unsigned char n; };
static vector<SnapRow> snapshot;

static long findSlot(u64 key) {
  if (key == 0) key = 1;
  size_t i = key & tableMask;
  for (int probe = 0; probe < 5000; probe++) {
    u64 k = table[i].key.load(memory_order_relaxed);
    if (k == key) return (long)i;
    if (k == 0) return -1;
    i = (i + 1) & tableMask;
  }
  return -1;
}

static void takeSnapshot() {
  snapshot.assign(tableSize, SnapRow{});
  for (size_t i = 0; i < tableSize; i++) {
    const Slot& nd = table[i];
    if (!nd.key.load(memory_order_relaxed)) continue;
    float tot = 0;
    for (int k = 0; k < nd.n; k++) tot += nd.sum[k];
    if (tot <= 0) continue;
    snapshot[i].n = nd.n;
    for (int k = 0; k < nd.n; k++) snapshot[i].p[k] = (unsigned char)lround(255.0 * nd.sum[k] / tot);
  }
}

static int chooseFromTable(const St& s, const Deal& d, const Act* acts, int n, Rng& rng, bool useSnapshot) {
  int p = s.toAct;
  long i = findSlot(infoKey(s, p, bucketOf(d, p, s.street, liveOpponents(s, p))));
  float w[MAXA];
  bool ok = i >= 0;
  if (ok) {
    if (useSnapshot) {
      const SnapRow& r = snapshot[i];
      ok = r.n == n;
      for (int k = 0; ok && k < n; k++) w[k] = r.p[k];
    } else {
      const Slot& nd = table[i];
      ok = nd.n == n;
      for (int k = 0; ok && k < n; k++) w[k] = nd.sum[k];
    }
  }
  return pickWeighted(w, n, acts, rng, ok);
}

// mbb/hand of the current strategy against the snapshot: every deal is played NP times, with the current strategy
// in each seat once and the snapshot in all other seats (this removes most of the card luck and the position effect).
static void evalVsSnapshot(long long deals, int threads, u64 seed, double& mean, double& ci) {
  vector<double> sum(threads, 0), sq(threads, 0);
  vector<long long> cnt(threads, 0);
  vector<thread> th;
  for (int t = 0; t < threads; t++)
    th.emplace_back([&, t]() {
      Rng rng(mix(seed + 977 * t));
      for (long long g = t; g < deals; g += threads) {
        Deal d; dealRandom(d, rng);
        double x = 0;
        for (int cur = 0; cur < NP; cur++) {
          St s = newHand();
          while (!s.over) {
            Act acts[MAXA];
            int n = legal(s, acts);
            s = step(s, acts[chooseFromTable(s, d, acts, n, rng, s.toAct != cur)]);
          }
          double u[MAXN]; payoffs(s, d, u);
          x += u[cur] / NP;
        }
        sum[t] += x; sq[t] += x * x; cnt[t]++;
      }
    });
  for (auto& x : th) x.join();
  double S = 0, Q = 0; long long N = 0;
  for (int t = 0; t < threads; t++) { S += sum[t]; Q += sq[t]; N += cnt[t]; }
  mean = S / N;
  double var = Q / N - mean * mean;
  ci = 1.96 * sqrt(max(var, 0.0) / N);
}

// ---------------------------------------------------------------- commands
static atomic<bool> g_stop{false};
static void onSigint(int) { g_stop = true; }

struct TrainOpts {
  long long iters = 1000000;
  int threads = 1, logSlots = 24;
  long long roundIters = 1000000;
  long long evalEvery = 0;      // iterations between "current vs previous snapshot" checks (0 = off)
  long long evalDeals = 50000;
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
  const string stopFile = o.out + ".stop";   // creating this file asks training to finish the round, save and exit
  remove(stopFile.c_str());
  printf("%d players, stack %d bb, %d buckets, sizes", NP, START / BB, NBUCK);
  for (double f : FRACS) printf(" %.2f", f);
  printf(" (postflop");
  for (double f : PFRACS) printf(" %.2f", f);
  printf("), max raises %d/%d, %d threads, table %.1f GB\n", MAXR, PMAXR, o.threads, tableSize * sizeof(Slot) / 1e9);
  auto t0 = chrono::steady_clock::now();
  auto lastSave = t0;
  long long start = done;
  long long lastEval = done;
  bool haveSnapshot = false;
  if (o.evalEvery > 0 && !o.resume.empty()) { takeSnapshot(); haveSnapshot = true; }
  while (done < o.iters && !g_stop) {
    round++;
    long long per = max(1LL, min(o.roundIters, o.iters - done) / o.threads);
    vector<thread> th;
    for (int t = 0; t < o.threads; t++)
      th.emplace_back([&, t]() {
        Rng rng(mix((u64)round * 1000003ULL + t + 17));
        Ctx c;
        c.w = (float)round;
        for (long long i = 0; i < per; i++) {
          dealRandom(c.d, rng);
          for (int tr = 0; tr < NP; tr++) {
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
    if (FILE* sf = fopen(stopFile.c_str(), "rb")) { fclose(sf); remove(stopFile.c_str()); g_stop = true; }
    if (o.evalEvery > 0 && done - lastEval >= o.evalEvery) {
      if (haveSnapshot) {
        double m, ci;
        evalVsSnapshot(o.evalDeals, o.threads, (u64)round, m, ci);
        printf("EVAL iter %lld: current vs snapshot from iter %lld: %+.1f mbb/hand (+-%.1f)\n", done, lastEval, m / BB * 1000, ci / BB * 1000);
        fflush(stdout);
      }
      takeSnapshot(); haveSnapshot = true; lastEval = done;
    }
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

static string actStr(const St& s, Act a) {
  int p = s.toAct;
  if (a.type == 0) return "fold";
  int maxBet = maxBetOf(s);
  if (a.type == 1) { int f = maxBet - s.bet[p]; return f > 0 ? "call " + to_string(min(f, s.stack[p])) : "check"; }
  bool allin = a.to - s.bet[p] >= s.stack[p];
  return string(maxBet > 0 ? "raise to " : "bet ") + to_string(a.to) + (allin ? " (all-in)" : "");
}

enum Policy { P_BOT, P_RANDOM, P_CALL, P_AGGRO };

static int policyChoose(Policy pol, const Strat& S, const St& s, const Deal& d, const Act* acts, int n, Rng& rng) {
  if (pol == P_BOT) return botChoose(S, s, d, acts, n, rng);
  if (pol == P_RANDOM) return rng.below(n);
  if (pol == P_CALL) { for (int i = 0; i < n; i++) if (acts[i].type == 1) return i; }
  for (int i = 0; i < n; i++) if (acts[i].type == 2) return i;   // aggro: smallest raise if available else call
  for (int i = 0; i < n; i++) if (acts[i].type == 1) return i;
  return 0;
}

// Bot (strategy file) against simple baseline bots. Each deal is played NP times, the bot sits in every seat once.
static int cmdEval(const string& path, long long hands) {
  Strat S;
  if (!loadStrategy(path, S)) { fprintf(stderr, "cannot load %s\n", path.c_str()); return 1; }
  printf("%d players, stack %d bb, %zu infosets\n", NP, START / BB, S.m.size());
  Rng rng(12345);
  const char* names[] = {"bot", "random", "always call", "always raise (min)"};
  for (int opp = P_RANDOM; opp <= P_AGGRO; opp++) {
    double total = 0, sq = 0;
    long long deals = max(1LL, hands / NP);
    for (long long g = 0; g < deals; g++) {
      Deal d; dealRandom(d, rng);
      double x = 0;
      for (int seat = 0; seat < NP; seat++) {
        St s = newHand();
        while (!s.over) {
          Act acts[MAXA];
          int n = legal(s, acts);
          Policy pol = s.toAct == seat ? P_BOT : (Policy)opp;
          s = step(s, acts[policyChoose(pol, S, s, d, acts, n, rng)]);
        }
        double u[MAXN]; payoffs(s, d, u);
        x += u[seat] / NP;
      }
      total += x; sq += x * x;
    }
    double mean = total / deals, var = sq / deals - mean * mean;
    double se = sqrt(max(var, 0.0) / deals);
    printf("bot vs %-20s %+9.1f mbb/hand  (+-%.1f)\n", names[opp], mean / BB * 1000, se / BB * 1000 * 1.96);
  }
  return 0;
}

// One copy of strategy A against NP-1 copies of strategy B (A in every seat once per deal).
static int cmdCompare(const string& pa, const string& pb, long long hands) {
  Strat A, B;
  Hdr ha, hb;
  if (!loadStrategy(pa, A, &ha) || !loadStrategy(pb, B, &hb)) { fprintf(stderr, "cannot load strategy files\n"); return 1; }
  bool same = ha.np == hb.np && ha.start == hb.start && ha.nbuck == hb.nbuck && ha.maxr == hb.maxr && ha.pmaxr == hb.pmaxr && ha.eqs == hb.eqs && ha.nfr == hb.nfr && ha.npfr == hb.npfr;
  for (int i = 0; same && i < ha.nfr; i++) same = ha.fr[i] == hb.fr[i];
  for (int i = 0; same && i < ha.npfr; i++) same = ha.pfr[i] == hb.pfr[i];
  if (!same) { fprintf(stderr, "the two strategies were trained with different game settings, they cannot play each other\n"); return 1; }
  applyHdr(ha);
  Rng rng(98765);
  double sum = 0, sq = 0;
  long long deals = max(1LL, hands / NP);
  for (long long g = 0; g < deals; g++) {
    Deal d; dealRandom(d, rng);
    double x = 0;
    for (int seatA = 0; seatA < NP; seatA++) {
      St s = newHand();
      while (!s.over) {
        Act acts[MAXA];
        int n = legal(s, acts);
        const Strat& S = s.toAct == seatA ? A : B;
        s = step(s, acts[botChoose(S, s, d, acts, n, rng)]);
      }
      double u[MAXN]; payoffs(s, d, u);
      x += u[seatA] / NP;
    }
    sum += x; sq += x * x;
  }
  double mean = sum / deals, var = sq / deals - mean * mean, se = sqrt(max(var, 0.0) / deals);
  printf("%d players, stack %d bb | %lld deals, A in every seat once per deal\n", NP, START / BB, deals);
  printf("A = %s (%zu infosets)\nB = %s (%zu infosets)\n", pa.c_str(), A.m.size(), pb.c_str(), B.m.size());
  printf("A vs %d x B: %+.1f mbb/hand (+-%.1f, 95%%)   [positive = A is stronger]\n", NP - 1, mean / BB * 1000, se / BB * 1000 * 1.96);
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
  printf("%d players, %d bb stacks, blinds %d/%d. Type the number of your action, q to quit.\n", NP, START / BB, SB, BB);
  printf("(You can only choose from the bots' bet sizes. Your seat rotates every hand; the bots all play the same strategy.)\n\n");
  while (true) {
    Deal d; dealRandom(d, rng);
    int me = hands % NP;
    hands++;
    St s = newHand();
    printf("=== hand %d | you are %s | your cards: %s\n", hands, seatName(me).c_str(), showCards(d.hole[me], 2).c_str());
    int shown = 0;
    while (!s.over) {
      if (s.street > shown) {
        shown = s.street;
        int total_pot = s.pot0;
        for (int i = 0; i < NP; i++) total_pot += s.bet[i];
        printf("--- board: %s   (pot %d)\n", showCards(d.board, 2 + s.street).c_str(), total_pot);
      }
      Act acts[MAXA];
      int n = legal(s, acts);
      if (s.toAct == me) {
        int pot = s.pot0;
        for (int i = 0; i < NP; i++) pot += s.bet[i];
        printf("pot %d | you %d behind (bet %d) | to call %d\n", pot, s.stack[me], s.bet[me], maxBetOf(s) - s.bet[me]);
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
        printf("%s: %s\n", seatName(s.toAct).c_str(), actStr(s, acts[i]).c_str());
        s = step(s, acts[i]);
      }
    }
    double u[MAXN];
    payoffs(s, d, u);
    total += u[me];
    if (s.showdown) {
      printf("showdown:");
      for (int i = 0; i < NP; i++) if (!((s.folded >> i) & 1) && i != me) printf("  %s %s", seatName(i).c_str(), showCards(d.hole[i], 2).c_str());
      printf("  | board %s\n", showCards(d.board, 5).c_str());
    }
    printf("result: %+.1f bb | session: %+.1f bb\n\n", u[me] / BB, total / BB);
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
  check(eqBucket(aa, flop, 3, 1) == eqBucket(aa, flop, 3, 1), "bucket deterministic");
  check(eqBucket(aa, flop, 3, 1) > eqBucket(seven2, flop, 3, 1), "set of aces ranks above 7-2 on A-K-3");
  check(eqBucket(aa, flop, 3, 4) > eqBucket(seven2, flop, 3, 4), "same, 4 opponents");
  { set<int> seen; for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++) seen.insert(canon169(a, b)); check(seen.size() == 169, "169 preflop classes"); }

  // 4. side pots
  {
    int comm[3] = {100, 50, 20}, live[3] = {1, 1, 1}, score[3] = {1, 2, 3};
    double out[MAXN];
    settle(comm, live, score, 3, out);
    check(fabs(out[0] + 50) < 1e-9 && fabs(out[1] - 10) < 1e-9 && fabs(out[2] - 40) < 1e-9, "side pots: 100/50/20 all-in, best hand has the smallest stack");
    int comm2[4] = {30, 30, 30, 10}, live2[4] = {1, 1, 0, 1}, score2[4] = {5, 5, 0, 1};
    settle(comm2, live2, score2, 4, out);
    check(fabs(out[0] - 20) < 1e-9 && fabs(out[1] - 20) < 1e-9 && fabs(out[2] + 30) < 1e-9 && fabs(out[3] + 10) < 1e-9, "split pot with a folded player's dead money");
  }

  // 5. random playouts for every table size: terminate, zero-sum, chips conserved, no negative stacks
  for (int np = 2; np <= MAXN; np++) {
    NP = np; initOrders();
    Rng rng(7 + np);
    bool ok = true;
    long long showdowns = 0, folds = 0;
    for (int g = 0; g < 100000 && ok; g++) {
      Deal d; dealRandom(d, rng);
      St s = newHand();
      int steps = 0;
      while (!s.over) {
        Act acts[MAXA];
        int n = legal(s, acts);
        if (n < 1 || ++steps > 200) { ok = false; break; }
        s = step(s, acts[rng.below(n)]);
        for (int i = 0; i < NP; i++) if (s.stack[i] < 0) ok = false;
      }
      if (!ok) break;
      double u[MAXN], tot = 0;
      payoffs(s, d, u);
      for (int i = 0; i < NP; i++) tot += u[i];
      ok &= fabs(tot) < 1e-6;
      (s.showdown ? showdowns : folds)++;
    }
    char msg[100];
    snprintf(msg, sizeof msg, "%d players: 100k random hands terminate, zero-sum (showdowns %lld, fold wins %lld)", np, showdowns, folds);
    check(ok, msg);
  }
  NP = 2; initOrders();
  { St s = newHand(); Act a[MAXA]; int n = legal(s, a);
    string acts; for (int i = 0; i < n; i++) acts += actStr(s, a[i]) + "; ";
    printf("     heads-up SB first action: %s\n", acts.c_str());
    check(n >= 4, "SB has fold/call/raise options"); }
  { NP = 6; initOrders(); St s = newHand();
    check(s.toAct == 3, "6-max: UTG acts first preflop");
    Act a[MAXA]; int n = legal(s, a);
    s = step(s, a[0]);   // UTG folds
    check(s.toAct == 4, "6-max: HJ acts next");
    NP = 2; initOrders(); }
  printf("%s\n", fails ? "SOME TESTS FAILED" : "all tests passed");
  return fails != 0;
}

int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: holdem test | train | play FILE | eval FILE | compare A B\n"); return 1; }
  string cmd = argv[1];
  auto arg = [&](const char* name, const char* def) -> string {
    for (int i = 2; i + 1 < argc; i++) if (!strcmp(argv[i], name)) return argv[i + 1];
    return def;
  };
  initOrders();
  if (cmd == "test") return cmdTest();
  if (cmd == "train") {
    TrainOpts o;
    o.iters = atoll(arg("--iters", "1000000").c_str());
    o.threads = atoi(arg("--threads", "1").c_str());
    o.logSlots = atoi(arg("--slots", "24").c_str());
    o.roundIters = atoll(arg("--round", "1000000").c_str());
    o.out = arg("--out", "strategy.bin");
    o.resume = arg("--resume", "");
    o.evalEvery = atoll(arg("--eval-every", "0").c_str());
    o.evalDeals = atoll(arg("--eval-deals", "50000").c_str());
    if (o.resume.empty()) {
      NP = atoi(arg("--players", "2").c_str());
      if (NP < 2 || NP > MAXN) { fprintf(stderr, "--players must be 2..%d\n", MAXN); return 1; }
      initOrders();
      START = BB * atoi(arg("--stack", "20").c_str());
      NBUCK = atoi(arg("--buckets", "24").c_str());
      MAXR = atoi(arg("--maxraises", "3").c_str());
      PMAXR = atoi(arg("--post-maxraises", to_string(MAXR).c_str()).c_str());
      EQSAMPLES = atoi(arg("--eqsamples", "100").c_str());
      string sz = arg("--sizes", "0.5,1.0");
      auto parse = [](const string& text, vector<double>& out) {
        out.clear();
        stringstream ss(text);
        string tok;
        while (getline(ss, tok, ',') && out.size() < (size_t)MAXSIZES) out.push_back(atof(tok.c_str()));
      };
      parse(sz, FRACS);
      parse(arg("--post-sizes", sz.c_str()), PFRACS);
    }
    return cmdTrain(o);
  }
  if (cmd == "play" && argc >= 3) return cmdPlay(argv[2]);
  if (cmd == "compare" && argc >= 4) return cmdCompare(argv[2], argv[3], atoll(arg("--hands", "100000").c_str()));
  if (cmd == "eval" && argc >= 3) return cmdEval(argv[2], atoll(arg("--hands", "50000").c_str()));
  fprintf(stderr, "bad arguments\n");
  return 1;
}
