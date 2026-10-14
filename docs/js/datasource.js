import { parseSavedVariables } from "./luaparse.js?v=fc4af501";
import { decodeCbor } from "./cbor.js?v=fc4af501";
import { pricePoint } from "./engine.js?v=fc4af501";

// Zamienia zawartość pliku SavedVariables na model danych strony:
// { source, items: Map(id -> history[]), known: Set(recipeId), scannedAt (sekundy) }
// albo { error } z podpowiedzią, co jest w pliku.
export function loadSavedVariables(text) {
  let vars;
  try {
    vars = parseSavedVariables(text);
  } catch (e) {
    return { error: `Nie udało się odczytać pliku: ${e.message}` };
  }

  if (vars.DealHunterAHDB) return fromDealHunter(vars.DealHunterAHDB);
  if (vars.AUCTIONATOR_PRICE_DATABASE) return fromAuctionator(vars.AUCTIONATOR_PRICE_DATABASE, vars.AUCTIONATOR_SAVEDVARS);

  const names = Object.keys(vars);
  const looksAuctionator = names.some((n) => /auctionator/i.test(n));
  return {
    error: looksAuctionator
      ? "Rozpoznano plik Auctionatora, ale bez bazy cen (AUCTIONATOR_PRICE_DATABASE). Wgraj plik z konta (SavedVariables) po skanie i /reload."
      : `Nie rozpoznano pliku. Zmienne w pliku: ${names.slice(0, 8).join(", ") || "(brak)"}.`,
  };
}

function fromDealHunter(db) {
  const items = new Map();
  let scannedAt = 0;
  for (const [id, entry] of Object.entries(db.items ?? {})) {
    const history = (entry.history ?? [])
      .filter((p) => typeof p.t === "number")
      .sort((a, b) => a.t - b.t);
    if (!history.length) continue;
    items.set(Number(id), history);
    scannedAt = Math.max(scannedAt, history[history.length - 1].t);
  }
  const known = new Set();
  for (const set of Object.values(db.known ?? {})) {
    // tabela { [1]=true, [2]=true } parser zwraca jako tablicę (indeks + 1 = id)
    if (Array.isArray(set)) set.forEach((v, i) => { if (v) known.add(i + 1); });
    else for (const id of Object.keys(set)) known.add(Number(id));
  }
  return { source: "DealHunterAH", items, known, scannedAt };
}

// Kontekst cenowy dla silnika. catalog: { items: {id: {name, vendorSell, vendorBuy, quality, ilvl}}, disenchant }
export function makeContext(model, catalog = {}) {
  const items = catalog.items ?? {};
  return {
    ahPrice(id, mode) {
      if (items[id]?.bop) return null; // przedmiotów BoP nie da się sprzedać na AH
      const h = model.items.get(id);
      return pricePoint(h?.[h.length - 1], mode);
    },
    ahQty(id) {
      const h = model.items.get(id);
      return h?.[h.length - 1]?.qty ?? null;
    },
    vendorSell: (id) => items[id]?.vendorSell ?? null,
    vendorBuy: (id) => catalog.vendors?.[id] ?? items[id]?.vendorBuy ?? null,
    disenchant: (id) => catalog.disenchant?.(id) ?? null,
    deSample: (id) => catalog.disenchant?.sample?.(id) ?? null,
  };
}

// de: zawartość disenchant.json ({brackets: {id: {n, outcomes: [[materiał, szansa, [[ilość, udział], ...]]]}}, items: {id: bracket}}).
// Zwraca funkcję id -> [{item, chance, qty (średnia), dist}] albo null dla przedmiotów, których nie da się rozbić.
// fn.sample(id) -> liczba obserwacji, na których oparto wynik.
export function makeDisenchant(de) {
  if (!de?.items) return null;
  const bracketOf = (id) => de.brackets?.[de.items[id]];
  const fn = (id) => {
    const bracket = bracketOf(id);
    if (!bracket) return null;
    return bracket.outcomes.map(([item, chance, dist]) => ({
      item, chance, dist, qty: dist.reduce((s, [q, share]) => s + q * share, 0),
    }));
  };
  fn.sample = (id) => bracketOf(id)?.n ?? null;
  return fn;
}

// ---------- Auctionator ----------
// AUCTIONATOR_PRICE_DATABASE = { __dbversion = N, ["Serwer Frakcja"] = <napis binarny CBOR>, ... }
// Po zdekodowaniu: klucz przedmiotu ("12345" albo "gr:12345:of the Boar" dla przedmiotów z losowym przyrostkiem)
// -> { m: ostatnia najniższa cena, a: { dzień: ilość }, h: { dzień: cena }, l: { dzień: niższa cena } }.
// Dzień = liczba dni od 2020-01-01 (UTC). Auctionator nie zapisuje mediany ani średniej, tylko najniższe ceny.
const AUCTIONATOR_EPOCH = 1577836800; // 2020-01-01T00:00:00Z

export function auctionatorItems(decoded) {
  const merged = new Map(); // itemId -> day -> {low, high, qty}
  for (const [key, entry] of Object.entries(decoded)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue; // np. "version": 2
    const m = /^(?:gr:)?(\d+)(?::|$)/.exec(key);
    if (!m) continue; // inne typy kluczy (np. pety) pomijamy
    const id = Number(m[1]);
    const days = new Map();
    const a = entry.a ?? {}, h = entry.h ?? {}, l = Array.isArray(entry.l) ? {} : entry.l ?? {};
    for (const day of new Set([...Object.keys(a), ...Object.keys(h), ...Object.keys(l)])) {
      const high = h[day] ?? l[day];
      const low = l[day] ?? h[day];
      if (low == null) continue;
      days.set(day, { low, high, qty: a[day] ?? 0 });
    }
    // ostatnia najniższa cena (m) zastępuje cenę najnowszego dnia
    const latestDay = [...days.keys()].sort((x, y) => Number(x) - Number(y)).pop();
    if (latestDay !== undefined && typeof entry.m === "number") days.get(latestDay).low = Math.min(days.get(latestDay).low, entry.m);

    if (!merged.has(id)) merged.set(id, new Map());
    const into = merged.get(id);
    for (const [day, p] of days) { // warianty przyrostków łączymy: najtańszy wariant, sumaryczna ilość
      const cur = into.get(day);
      into.set(day, cur ? { low: Math.min(cur.low, p.low), high: Math.max(cur.high ?? 0, p.high ?? 0), qty: cur.qty + p.qty } : { ...p });
    }
  }
  const items = new Map();
  for (const [id, days] of merged) {
    const history = [...days].sort((x, y) => Number(x[0]) - Number(y[0])).map(([day, p]) => ({
      t: AUCTIONATOR_EPOCH + Number(day) * 86400 + 43200, low: p.low, high: p.high, qty: p.qty,
    }));
    if (history.length) items.set(id, history);
  }
  return items;
}

function fromAuctionator(db, savedVars) {
  const houses = {};
  for (const [name, blob] of Object.entries(db)) {
    if (name === "__dbversion" || typeof blob !== "string") continue;
    try {
      houses[name] = auctionatorItems(decodeCbor(blob));
    } catch (e) {
      return { error: `Nie udało się zdekodować cen Auctionatora (${name}): ${e.message}` };
    }
  }
  const names = Object.keys(houses).filter((n) => houses[n].size).sort((a, b) => houses[b].size - houses[a].size);
  if (!names.length) return { error: "W bazie Auctionatora nie ma żadnych cen. Zrób skan AH i wpisz /reload." };
  const model = { source: "Auctionator", houses, house: names[0], known: new Set(), noMedian: true };
  selectHouse(model, names[0]);
  const scan = savedVars?.TimeOfLastGetAllScan;
  if (typeof scan === "number") model.scannedAt = scan; // dokładny czas ostatniego pełnego skanu
  return model;
}

// Przełącza model Auctionatora na inny serwer/frakcję (house).
export function selectHouse(model, name) {
  model.house = name;
  model.items = model.houses[name];
  model.scannedAt = 0;
  for (const h of model.items.values()) model.scannedAt = Math.max(model.scannedAt, h[h.length - 1].t);
}
