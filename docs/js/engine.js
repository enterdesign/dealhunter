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

// history: [{t, low, median, avg}] rosnąco po t (t w sekundach).
export function trend(history, { days = 7, flat = 0.05, field = "median" } = {}) {
  if (!history.length) return null;
  const cutoff = history[history.length - 1].t - days * 86400;
  const pts = history.filter((h) => h.t >= cutoff && h[field] != null);
  if (pts.length < 3) return null;
  const base = pts.slice(0, -1).reduce((s, p) => s + p[field], 0) / (pts.length - 1);
  const current = pts[pts.length - 1][field];
  const change = current / base - 1;

  const t0 = pts[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const x = (p.t - t0) / 86400;
    sx += x; sy += p[field]; sxx += x * x; sxy += x * p[field];
  }
  const n = pts.length;
  const den = n * sxx - sx * sx;
  const slope = den !== 0 ? (n * sxy - sx * sy) / den / base : 0;
  const dir = change > flat ? "up" : change < -flat ? "down" : "flat";
  return { change, slope, dir, baseline: base, current, points: n };
}

// ctx: { vendorSell(id), ahPrice(id, mode), disenchant(id) -> [{item, qty, chance}] | null }
export function itemValue(itemId, ctx, { sellMode = "median", fee = FEE_DEFAULTS } = {}) {
  const out = {};
  const vendor = ctx.vendorSell(itemId);
  if (vendor > 0) out.vendor = vendor;

  const gross = ctx.ahPrice(itemId, sellMode);
  if (gross != null) { out.ahGross = gross; out.ah = netProceeds(gross, fee); }

  const de = ctx.disenchant?.(itemId);
  if (de) {
    let total = 0, incomplete = false;
    for (const o of de) {
      const p = ctx.ahPrice(o.item, sellMode);
      if (p != null) total += o.chance * o.qty * netProceeds(p, fee);
      else incomplete = true;
    }
    out.disenchant = total;
    if (incomplete) out.deIncomplete = true;
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
    const ah = ctx.ahPrice(r.item, buyMode);
    const vb = ctx.vendorBuy?.(r.item);
    const unit = ah != null && vb != null ? Math.min(ah, vb) : ah ?? vb;
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
