import { loadSavedVariables, makeContext, makeDisenchant, selectHouse } from "./datasource.js?v=af658772";
import { kvSet, kvGet, kvDelete } from "./store.js?v=af658772";
import { trend, formatMoney, formatPct, netProceeds } from "./engine.js?v=af658772";
import {
  professionIndex, vendorFlips, craftFlips, disenchantFlips, ahFlips, resolveWatchlist, guideInvestments,
  filterRows, sortRows, runCheck, onlyProfitable, filterReliable, filterBop, NO_PROFESSION,
} from "./opportunities.js?v=af658772";

const $ = (id) => document.getElementById(id);
const MODE = document.body.dataset.mode || "tbc";
const DATA = `../data/${MODE}/`;
const STORE_KEY = `dealhunter-ah.${MODE}.model.v1`;
const TREND_LABEL = { up: "▲", down: "▼", flat: "▬" };
const USE_LABEL = { vendor: "kupiec", ah: "AH", disenchant: "rozbiór" };

const DEAL_KINDS = [
  { id: "vendor", label: "Flipy do vendora",
    help: "Kup na AH taniej, niż płaci kupiec, i sprzedaj kupcowi. Pokazujemy wszystkie skanowane przedmioty (zysk może być ujemny)." },
  { id: "craft", label: "Flipy do profesji",
    help: "Receptura: koszt składników Y, Z (z AH albo od kupca; składniki sprzedawane przez kupców liczymy po cenie kupca) porównany osobno z: ceną wyrobu X na AH, ceną X u kupca i EV materiałów z rozbioru X. Pod każdą wartością widać zysk albo stratę tej opcji; \"Zysk (najlepsza opcja)\" dotyczy najlepszej z nich (nazwa opcji pod kwotą). \"Trend X\" pokazuje, czy gotowy wyrób jest poszukiwany (cena i liczba ofert z Twoich skanów, potrzebne min. 3). Receptury z bazy gry, także nieznane." },
  { id: "disenchant", label: "Rozbiór",
    help: "Kup przedmiot na AH i go rozbierz: wartość oczekiwana (EV) materiałów z rozbioru, rozrzut i pewność wyniku. Kliknij wiersz, żeby zobaczyć dwa najczęstsze wyniki." },
  { id: "ah", label: "Flipy na AH",
    help: "Aktualna najniższa cena kontra mediana z historii Twoich skanów (potrzebne co najmniej 3 skany). Dodatni zysk = taniej niż zwykle." },
  { id: "guide", label: "Inwestycje z guidów",
    help: "Przedmioty polecane w guidach (zakładka Strategie) z aktualną ceną i dystansem do typowej ceny." },
];

const state = {
  model: { items: new Map(), known: new Set(), scannedAt: 0 },
  recipes: [], catalog: { items: {} }, strategies: [], profIdx: new Map(), watch: [],
  tab: "deals", deal: "craft", profession: "", sortBy: "profit", sortDir: "desc",
  stratProfession: "", itemFilter: "", deals: {},
};

const settings = () => ({
  sellMode: $("sellMode").value, buyMode: $("buyMode").value,
  fee: { enabled: $("feeEnabled").checked, cut: (Number($("feeCut").value) || 0) / 100 },
});

// ---------- pamięć przeglądarki (IndexedDB) ----------
// Zapisujemy cały model (Map/Set), także wszystkie serwery z pliku Auctionatora.
async function save() {
  const m = state.model;
  const ok = await kvSet(STORE_KEY, {
    items: m.items, houses: m.houses ?? null, house: m.house ?? null, known: m.known, scannedAt: m.scannedAt,
    source: m.source ?? null, noMedian: !!m.noMedian,
  });
  state.saveFailed = !ok;
  return ok;
}
async function restore() {
  const d = await kvGet(STORE_KEY);
  if (!d?.items?.size) return false;
  state.model = { ...d, known: d.known ?? new Set(), restored: true };
  return true;
}

async function loadJson(path, fallback) {
  try {
    const r = await fetch(DATA + path, { cache: "no-cache" });
    return r.ok ? await r.json() : fallback;
  } catch { return fallback; }
}

// ---------- pomocnicze ----------
const itemName = (id) => state.catalog.items?.[id]?.name ?? `#${id}`;
const money = formatMoney;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}
function td(text, cls) { return el("td", { textContent: text, className: cls ?? "" }); }

function ingredientsText(r) {
  return r.ingredients.map((g) =>
    `${g.count}× ${itemName(g.item)}${g.source === "BoP" ? " (BoP, nie do kupienia)" : g.unit == null ? " (brak ceny)" : ` @ ${money(g.unit)} ${g.source}`}`).join("; ");
}
// Komórka opcji: w pierwszej linii cena (AH / kupiec) albo EV materiałów (rozbiór), w drugiej zysk albo strata
// względem kosztu składników. Najlepsza opcja jest wyróżniona.
function optionCell(r, name, profit) {
  const value = r.options?.[name];
  const cell = el("td", { className: "num opt" + (r.use === name && value != null ? " best" : "") });
  if (value == null) { cell.className += " dim"; cell.textContent = "-"; return cell; }
  cell.append(el("div", { textContent: money(value) }),
    el("div", { className: profit >= 0 ? "good small" : "bad small", textContent: `${profit >= 0 ? "+" : ""}${money(profit)}` }));
  return cell;
}
// Trend gotowego wyrobu X: zmiana ceny z ostatnich dni i wniosek o popycie (cena i liczba ofert na AH).
const DEMAND_CLASS = { up: "good", down: "bad", mixed: "warn", flat: "dim", unknown: "dim" };
function demandCell(r) {
  const d = r.demand;
  const cell = el("td", { className: "demand" });
  const top = d?.price ? `${TREND_LABEL[d.price.dir]} ${formatPct(d.price.change)}` : "-";
  cell.append(el("div", { className: DEMAND_CLASS[d?.verdict ?? "unknown"], textContent: top }),
    el("div", { className: "dim small", textContent: d?.label ?? "" }));
  return cell;
}
const profitCell = (r) => td(money(r.profit), "num " + (r.profit >= 0 ? "good" : "bad"));

function trendCell(t) {
  if (!t) return td("-", "dim");
  const cls = t.dir === "up" ? "good" : t.dir === "down" ? "bad" : "dim";
  return td(`${TREND_LABEL[t.dir]} ${formatPct(t.change)}`, cls);
}

function profList() {
  return [...new Set(state.recipes.map((r) => r.profession))].sort();
}

// ---------- obliczenia okazji ----------
function computeDeals() {
  const s = settings();
  const ctx = makeContext(state.model, state.catalog);
  const idx = state.profIdx;
  const base = { buyMode: s.buyMode, sellMode: s.sellMode, fee: s.fee };
  state.ctx = ctx;
  state.deals = {
    vendor: vendorFlips(state.model, state.catalog, idx, base),
    craft: craftFlips(state.recipes, ctx, { ...base, known: state.model.known, knownOnly: $("knownOnly").checked,
      includeIncomplete: !$("hideIncomplete").checked }),
    disenchant: disenchantFlips(state.model, state.catalog, ctx, base),
    ah: ahFlips(state.model, state.catalog, idx, base),
    guide: guideInvestments(state.watch, state.model, state.catalog, base),
  };
}

// ---------- widok: okazje ----------
const COLUMNS = {
  vendor: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (AH)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Vendor", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  craft: [
    { label: "Wyrób (X)", cell: (r) => el("td", { className: "name" }, r.name + (r.known ? "" : "  [?]") + (r.complete ? "" : "  *"),
        el("div", { className: "dim small", textContent: `${r.professions.join(", ")} · ofert wyrobu na AH: ${r.qty ?? "-"}${r.bopReagents?.length ? " · wymaga materiałów BoP" : ""}` })) },
    { label: "Składniki (Y, Z)", cell: (r) => el("td", { className: "wrap dim", textContent: ingredientsText(r) }) },
    { label: "Koszt składników", key: "cost", cell: (r) => td(money(r.cost) + (r.bopReagents?.length ? " + BoP" : ""), "num" + (r.bopReagents?.length ? " warn" : "")) },
    { label: "Cena X na AH → zysk/strata", key: "profitAh", cell: (r) => optionCell(r, "ah", r.profitAh) },
    { label: "Cena X u kupca → zysk/strata", key: "profitVendor", cell: (r) => optionCell(r, "vendor", r.profitVendor) },
    { label: "EV materiałów z rozbioru X → zysk/strata", key: "profitDisenchant", cell: (r) => optionCell(r, "disenchant", r.profitDisenchant) },
    { label: "Zysk (najlepsza opcja)", key: "profit", cell: (r) => {
        const c = el("td", { className: "num " + (r.profit >= 0 ? "good" : "bad") });
        c.append(el("div", { textContent: money(r.profit) }), el("div", { className: "dim small", textContent: `opcja: ${USE_LABEL[r.use] ?? "-"}` }));
        return c;
      } },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend X (popyt)", key: "trendChange", cell: demandCell },
  ],
  disenchant: [
    { label: "Przedmiot", cell: (r) => td(r.name + (r.complete ? "" : "  *")) },
    { label: "Koszt (AH)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Rozbiór (EV)", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Rozrzut", cell: (r) => td(`± ${money(r.sd)}`, "num dim") },
    { label: "Pewność", cell: (r) => td(r.confidence, "dim") },
    { label: "Na AH", cell: (r) => td(r.qty == null ? "-" : String(r.qty), "num dim") },
  ],
  ah: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (najniższa)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Typowa cena", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend 7d", cell: (r) => trendCell(r.trend) },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  guide: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (najniższa)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Typowa cena", cell: (r) => td(money(r.value), "num") },
    { label: "Potencjał", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend 7d", cell: (r) => trendCell(r.trend) },
    { label: "Wartość wg guida", cell: (r) => td(r.guideValue ?? "", "dim") },
    { label: "Strategia", cell: (r) => el("td", { className: "wrap dim", textContent: r.strategy ?? "" }) },
  ],
};

function dealDetail(r) {
  if (r.kind === "craft") {
    const x = r.result;
    const buyMode = settings().buyMode;
    const reagent = (g) => {
      const vb = state.ctx.vendorBuy(g.item);
      const unit = vb ?? state.ctx.ahPrice(g.item, buyMode);
      return `${g.count}× ${itemName(g.item)} @ ${unit == null ? "?" : money(unit)} (${vb != null ? "kupiec" : "AH"})`;
    };
    const parts = [`Składniki: ${x.recipe.reagents.map(reagent).join(", ")}`];
    if (x.missing.length) parts.push(`Brak ceny: ${x.missing.map(itemName).join(", ")}`);
    if (x.bop.length) parts.push(`Materiały BoP (nie do kupienia, nie wliczone w koszt): ${x.bop.map(itemName).join(", ")}. Zysk to tylko górne oszacowanie.`);
    const v = x.valueInfo;
    if (v) parts.push(`Kupiec: ${money(v.vendor)} | AH: ${money(v.ah)} | Rozbiór: ${money(v.disenchant)}${v.deIncomplete ? " *" : ""}`);
    if (v?.deStats) parts.push(`Rozrzut EV rozbioru: ± ${money(v.deStats.sd)} (typowy zakres ${money(Math.max(0, v.deStats.ev - v.deStats.sd))} - ${money(v.deStats.ev + v.deStats.sd)})`);
    const d = r.demand;
    if (d?.price) {
      parts.push(`Trend ceny wyrobu (7 dni, ${d.points} skanów): ${TREND_LABEL[d.price.dir]} ${formatPct(d.price.change)}`);
      if (d.qty) parts.push(`Trend liczby ofert na AH: ${TREND_LABEL[d.qty.dir]} ${formatPct(d.qty.change)}`);
      parts.push(`Wniosek: ${d.label}`);
    } else parts.push(`Trend wyrobu: ${d?.label ?? "brak historii"}`);
    if (x.recipe.skill) parts.push(`Umiejętność: ${x.recipe.skill}`);
    return parts.join("\n");
  }
  if (r.kind === "disenchant") return disenchantDetail(r);
  const parts = [`ID przedmiotu: ${r.id}`];
  if (r.strategy) parts.push(`Strategia: ${r.strategy}`);
  return parts.join("\n");
}

function disenchantDetail(r) {
  const d = r.de;
  const scen = (x) => `${x.qty}× ${itemName(x.item)} (szansa ${formatPct(x.p).replace("+", "")}) ≈ ${x.known ? money(x.v) : "brak ceny"}`;
  const lo = Math.max(0, d.ev - d.sd), hi = d.ev + d.sd;
  const parts = [
    `Wartość oczekiwana rozbioru (EV): ${money(d.ev)}; zakres typowy: ${money(lo)} - ${money(hi)} (± ${money(d.sd)}${d.exclusive ? "" : ", przybliżone"})`,
    `Koszt zakupu: ${money(r.cost)} | zysk oczekiwany: ${money(r.profit)}`,
    `Pewność: ${r.confidence}${r.sample != null ? ` (${r.sample} rozbiorów w próbie)` : ""}`,
    "Najczęstsze wyniki:",
    ...d.top.map((x, i) => `  ${i + 1}. ${scen(x)}`),
  ];
  const mats = new Map();
  for (const x of d.scenarios) {
    const m = mats.get(x.item) ?? { p: 0, q: 0 };
    m.p += x.p; m.q += x.p * x.qty;
    mats.set(x.item, m);
  }
  parts.push("Wszystkie możliwe materiały: " + [...mats].map(([id, m]) =>
    `${itemName(id)} ${formatPct(m.p).replace("+", "")}, średnio ${(m.q / m.p).toFixed(1)} szt.`).join("; "));
  const vendor = state.catalog.items?.[r.id]?.vendorSell;
  const h = state.model.items.get(r.id);
  const alt = [];
  if (vendor) alt.push(`kupiec ${money(vendor)}`);
  if (h) alt.push(`AH (mediana) ${money(netProceeds(h[h.length - 1].median, settings().fee))}`);
  if (alt.length) parts.push(`Gdyby przedmiot sprzedać: ${alt.join(", ")}`);
  if (!r.complete) parts.push("* Brak ceny AH dla części materiałów - wartość jest zaniżona.");
  return parts.join("\n");
}

function renderKindChips() {
  const box = $("dealKinds");
  box.replaceChildren();
  for (const k of DEAL_KINDS) {
    const n = state.deals[k.id]?.length ?? 0;
    const b = el("button", { type: "button" }, k.label, el("span", { className: "n", textContent: state.model.items.size ? String(n) : "" }));
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(state.deal === k.id));
    b.addEventListener("click", () => { state.deal = k.id; renderDeals(); });
    box.append(b);
  }
}

function renderDeals() {
  renderKindChips();
  const kind = DEAL_KINDS.find((k) => k.id === state.deal);
  $("dealHelp").textContent = kind.help;
  $("optKnown").hidden = $("optBop").hidden = $("optIncomplete").hidden = $("optQty").hidden = state.deal !== "craft";
  $("optRoi").hidden = state.deal === "vendor";
  document.querySelectorAll("#sortbar button").forEach((b) => {
    const active = b.dataset.sort === state.sortBy;
    b.classList.toggle("active", active);
    b.textContent = { profit: "Zysk", cost: "Koszt", roi: "ROI" }[b.dataset.sort] + (active ? (state.sortDir === "desc" ? " ▼" : " ▲") : "");
  });

  const cols = COLUMNS[state.deal];
  const thead = $("dealTable").querySelector("thead");
  thead.replaceChildren(el("tr", {}, ...cols.map((c) => {
    const th = el("th", { textContent: c.label, className: ["num"].filter(() => c.key).join(" ") + (c.key ? " sortable" : "") });
    if (c.key) {
      th.classList.toggle("active", c.key === state.sortBy);
      th.addEventListener("click", () => setSort(c.key));
    }
    return th;
  })));

  const tbody = $("dealTable").querySelector("tbody");
  tbody.replaceChildren();
  const empty = $("dealsEmpty");
  if (!state.model.items.size) { empty.textContent = "Wgraj plik z cenami, żeby zobaczyć okazje."; return; }
  if (state.deal === "craft" && !state.recipes.length) { empty.textContent = "Brak bazy receptur."; return; }
  if (state.deal === "guide" && !state.watch.length) { empty.textContent = "Brak listy przedmiotów z guidów."; return; }

  let rows = filterRows(state.deals[state.deal] ?? [], state.profession);
  const bopFiltered = state.deal === "craft" ? filterBop(rows, $("bopFilter").value) : { rows, hidden: 0 };
  rows = bopFiltered.rows;
  const reliable = filterReliable(rows, { minQty: Number($("minQty").value) || 0, maxRoi: Number($("maxRoi").value) || 0 });
  rows = reliable.rows;
  if ($("hideLoss").checked) rows = onlyProfitable(rows);
  rows = sortRows(rows, state.sortBy, state.sortDir);
  const bopNote = bopFiltered.hidden ? ` Ukryto ${bopFiltered.hidden} receptur z materiałami BoP (filtr "materiały BoP").` : "";
  const hiddenNote = bopNote + (reliable.hidden ? ` Ukryto ${reliable.hidden} niewiarygodnych (mało ofert albo podejrzanie wysokie ROI).` : "");
  empty.textContent = rows.length ? `Pokazano ${Math.min(rows.length, 300)} z ${rows.length}.${hiddenNote}`
    : `Brak wyników dla tych filtrów (spróbuj zmienić profesję, dodać skany lub poluzować progi).${hiddenNote}`;
  for (const r of rows.slice(0, 300)) {
    const tr = el("tr", { className: "row" }, ...cols.map((c) => c.cell(r)));
    let detail = null;
    tr.addEventListener("click", () => {
      if (detail) { detail.remove(); detail = null; return; }
      detail = el("tr", { className: "detail" }, el("td", { colSpan: cols.length, textContent: dealDetail(r), style: "white-space: pre-line" }));
      tr.after(detail);
    });
    tbody.append(tr);
  }
}

function setSort(key) {
  if (state.sortBy === key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
  else { state.sortBy = key; state.sortDir = key === "cost" ? "asc" : "desc"; }
  renderDeals();
}

function renderProfessionSelects() {
  const profs = profList();
  const sel = $("profession");
  sel.replaceChildren(new Option("Wszystkie profesje", ""), ...profs.map((p) => new Option(p, p)), new Option("Bez profesji", NO_PROFESSION));
  sel.value = state.profession;
  const ss = $("stratProfession");
  const sp = [...new Set(state.strategies.map((s) => s.profession))].sort((a, b) => (a === "Ogólne" ? -1 : b === "Ogólne" ? 1 : a.localeCompare(b)));
  ss.replaceChildren(new Option("Wszystkie", ""), ...sp.map((p) => new Option(p, p)));
  ss.value = state.stratProfession;
}

// ---------- widok: strategie ----------
function checkLines(check) {
  const s = settings();
  const rows = runCheck(check, { recipes: state.recipes, model: state.model, catalog: state.catalog, ctx: state.ctx,
    opts: { buyMode: s.buyMode, sellMode: s.sellMode, fee: s.fee } });
  if (rows === null) return ["Wgraj skan AH, żeby zobaczyć aktualne najlepsze okazje dla tej strategii."];
  if (!rows.length) return ["Brak opłacalnych pozycji w Twoim skanie."];
  return rows.map((r) => `${r.name}: zysk ${money(r.profit)} (koszt ${money(r.cost)})`);
}

function renderStrategies() {
  const box = $("strategyList");
  box.replaceChildren();
  const list = state.strategies.filter((s) => !state.stratProfession || s.profession === state.stratProfession);
  $("strategiesEmpty").textContent = list.length ? "" : "Brak strategii.";
  for (const s of list) {
    const card = el("article", { className: "strategy" });
    const title = el("h3", {});
    if (s.tier) title.append(el("span", { className: `tier ${s.tier}`, textContent: s.tier }));
    title.append(s.title);
    card.append(title, el("div", { className: "meta", textContent: s.profession }), el("p", { textContent: s.summary }));
    if (s.points?.length) card.append(el("ul", {}, ...s.points.map((p) => el("li", { textContent: p }))));
    if (s.check) card.append(el("div", { className: "check" }, el("strong", { textContent: "Na Twoich danych: " }), ...checkLines(s.check).flatMap((l, i) => [i ? el("br") : "", l])));
    if (s.items?.length) {
      const b = el("button", { type: "button", className: "link", textContent: `Zobacz inwestycje (${s.items.length} przedmiotów z guida)` });
      b.addEventListener("click", () => { state.deal = "guide"; state.profession = s.profession === "Ogólne" ? "" : s.profession; $("profession").value = state.profession; switchTab("deals"); });
      card.append(el("p", {}, b));
    }
    card.append(el("ul", { className: "sources" }, ...s.sources.map((src) =>
      el("li", {}, el("a", { href: src.url, textContent: src.title, target: "_blank", rel: "noopener noreferrer" }),
        ` - wiarygodność: ${src.reliability}${src.note ? ` (${src.note})` : ""}`))));
    box.append(card);
  }
}

// ---------- widok: przedmioty ----------
function renderItems() {
  const tbody = document.querySelector("#itemTable tbody");
  tbody.replaceChildren();
  const empty = $("itemsEmpty");
  if (!state.model.items.size) { empty.textContent = "Wgraj plik z cenami."; return; }
  const q = state.itemFilter.trim().toLowerCase();
  const rows = [];
  for (const [id, h] of state.model.items) {
    const name = itemName(id);
    if (q && !name.toLowerCase().includes(q) && !String(id).includes(q)) continue;
    rows.push({ id, name, last: h[h.length - 1], tr: trend(h) });
  }
  rows.sort((a, b) => (b.last.qty ?? 0) - (a.last.qty ?? 0));
  empty.textContent = rows.length ? "" : "Brak pasujących przedmiotów.";
  for (const r of rows.slice(0, 500)) {
    const opt = (x) => (x == null ? "-" : money(x));
    tbody.append(el("tr", {}, td(r.name), td(money(r.last.low), "num"), td(opt(r.last.median), "num"),
      td(opt(r.last.avg), "num"), td(String(r.last.qty ?? "-"), "num"), trendCell(r.tr)));
  }
}

// ---------- status i odświeżanie ----------
function renderStatus(extra) {
  const ul = $("status");
  ul.replaceChildren();
  const add = (cls, text) => ul.append(el("li", { className: cls, textContent: text }));
  if (extra) add(extra.cls, extra.text);
  const n = state.model.items.size;
  if (n) {
    const when = state.model.scannedAt ? new Date(state.model.scannedAt * 1000).toLocaleString("pl-PL") : "?";
    add("ok", `Załadowano ${n} przedmiotów${state.model.house ? ` (${state.model.house})` : ""}, ostatni skan: ${when}.`);
    if (state.model.testData) add("warn", "To są dane testowe z repozytorium, a nie Twój aktualny skan.");
    if (state.model.noMedian) add("dim", "Źródło: Auctionator zapisuje tylko najniższe ceny dzienne i ilość. Mediana i średnia są niedostępne, więc w ich miejsce używana jest najniższa cena.");
  } else add("dim", "Brak danych cenowych - wgraj plik.");
  if (state.saveFailed) add("err", "Nie udało się zapamiętać danych w przeglądarce - po odświeżeniu trzeba będzie wgrać plik ponownie.");
  const c = state.catalog;
  add("dim", `Baza: ${state.recipes.length} receptur, ${Object.keys(c.items ?? {}).length} przedmiotów, ` +
    `${Object.keys(c.vendors ?? {}).length} cen u kupców, rozbiór: ${c.disenchant ? "tak" : "brak"}.`);
}

function refresh(extra) {
  state.watch = resolveWatchlist(state.strategies, state.catalog, state.model);
  computeDeals();
  renderStatus(extra);
  renderDeals();
  renderStrategies();
  renderItems();
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === tab)));
  document.querySelectorAll(".tab").forEach((t) => { t.hidden = t.id !== "tab-" + tab; });
  renderDeals();
}

// Plik czytamy jako bajty (bajt -> znak), bo Auctionator zapisuje w nim dane binarne, których UTF-8 by zepsuł.
function binaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let i = 0; i < bytes.length; i += 16384) parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return parts.join("");
}
const readBinaryText = async (file) => binaryString(await file.arrayBuffer());

// Skan testowy z repozytorium (okrojony Auctionator.lua) - używany, gdy użytkownik nie wgrał własnego pliku.
async function loadTestScan() {
  try {
    const r = await fetch(DATA + "test-scan.lua", { cache: "no-cache" });
    if (!r.ok) return false;
    const res = loadSavedVariables(binaryString(await r.arrayBuffer()));
    if (res.error) return false;
    state.model = { ...res, testData: true };
    return true;
  } catch { return false; }
}

function renderHouses() {
  const bar = $("houseBar");
  const houses = state.model.houses ? Object.keys(state.model.houses) : [];
  bar.hidden = houses.length < 2;
  if (bar.hidden) return;
  $("house").replaceChildren(...houses.map((h) => new Option(`${h} (${state.model.houses[h].size})`, h)));
  $("house").value = state.model.house;
}

async function handleFile(file) {
  if (!file) return;
  renderStatus({ cls: "dim", text: `Wczytuję plik ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…` });
  try {
    const res = loadSavedVariables(await readBinaryText(file));
    if (res.error) return refresh({ cls: "err", text: res.error });
    state.model = res;
    await save();
    renderHouses();
    refresh({ cls: "ok", text: `Wczytano plik ${file.name}.` });
  } catch (e) {
    refresh({ cls: "err", text: `Nie udało się wczytać pliku ${file.name}: ${e.message}` });
  }
}

function wire() {
  const drop = $("drop");
  $("file").addEventListener("change", (e) => { handleFile(e.target.files[0]); e.target.value = ""; });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  $("house").addEventListener("change", (e) => { selectHouse(state.model, e.target.value); save(); refresh(); });
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("profession").addEventListener("change", (e) => { state.profession = e.target.value; renderDeals(); });
  $("stratProfession").addEventListener("change", (e) => { state.stratProfession = e.target.value; renderStrategies(); });
  document.querySelectorAll("#sortbar button").forEach((b) => b.addEventListener("click", () => setSort(b.dataset.sort)));
  for (const id of ["knownOnly", "hideIncomplete", "sellMode", "buyMode", "feeEnabled", "feeCut"])
    $(id).addEventListener("change", () => refresh());
  $("hideLoss").addEventListener("change", renderDeals);
  $("minQty").addEventListener("change", renderDeals);
  $("bopFilter").addEventListener("change", renderDeals);
  $("maxRoi").addEventListener("change", renderDeals);
  $("itemFilter").addEventListener("input", (e) => { state.itemFilter = e.target.value; renderItems(); });
  $("clear").addEventListener("click", () => {
    kvDelete(STORE_KEY);
    state.model = { items: new Map(), known: new Set(), scannedAt: 0 };
    renderHouses();
    refresh({ cls: "dim", text: "Usunięto zapamiętane dane." });
  });
}

async function init() {
  wire();
  const restored = await restore();
  const testScan = restored ? false : await loadTestScan();
  renderHouses();
  const [recipes, items, vendors, de, strategies] = await Promise.all([
    loadJson("recipes.json", []), loadJson("items.json", { items: {} }), loadJson("vendors.json", { prices: {} }),
    loadJson("disenchant.json", null), loadJson("strategies.json", { strategies: [] }),
  ]);
  state.recipes = recipes;
  state.catalog = { items: items.items ?? {}, vendors: vendors.prices ?? {}, disenchant: makeDisenchant(de) };
  state.strategies = strategies.strategies ?? [];
  state.profIdx = professionIndex(recipes);
  renderProfessionSelects();
  refresh(restored ? { cls: "dim", text: "Przywrócono dane zapisane w tej przeglądarce podczas poprzedniej wizyty." }
    : testScan ? { cls: "dim", text: "Wczytano skan testowy z repozytorium (okrojony Auctionator.lua). Wgraj własny plik, żeby go zastąpić." }
    : undefined);
}
init();
