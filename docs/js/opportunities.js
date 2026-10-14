// Wyszukiwanie okazji na podstawie skanu AH. Wszystkie ceny w miedzi, wszystkie funkcje czyste (testowalne).
//
// model: { items: Map(id -> history[]) }   catalog: { items: {id: {name, vendorSell, bop, ...}} }
import { trend, netProceeds, itemValue, rankRecipes } from "./engine.js";

export const NO_PROFESSION = "__none";

export function professionIndex(recipes) {
  const idx = new Map(); // itemId -> Set(profession)
  const add = (id, prof) => { if (!idx.has(id)) idx.set(id, new Set()); idx.get(id).add(prof); };
  for (const r of recipes) {
    add(r.produces, r.profession);
    for (const g of r.reagents) add(g.item, r.profession);
  }
  return idx;
}

export function matchesProfession(profs, filter) {
  if (!filter) return true;
  if (filter === NO_PROFESSION) return !profs || profs.length === 0;
  return !!profs && profs.includes(filter);
}

const last = (h) => h[h.length - 1];
const nameOf = (catalog, id) => catalog.items?.[id]?.name ?? `#${id}`;
const profsOf = (idx, id) => [...(idx.get(id) ?? [])].sort();

function row(base) {
  const r = { ...base };
  r.roi = r.cost > 0 ? r.profit / r.cost : null;
  return r;
}

// A. Kup na AH za mniej, niż płaci kupiec, i sprzedaj kupcowi.
export function vendorFlips(model, catalog, idx, { buyMode = "low", minProfit = 1 } = {}) {
  const out = [];
  for (const [id, h] of model.items) {
    const sell = catalog.items?.[id]?.vendorSell;
    const cost = last(h)[buyMode];
    if (!sell || cost == null) continue;
    const profit = sell - cost;
    if (profit < minProfit) continue;
    out.push(row({ kind: "vendor", id, name: nameOf(catalog, id), cost, value: sell, profit,
      qty: last(h).qty, professions: profsOf(idx, id) }));
  }
  return out;
}

// B1. Receptury: kup składniki, wytwórz, sprzedaj (silnik z engine.js).
export function craftFlips(recipes, ctx, opts) {
  return rankRecipes(recipes, ctx, opts).map((r) => row({
    kind: "craft", id: r.recipe.id, name: r.recipe.name, cost: r.cost, value: r.value, profit: r.profit,
    use: r.use, known: r.known, complete: r.complete, professions: [r.recipe.profession], result: r,
  }));
}

// B2. Rozbiór: kup przedmiot na AH, rozbierz, sprzedaj materiały (Enchanting).
export function disenchantFlips(model, catalog, ctx, { buyMode = "low", sellMode = "median", fee, minProfit = 1 } = {}) {
  const out = [];
  for (const [id, h] of model.items) {
    const cost = last(h)[buyMode];
    const outcomes = ctx.disenchant?.(id);
    if (cost == null || !outcomes) continue;
    const v = itemValue(id, { ...ctx, vendorSell: () => null, ahPrice: (i, m) => (i === id ? null : ctx.ahPrice(i, m)) },
      { sellMode, fee });
    if (!v || v.disenchant == null || v.deIncomplete) continue;
    const profit = v.disenchant - cost;
    if (profit < minProfit) continue;
    out.push(row({ kind: "disenchant", id, name: nameOf(catalog, id), cost, value: v.disenchant, profit,
      qty: last(h).qty, professions: ["Enchanting"] }));
  }
  return out;
}

// C. Flipy na AH wg historii: kup poniżej typowej ceny z przeszłości, sprzedaj w typowej cenie.
// ref = mediana wcześniejszych median (bez ostatniego skanu), cost = ostatnia najniższa cena.
export function ahFlips(model, catalog, idx, { minPoints = 3, minDiscount = 0.1, minPrice = 100,
  sellMode = "median", fee, trendOpts } = {}) {
  const out = [];
  for (const [id, h] of model.items) {
    if (h.length < minPoints || catalog.items?.[id]?.bop) continue;
    const refs = h.slice(0, -1).map((p) => p[sellMode]).filter((x) => x != null).sort((a, b) => a - b);
    const cost = last(h).low;
    if (!refs.length || cost == null) continue;
    const ref = refs[Math.floor((refs.length - 1) / 2)];
    if (ref < minPrice) continue;
    const profit = netProceeds(ref, fee) - cost;
    if (profit <= 0 || ref / cost - 1 < minDiscount) continue;
    out.push(row({ kind: "ah", id, name: nameOf(catalog, id), cost, value: ref, profit, qty: last(h).qty,
      trend: trend(h, trendOpts), professions: profsOf(idx, id) }));
  }
  return out;
}

// D. Inwestycje z guidów: przedmioty polecane w strategiach, z aktualną ceną i dystansem do historii.
// watch: [{name, value (wg guida), strategy, profession}]
export function resolveWatchlist(strategies, catalog, model) {
  const byName = new Map();
  for (const [id, it] of Object.entries(catalog.items ?? {})) {
    if (!byName.has(it.name)) byName.set(it.name, []);
    byName.get(it.name).push(Number(id));
  }
  const watch = [];
  for (const s of strategies) {
    for (const item of s.items ?? []) {
      const ids = byName.get(item.name) ?? [];
      const scanned = ids.filter((i) => model.items.has(i));
      const id = (scanned.length ? scanned : ids)[0];
      if (id == null) continue;
      watch.push({ id, name: item.name, guideValue: item.value, strategy: s.title, profession: s.profession });
    }
  }
  return watch;
}

export function guideInvestments(watch, model, catalog, { sellMode = "median", fee, trendOpts } = {}) {
  const out = [];
  const seen = new Set();
  for (const w of watch) {
    const h = model.items.get(w.id);
    if (!h || seen.has(`${w.id}:${w.profession}`)) continue;
    seen.add(`${w.id}:${w.profession}`);
    const cost = last(h).low;
    const refs = h.slice(0, -1).map((p) => p[sellMode]).filter((x) => x != null).sort((a, b) => a - b);
    const ref = refs.length ? refs[Math.floor((refs.length - 1) / 2)] : last(h)[sellMode];
    if (cost == null || ref == null) continue;
    const profit = netProceeds(ref, fee) - cost;
    out.push(row({ kind: "guide", id: w.id, name: w.name, cost, value: ref, profit, qty: last(h).qty,
      guideValue: w.guideValue, strategy: w.strategy, trend: trend(h, trendOpts),
      professions: w.profession && w.profession !== "Ogólne" ? [w.profession] : [] }));
  }
  return out;
}

// Wspólne: filtr profesji i sortowanie (malejąco domyślnie; dir = "asc" odwraca).
export function filterRows(rows, profession) {
  return rows.filter((r) => matchesProfession(r.professions, profession));
}

export function sortRows(rows, key = "profit", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity;
    return x !== y ? sign * (x - y) : String(a.name).localeCompare(String(b.name));
  });
}

// Sprawdzenia przy strategiach: aktualne najlepsze okazje z danych użytkownika (null = brak skanu).
export function runCheck(check, { recipes, model, catalog, ctx, opts = {} }) {
  if (!check || !model.items.size) return null;
  const top = (rows) => sortRows(rows, "profit").slice(0, 3);
  if (check.type === "topRecipes") return top(craftFlips(recipes, ctx, { ...opts, profession: check.profession }));
  if (check.type === "topDisenchant") return top(disenchantFlips(model, catalog, ctx, opts));
  return null;
}
