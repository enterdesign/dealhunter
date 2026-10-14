// Silnik wyceny (port addon/DealHunterAH/src/*.lua). Wszystkie ceny w miedzi.

export const FEE_DEFAULTS = { enabled: false, cut: 0.05 };

export function netProceeds(price, fee = FEE_DEFAULTS) {
  return fee.enabled ? price * (1 - fee.cut) : price;
}

// listings: [{unit, qty}] -> {low, median (ważona ilością), avg (ważona), qty, n} | null
export function summarize(listings) {
  const rows = listings.filter((l) => l.unit > 0 && l.qty > 0).sort((a, b) => a.unit - b.unit);
  const total = rows.reduce((s, r) => s + r.qty, 0);
  if (!total) return null;
  const sum = rows.reduce((s, r) => s + r.unit * r.qty, 0);
  let acc = 0;
  let median = rows[rows.length - 1].unit;
  for (const r of rows) {
    acc += r.qty;
    if (acc >= total / 2) { median = r.unit; break; }
  }
  return { low: rows[0].unit, median, avg: sum / total, qty: total, n: rows.length };
}

// Cena z punktu historii dla wybranego trybu (low/median/avg). Źródła, które nie mają mediany ani średniej
// (np. Auctionator), dają w zamian najniższą cenę.
export const pricePoint = (p, mode) => p?.[mode] ?? p?.low ?? null;

// history: [{t, low, median, avg}] rosnąco po t (t w sekundach).
export function trend(history, { days = 7, flat = 0.05, field = "median" } = {}) {
  if (!history.length) return null;
  const cutoff = history[history.length - 1].t - days * 86400;
  const pts = history.filter((h) => h.t >= cutoff && pricePoint(h, field) != null);
  if (pts.length < 3) return null;
  const base = pts.slice(0, -1).reduce((s, p) => s + pricePoint(p, field), 0) / (pts.length - 1);
  const current = pricePoint(pts[pts.length - 1], field);
  const change = current / base - 1;

  const t0 = pts[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const x = (p.t - t0) / 86400;
    const y = pricePoint(p, field);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const n = pts.length;
  const den = n * sxx - sx * sx;
  const slope = den !== 0 ? (n * sxy - sx * sy) / den / base : 0;
  const dir = change > flat ? "up" : change < -flat ? "down" : "flat";
  return { change, slope, dir, baseline: base, current, points: n };
}

// ctx: { vendorSell(id), ahPrice(id, mode), disenchant(id) -> [{item, chance, qty, dist?}] | null }
export function itemValue(itemId, ctx, { sellMode = "median", fee = FEE_DEFAULTS } = {}) {
  const out = {};
  const vendor = ctx.vendorSell(itemId);
  if (vendor > 0) out.vendor = vendor;

  const gross = ctx.ahPrice(itemId, sellMode);
  if (gross != null) { out.ahGross = gross; out.ah = netProceeds(gross, fee); }

  const de = ctx.disenchant?.(itemId);
  if (de) {
    const stats = disenchantStats(de, (id) => {
      const p = ctx.ahPrice(id, sellMode);
      return p == null ? null : netProceeds(p, fee);
    });
    out.disenchant = stats.ev;
    out.deStats = stats;
    if (stats.incomplete) out.deIncomplete = true;
  }

  let best = null, value = null;
  for (const name of ["vendor", "ah", "disenchant"]) {
    if (out[name] != null && (value === null || out[name] > value)) { best = name; value = out[name]; }
  }
  if (best === null) return null;
  return { ...out, best, value };
}

// recipe: {id, name, profession, skill, produces, qty, reagents:[{item,count}], source}
export function evaluateRecipe(recipe, ctx, opts = {}) {
  const buyMode = opts.buyMode ?? "low";
  let cost = 0;
  const missing = [];
  for (const r of recipe.reagents) {
    // składnik sprzedawany przez kupca zawsze liczymy po cenie kupca (ma nieograniczony zapas), nie z AH
    const vb = ctx.vendorBuy?.(r.item);
    const unit = vb != null ? vb : ctx.ahPrice(r.item, buyMode);
    if (unit != null) cost += unit * r.count; else missing.push(r.item);
  }
  const res = { recipe, cost, missing };
  const val = itemValue(recipe.produces, ctx, opts);
  if (val) {
    res.valueInfo = val;
    res.use = val.best;
    res.value = val.value * (recipe.qty ?? 1);
    res.profit = res.value - cost;
    res.roi = cost > 0 ? res.profit / cost : null;
  }
  res.complete = missing.length === 0 && !!val && !val.deIncomplete;
  return res;
}

// opts: profession, known (Set id), knownOnly, includeIncomplete, minProfit, sortBy
export function rankRecipes(recipes, ctx, opts = {}) {
  const out = [];
  for (const recipe of recipes) {
    if (opts.profession && recipe.profession !== opts.profession) continue;
    const known = !!opts.known?.has(recipe.id);
    if (opts.knownOnly && !known) continue;
    const res = evaluateRecipe(recipe, ctx, opts);
    res.known = known;
    if (res.profit == null) continue;
    if (!res.complete && !opts.includeIncomplete) continue;
    if (opts.minProfit != null && res.profit < opts.minProfit) continue;
    out.push(res);
  }
  const key = opts.sortBy ?? "profit";
  out.sort((a, b) => {
    const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity;
    return x !== y ? y - x : a.recipe.id - b.recipe.id;
  });
  return out;
}

export function formatMoney(c) {
  if (c == null || Number.isNaN(c)) return "?";
  c = Math.round(c);
  const sign = c < 0 ? "-" : "";
  c = Math.abs(c);
  return `${sign}${Math.floor(c / 10000)}g ${Math.floor(c / 100) % 100}s ${c % 100}c`;
}

export function formatPct(x) {
  return x == null ? "-" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
}

// Wartość rozbioru jako rozkład: wartość oczekiwana (EV), odchylenie standardowe, najczęstsze scenariusze.
// outcomes: [{item, chance, qty, dist: [[ilość, udział], ...]}]; priceOf(id) -> cena netto za sztukę | null.
// Gdy szanse materiałów sumują się do <= 1, wyniki wykluczają się (jeden materiał na rozbiór) i rozrzut
// liczymy dokładnie; w przeciwnym razie zakładamy niezależność materiałów (przybliżenie).
export function disenchantStats(outcomes, priceOf) {
  const totalChance = outcomes.reduce((s, o) => s + o.chance, 0);
  const exclusive = totalChance <= 1.02;
  let ev = 0, ev2 = 0, varIndep = 0, incomplete = false;
  const scenarios = [];
  for (const o of outcomes) {
    const price = priceOf(o.item);
    if (price == null) incomplete = true;
    const dist = o.dist?.length ? o.dist : [[o.qty ?? 1, 1]];
    let mean = 0, mean2 = 0;
    for (const [q, share] of dist) {
      const p = o.chance * share;
      const v = price == null ? 0 : q * price;
      scenarios.push({ item: o.item, qty: q, p, v, known: price != null });
      mean += p * v; mean2 += p * v * v;
    }
    ev += mean; ev2 += mean2;
    varIndep += mean2 - mean * mean;
  }
  const variance = exclusive ? ev2 - ev * ev : varIndep;
  scenarios.sort((a, b) => b.p - a.p);
  return { ev, sd: Math.sqrt(Math.max(0, variance)), scenarios, top: scenarios.slice(0, 2),
    exclusive, coverage: totalChance, incomplete };
}

// Pewność wyniku wg liczby obserwacji w próbie.
export function confidenceLabel(n) {
  if (n == null) return "nieznana";
  return n >= 500 ? "wysoka" : n >= 100 ? "średnia" : "niska";
}
