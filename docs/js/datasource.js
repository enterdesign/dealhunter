import { parseSavedVariables } from "./luaparse.js";

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

  const names = Object.keys(vars);
  const looksAuctionator = names.some((n) => /auctionator/i.test(n));
  return {
    error: looksAuctionator
      ? "Rozpoznano plik Auctionatora, ale jego format nie jest jeszcze obsługiwany. Wyślij próbkę, a dodam parser."
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
      const last = h?.[h.length - 1];
      return last?.[mode] ?? null;
    },
    vendorSell: (id) => items[id]?.vendorSell ?? null,
    vendorBuy: (id) => catalog.vendors?.[id] ?? items[id]?.vendorBuy ?? null,
    disenchant: (id) => catalog.disenchant?.(id, items[id]) ?? null,
  };
}

// de: zawartość disenchant.json ({brackets: {id: {n, outcomes: [[materiał, szansa, ilość]]}}, items: {id: bracket}}).
// Zwraca funkcję id -> [{item, chance, qty}] albo null dla przedmiotów, których nie da się rozbić.
export function makeDisenchant(de) {
  if (!de?.items) return null;
  return (id) => {
    const bracket = de.brackets?.[de.items[id]];
    if (!bracket) return null;
    return bracket.outcomes.map(([item, chance, qty]) => ({ item, chance, qty }));
  };
}
