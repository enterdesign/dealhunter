import { loadSavedVariables, makeContext, makeDisenchant, selectHouse } from "./datasource.js?v=1454e23d";
import { kvSet, kvGet, kvDelete } from "./store.js?v=1454e23d";
import { trend, formatMoney, formatPct, netProceeds } from "./engine.js?v=1454e23d";
import {
  professionIndex, vendorFlips, craftFlips, disenchantFlips, ahFlips, resolveWatchlist, guideInvestments,
  filterRows, sortRows, runCheck, onlyProfitable, filterReliable, filterBop, NO_PROFESSION,
} from "./opportunities.js?v=1454e23d";

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

const LINK_KEY = "linkedFiles";
const canLink = typeof window.showOpenFilePicker === "function";   // Chrome, Edge; nie Firefox ani Safari

const state = {
  linked: [], fileInfo: [],
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

// Składniki receptury: każdy w osobnej linii z przyciskiem kopiowania nazwy (do wyszukania na AH w grze).
function ingredientsCell(r) {
  const cell = el("td", { className: "wrap dim" });
  for (const g of r.ingredients) {
    const name = itemName(g.item);
    const detail = g.source === "BoP" ? " (BoP, nie do kupienia)" : g.unit == null ? " (brak ceny)" : ` @ ${money(g.unit)} ${g.source}`;
    cell.append(el("div", { className: "ing" }, `${g.count}× ${name}${detail}`, copyButton(name)));
  }
  return cell;
}

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

// Kopiuje tekst do schowka (Clipboard API, a gdy go brak: starsza metoda przez ukryte pole), żeby wkleić nazwę w grze.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea", { value: text, style: "position: fixed; opacity: 0" });
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* brak zgody */ }
    area.remove();
    return ok;
  }
}

function copyButton(text) {
  const b = el("button", { type: "button", className: "copy", textContent: "⧉", title: `Kopiuj nazwę: ${text}` });
  b.setAttribute("aria-label", `Kopiuj nazwę ${text}`);
  b.addEventListener("click", async (e) => {
    e.stopPropagation();   // nie rozwijaj szczegółów wiersza
    const ok = await copyText(text);
    b.textContent = ok ? "✓" : "✗";
    b.classList.toggle("done", ok);
    setTimeout(() => { b.textContent = "⧉"; b.classList.remove("done"); }, 1200);
  });
  return b;
}

// Komórka z nazwą przedmiotu i przyciskiem kopiowania (kopiuje czystą nazwę, bez oznaczeń).
function nameCell(name, flags = "") {
  return el("td", { className: "name" }, el("span", { textContent: name + flags }), copyButton(name));
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
    { label: "Przedmiot", cell: (r) => nameCell(r.name) },
    { label: "Koszt (AH)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Vendor", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  craft: [
    { label: "Wyrób (X)", cell: (r) => el("td", { className: "name" }, el("span", { textContent: r.name + (r.known ? "" : "  [?]") + (r.complete ? "" : "  *") }),
        copyButton(r.name),
        el("div", { className: "dim small", textContent: `${r.professions.join(", ")} · ofert wyrobu na AH: ${r.qty ?? "-"}${r.bopReagents?.length ? " · wymaga materiałów BoP" : ""}` })) },
    { label: "Składniki (Y, Z)", cell: (r) => ingredientsCell(r) },
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
    { label: "Przedmiot", cell: (r) => nameCell(r.name, r.complete ? "" : "  *") },
    { label: "Koszt (AH)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Rozbiór (EV)", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Rozrzut", cell: (r) => td(`± ${money(r.sd)}`, "num dim") },
    { label: "Pewność", cell: (r) => td(r.confidence, "dim") },
    { label: "Na AH", cell: (r) => td(r.qty == null ? "-" : String(r.qty), "num dim") },
  ],
  ah: [
    { label: "Przedmiot", cell: (r) => nameCell(r.name) },
    { label: "Koszt (najniższa)", key: "cost", cell: (r) => td(money(r.cost), "num") },
    { label: "Typowa cena", cell: (r) => td(money(r.value), "num") },
    { label: "Zysk", key: "profit", cell: profitCell },
    { label: "ROI", key: "roi", cell: (r) => td(formatPct(r.roi), "num") },
    { label: "Trend 7d", cell: (r) => trendCell(r.trend) },
    { label: "Na AH", cell: (r) => td(String(r.qty ?? "-"), "num") },
    { label: "Profesje", cell: (r) => td(r.professions.join(", "), "dim") },
  ],
  guide: [
    { label: "Przedmiot", cell: (r) => nameCell(r.name) },
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
    tbody.append(el("tr", {}, nameCell(r.name), td(money(r.last.low), "num"), td(opt(r.last.median), "num"),
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
  if (state.fileInfo.length) {
    add("dim", "Pliki: " + state.fileInfo.map((f) => `${f.name} (zapisany w grze ${new Date(f.modified).toLocaleString("pl-PL")})`).join(", ") +
      ". Plik zapisuje się przy /reload albo wylogowaniu.");
  }
  if (n) {
    const k = state.model.known?.size ?? 0;
    add(k ? "ok" : "dim", k ? `Znane receptury: ${k} (filtr „tylko znane” działa).`
      : "Znane receptury: brak. Zapisuje je addon DealHunterAH po kliknięciu „Zapisz receptury” w oknie profesji (Auctionator ich nie zapisuje); filtr „tylko znane” jest wtedy pusty.");
  }
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

// Wgrywanie jednego lub kilku plików. Ceny bierzemy z pliku z najnowszym skanem (przy remisie z DealHunterAH,
// bo ma też medianę i średnią), a znane receptury z wszystkich wgranych plików łączymy.
async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const names = files.map((f) => f.name).join(", ");
  renderStatus({ cls: "dim", text: `Wczytuję: ${names} (${(files.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(1)} MB)…` });
  try {
    const results = [];
    for (const f of files) results.push({ name: f.name, res: loadSavedVariables(await readBinaryText(f)) });
    const ok = results.filter((r) => !r.res.error).map((r) => r.res);
    if (!ok.length) return refresh({ cls: "err", text: results.map((r) => `${r.name}: ${r.res.error}`).join(" | ") });

    const withPrices = ok.filter((m) => m.items.size > 0)
      .sort((a, b) => b.scannedAt - a.scannedAt || (a.source === "DealHunterAH" ? -1 : 1));
    const known = new Set(ok.flatMap((m) => [...m.known]));
    const base = withPrices[0] ?? state.model;           // plik bez cen (tylko receptury) nie kasuje wczytanych cen
    state.model = { ...base, known: known.size ? known : base.known };
    if (withPrices[0]) delete state.model.testData;      // ceny z własnego pliku zastępują testowe
    state.fileInfo = files.map((f) => ({ name: f.name, modified: f.lastModified }));
    await save();
    renderHouses();
    const errs = results.filter((r) => r.res.error).map((r) => `${r.name}: ${r.res.error}`);
    refresh({ cls: errs.length ? "err" : "ok", text: errs.length ? `Wczytano część plików. Błędy: ${errs.join(" | ")}` : `Wczytano: ${names}.` });
  } catch (e) {
    refresh({ cls: "err", text: `Nie udało się wczytać plików (${names}): ${e.message}` });
  }
}

// ---------- połączenie z plikami na dysku (File System Access API) ----------
function renderLinked() {
  $("linkBar").hidden = false;
  if (!canLink) {
    $("linkBtn").hidden = $("refreshBtn").hidden = $("unlinkBtn").hidden = true;
    $("linkInfo").textContent = "Ta przeglądarka nie obsługuje łączenia z plikiem (użyj Chrome lub Edge). Wgrywaj plik ręcznie.";
    return;
  }
  const has = state.linked.length > 0;
  $("linkBtn").hidden = has;
  $("refreshBtn").hidden = $("unlinkBtn").hidden = !has;
  $("linkInfo").textContent = has ? `Połączono z: ${state.linked.map((h) => h.name).join(", ")}. Po skanie wpisz /reload w grze i kliknij „Odśwież”.` : "";
}

async function linkFiles() {
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true, types: [{ description: "Pliki SavedVariables (.lua)", accept: { "text/plain": [".lua"] } }],
    });
    state.linked = handles;
    await kvSet(LINK_KEY, handles);
    renderLinked();
    await refreshLinked(true);
  } catch (e) {
    if (e?.name !== "AbortError") refresh({ cls: "err", text: `Nie udało się połączyć z plikami: ${e.message}` });
  }
}

// Odczytuje połączone pliki ponownie. interactive=false: bez pytania o zgodę (przy starcie strony).
async function refreshLinked(interactive = true) {
  if (!state.linked.length) return false;
  try {
    const files = [];
    for (const h of state.linked) {
      let perm = await h.queryPermission({ mode: "read" });
      if (perm !== "granted" && interactive) perm = await h.requestPermission({ mode: "read" });
      if (perm !== "granted") {
        if (interactive) refresh({ cls: "err", text: `Brak zgody na odczyt pliku ${h.name}.` });
        return false;
      }
      files.push(await h.getFile());
    }
    await handleFiles(files);
    return true;
  } catch (e) {
    refresh({ cls: "err", text: `Nie można odczytać połączonych plików (przeniesione lub usunięte?): ${e.message}. Odłącz i połącz ponownie.` });
    return false;
  }
}

async function unlinkFiles() {
  state.linked = [];
  await kvDelete(LINK_KEY);
  renderLinked();
  refresh({ cls: "dim", text: "Odłączono pliki. Dane w przeglądarce zostają do czasu wgrania nowych." });
}

function wire() {
  const drop = $("drop");
  $("file").addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; handleFiles(files); });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

  $("linkBtn").addEventListener("click", linkFiles);
  $("refreshBtn").addEventListener("click", () => refreshLinked(true));
  $("unlinkBtn").addEventListener("click", unlinkFiles);
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
  const [recipes, items, vendors, de, strategies] = await Promise.all([
    loadJson("recipes.json", []), loadJson("items.json", { items: {} }), loadJson("vendors.json", { prices: {} }),
    loadJson("disenchant.json", null), loadJson("strategies.json", { strategies: [] }),
  ]);
  state.recipes = recipes;
  state.catalog = { items: items.items ?? {}, vendors: vendors.prices ?? {}, disenchant: makeDisenchant(de) };
  state.strategies = strategies.strategies ?? [];
  state.profIdx = professionIndex(recipes);
  renderProfessionSelects();

  let restored = await restore();
  state.linked = canLink ? ((await kvGet(LINK_KEY)) ?? []) : [];
  renderLinked();
  const fresh = state.linked.length ? await refreshLinked(false) : false;   // bez pytania, gdy zgoda jest zapamiętana
  if (fresh) return;                                                          // refreshLinked odświeżył widok
  const testScan = restored || state.model.items.size ? false : await loadTestScan();
  renderHouses();
  refresh(restored ? { cls: "dim", text: "Przywrócono dane zapisane w tej przeglądarce podczas poprzedniej wizyty. Kliknij „Odśwież z połączonych plików”, żeby wczytać nowszy skan." }
    : testScan ? { cls: "dim", text: "Wczytano skan testowy z repozytorium (okrojony Auctionator.lua). Wgraj własny plik, żeby go zastąpić." }
    : undefined);
}
init();
