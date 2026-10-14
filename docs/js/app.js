import { loadSavedVariables, makeContext, makeDisenchant } from "./datasource.js";
import { trend, formatMoney, formatPct } from "./engine.js";
import {
  professionIndex, vendorFlips, craftFlips, disenchantFlips, ahFlips, resolveWatchlist, guideInvestments,
  filterRows, sortRows, runCheck, NO_PROFESSION,
} from "./opportunities.js";

const $ = (id) => document.getElementById(id);
const MODE = document.body.dataset.mode || "tbc";
const DATA = `../data/${MODE}/`;
const STORE_KEY = `dealhunter-ah.${MODE}.model.v1`;
const TREND_LABEL = { up: "▲", down: "▼", flat: "▬" };
const USE_LABEL = { vendor: "kupiec", ah: "AH", disenchant: "rozbiór" };
const KIND_LABEL = { craft: "receptura", disenchant: "rozbiór" };

const DEAL_KINDS = [
  { id: "vendor", label: "Flipy do vendora",
    help: "Kup na AH taniej, niż płaci kupiec, i sprzedaj kupcowi." },
  { id: "craft", label: "Flipy do profesji",
    help: "Kup składniki, wytwórz i sprzedaj wyrób albo kup przedmiot i go rozbierz. Receptury pochodzą z bazy gry (także te, których nie znasz)." },
  { id: "ah", label: "Flipy na AH",
    help: "Kup taniej niż zwykle: aktualna najniższa cena kontra mediana z historii Twoich skanów (potrzebne co najmniej 3 skany)." },
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

// ---------- pamięć przeglądarki (opcjonalna) ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      items: Object.fromEntries(state.model.items), known: [...state.model.known], scannedAt: state.model.scannedAt,
    }));
  } catch { /* brak miejsca lub zablokowane - strona działa dalej */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    state.model = {
      source: "pamięć przeglądarki",
      items: new Map(Object.entries(d.items).map(([k, v]) => [Number(k), v])),
      known: new Set(d.known), scannedAt: d.scannedAt,
    };
  } catch { /* uszkodzone dane - ignoruj */ }
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
  const minDiscount = (Number($("minDiscount").value) || 0) / 100;
  state.ctx = ctx;
  state.deals = {
    vendor: vendorFlips(state.model, state.catalog, idx, base),
    craft: [
      ...craftFlips(state.recipes, ctx, { ...base, known: state.model.known, knownOnly: $("knownOnly").checked,
        includeIncomplete: $("incomplete").checked }),
      ...disenchantFlips(state.model, state.catalog, ctx, base),
    ],
    ah: ahFlips(state.model, state.catalog, idx, { ...base, minDiscount }),
    guide: guideInvestments(state.watch, state.model, state.catalog, base),
  };
}

// ---------- widok: okazje ----------
const COLUMNS = {
  vendor: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (AH)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Vendor", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: (r) => td(money(r.profit), "num good") },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  craft: [
    { label: "Wyrób / przedmiot", cell: (r) => td(r.name + (r.kind === "craft" && !r.known ? "  [?]" : "") + (r.kind === "craft" && !r.complete ? "  *" : "")) },
    { label: "Typ", cell: (r) => td(KIND_LABEL[r.kind], "dim") },
    { label: "Koszt", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Wartość", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: (r) => td(money(r.profit), "num " + (r.profit >= 0 ? "good" : "bad")) },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Jak", cell: (r) => td(r.kind === "craft" ? (USE_LABEL[r.use] ?? "") : "rozbiór") },
    { label: "Profesja", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  ah: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (najniższa)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Typowa cena", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: (r) => td(money(r.profit), "num good") },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend 7d", cell: (r) => trendCell(r.trend) },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  guide: [
    { label: "Przedmiot", cell: (r) => td(r.name) },
    { label: "Koszt (najniższa)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Typowa cena", cell: (r) => td(money(r.value), "num") },
    { label: "Potencjał", key: "profit", cell: (r) => td(money(r.profit), "num " + (r.profit >= 0 ? "good" : "bad")) },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend 7d", cell: (r) => trendCell(r.trend) },
    { label: "Wartość wg guida", cell: (r) => td(r.guideValue ?? "", "dim") },
    { label: "Strategia", cell: (r) => td(r.strategy ?? "", "dim") },
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
    const v = x.valueInfo;
    if (v) parts.push(`Kupiec: ${money(v.vendor)} | AH: ${money(v.ah)} | Rozbiór: ${money(v.disenchant)}${v.deIncomplete ? " *" : ""}`);
    const t = trend(state.model.items.get(x.recipe.produces) ?? []);
    if (t) parts.push(`Trend wyrobu (7 dni): ${TREND_LABEL[t.dir]} ${formatPct(t.change)}`);
    if (x.recipe.skill) parts.push(`Umiejętność: ${x.recipe.skill}`);
    return parts.join("\n");
  }
  const parts = [`ID przedmiotu: ${r.id}`];
  if (r.strategy) parts.push(`Strategia: ${r.strategy}`);
  if (r.kind === "disenchant") parts.push("Wartość = oczekiwana wartość materiałów z rozbioru po cenach z AH.");
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
  $("optKnown").hidden = $("optIncomplete").hidden = state.deal !== "craft";
  $("optDiscount").hidden = state.deal !== "ah";
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

  const rows = sortRows(filterRows(state.deals[state.deal] ?? [], state.profession), state.sortBy, state.sortDir);
  empty.textContent = rows.length ? `Pokazano ${Math.min(rows.length, 300)} z ${rows.length}.`
    : "Brak wyników dla tych filtrów (spróbuj zmienić profesję, dodać skany lub poluzować progi).";
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
    tbody.append(el("tr", {}, td(r.name), td(money(r.last.low), "num"), td(money(r.last.median), "num"),
      td(money(r.last.avg), "num"), td(String(r.last.qty ?? "-"), "num"), trendCell(r.tr)));
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
    add("ok", `Załadowano ${n} przedmiotów, ostatni skan: ${when}.`);
  } else add("dim", "Brak danych cenowych - wgraj plik.");
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

async function handleFile(file) {
  if (!file) return;
  const res = loadSavedVariables(await file.text());
  if (res.error) return refresh({ cls: "err", text: res.error });
  state.model = res;
  save();
  refresh({ cls: "ok", text: `Wczytano plik ${file.name}.` });
}

function wire() {
  const drop = $("drop");
  $("file").addEventListener("change", (e) => handleFile(e.target.files[0]));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("profession").addEventListener("change", (e) => { state.profession = e.target.value; renderDeals(); });
  $("stratProfession").addEventListener("change", (e) => { state.stratProfession = e.target.value; renderStrategies(); });
  document.querySelectorAll("#sortbar button").forEach((b) => b.addEventListener("click", () => setSort(b.dataset.sort)));
  for (const id of ["knownOnly", "incomplete", "minDiscount", "sellMode", "buyMode", "feeEnabled", "feeCut"])
    $(id).addEventListener("change", () => refresh());
  $("itemFilter").addEventListener("input", (e) => { state.itemFilter = e.target.value; renderItems(); });
  $("clear").addEventListener("click", () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignoruj */ }
    state.model = { items: new Map(), known: new Set(), scannedAt: 0 };
    refresh({ cls: "dim", text: "Usunięto zapamiętane dane." });
  });
}

async function init() {
  wire();
  restore();
  const [recipes, items, vendors, de, strategies] = await Promise.all([
    loadJson("recipes.json", []), loadJson("items.json", { items: {} }), loadJson("vendors.json", { prices: {} }),
    loadJson("disenchant.json", null), loadJson("strategies.json", { strategies: [] }),
  ]);
  state.recipes = recipes;
  state.catalog = { items: items.items ?? {}, vendors: vendors.prices ?? {}, disenchant: makeDisenchant(de) };
  state.strategies = strategies.strategies ?? [];
  state.profIdx = professionIndex(recipes);
  renderProfessionSelects();
  refresh();
}
init();
