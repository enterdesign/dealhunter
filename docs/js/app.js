import { loadSavedVariables, makeContext } from "./datasource.js";
import { rankRecipes, trend, formatMoney, formatPct } from "./engine.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "dealhunter-ah.model.v1";
const USE_LABEL = { vendor: "kupiec", ah: "AH", disenchant: "rozbiór" };
const TREND_LABEL = { up: "▲", down: "▼", flat: "▬" };

const state = {
  model: { items: new Map(), known: new Set(), scannedAt: 0 },
  recipes: [], catalog: { items: {} },
  sortBy: "profit", profession: "", itemFilter: "",
};

const settings = () => ({
  sellMode: $("sellMode").value, buyMode: $("buyMode").value,
  fee: { enabled: $("feeEnabled").checked, cut: Number($("feeCut").value) / 100 || 0 },
});

// ---- pamięć przeglądarki (opcjonalna) ----
function save() {
  try {
    const items = Object.fromEntries(state.model.items);
    localStorage.setItem(STORE_KEY, JSON.stringify({
      items, known: [...state.model.known], scannedAt: state.model.scannedAt,
    }));
  } catch { /* brak miejsca lub zablokowane - strona działa dalej bez pamięci */ }
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

// ---- dane statyczne (receptury, katalog przedmiotów) ----
async function loadJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-cache" });
    return r.ok ? await r.json() : fallback;
  } catch { return fallback; }
}

// ---- status ----
function renderStatus(extra) {
  const ul = $("status");
  ul.replaceChildren();
  const add = (cls, text) => { const li = document.createElement("li"); li.className = cls; li.textContent = text; ul.append(li); };
  if (extra) add(extra.cls, extra.text);
  const n = state.model.items.size;
  if (n) {
    const when = state.model.scannedAt ? new Date(state.model.scannedAt * 1000).toLocaleString("pl-PL") : "?";
    add("ok", `Załadowano ${n} przedmiotów, ostatni skan: ${when}.`);
  } else add("dim", "Brak danych cenowych - wgraj plik.");
  add("dim", `Receptury w bazie: ${state.recipes.length}. Przedmioty w katalogu: ${Object.keys(state.catalog.items ?? {}).length}.`);
}

// ---- receptury ----
function renderProfessions() {
  const sel = $("profession");
  const profs = [...new Set(state.recipes.map((r) => r.profession))].sort();
  sel.replaceChildren(new Option("Wszystkie profesje", ""), ...profs.map((p) => new Option(p, p)));
  sel.value = state.profession;
}

const itemName = (id) => state.catalog.items?.[id]?.name ?? `#${id}`;

function cell(text, cls) {
  const td = document.createElement("td");
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

function detailText(r, ctx) {
  const parts = [];
  parts.push("Składniki: " + r.recipe.reagents.map((g) => `${g.count}× ${itemName(g.item)}`).join(", "));
  if (r.missing.length) parts.push(`Brak ceny: ${r.missing.map(itemName).join(", ")}`);
  const v = r.valueInfo;
  if (v) parts.push(`Kupiec: ${formatMoney(v.vendor)} | AH: ${formatMoney(v.ah)} | Rozbiór: ${formatMoney(v.disenchant)}${v.deIncomplete ? " *" : ""}`);
  const t = trend(state.model.items.get(r.recipe.produces) ?? []);
  if (t) parts.push(`Trend wyrobu (7 dni): ${TREND_LABEL[t.dir]} ${formatPct(t.change)}`);
  if (r.recipe.skill) parts.push(`Wymagana umiejętność: ${r.recipe.skill}`);
  if (r.recipe.source) parts.push(`Źródło: ${r.recipe.source}`);
  return parts.join("\n");
}

function renderRecipes() {
  const tbody = document.querySelector("#recipeTable tbody");
  tbody.replaceChildren();
  const empty = $("recipesEmpty");
  if (!state.recipes.length) { empty.textContent = "Brak bazy receptur (docs/data/recipes.json jest pusty)."; return; }
  if (!state.model.items.size) { empty.textContent = "Wgraj plik z cenami, żeby zobaczyć ranking."; return; }

  const s = settings();
  const ctx = makeContext(state.model, state.catalog);
  const ranked = rankRecipes(state.recipes, ctx, {
    profession: state.profession || null, known: state.model.known,
    knownOnly: $("knownOnly").checked, includeIncomplete: $("incomplete").checked,
    sortBy: state.sortBy, sellMode: s.sellMode, buyMode: s.buyMode, fee: s.fee,
  });
  empty.textContent = ranked.length ? "" : "Brak kompletnych wyników - zrób skan AH dla składników i wyrobów albo zaznacz „pokaż niekompletne”.";

  for (const r of ranked.slice(0, 300)) {
    const tr = document.createElement("tr");
    tr.className = "row";
    const name = document.createElement("td");
    name.textContent = r.recipe.name + (r.known ? "" : "  [?]") + (r.complete ? "" : "  *");
    tr.append(name, cell(formatMoney(r.cost), "num"), cell(formatMoney(r.value), "num"),
      cell(formatMoney(r.profit), "num " + (r.profit >= 0 ? "good" : "bad")),
      cell(formatPct(r.roi), "num"), cell(USE_LABEL[r.use] ?? ""));
    let detail = null;
    tr.addEventListener("click", () => {
      if (detail) { detail.remove(); detail = null; return; }
      detail = document.createElement("tr");
      detail.className = "detail";
      const td = document.createElement("td");
      td.colSpan = 6; td.style.whiteSpace = "pre-line";
      td.textContent = detailText(r, ctx);
      detail.append(td); tr.after(detail);
    });
    tbody.append(tr);
  }
  document.querySelectorAll("#recipeTable th.sortable").forEach((th) =>
    th.classList.toggle("active", th.dataset.sort === state.sortBy));
}

// ---- przedmioty ----
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
    const tr = document.createElement("tr");
    const t = r.tr;
    tr.append(cell(r.name), cell(formatMoney(r.last.low), "num"), cell(formatMoney(r.last.median), "num"),
      cell(formatMoney(r.last.avg), "num"), cell(String(r.last.qty ?? "-"), "num"),
      cell(t ? `${TREND_LABEL[t.dir]} ${formatPct(t.change)}` : "-", t ? (t.dir === "up" ? "good" : t.dir === "down" ? "bad" : "dim") : "dim"));
    tbody.append(tr);
  }
}

function renderAll(extra) {
  renderStatus(extra);
  renderRecipes();
  renderItems();
}

// ---- wczytywanie pliku ----
async function handleFile(file) {
  if (!file) return;
  const res = loadSavedVariables(await file.text());
  if (res.error) return renderAll({ cls: "err", text: res.error });
  state.model = res;
  save();
  renderAll({ cls: "ok", text: `Wczytano plik ${file.name}.` });
}

function wire() {
  const drop = $("drop");
  $("file").addEventListener("change", (e) => handleFile(e.target.files[0]));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".tab").forEach((t) => { t.hidden = t.id !== "tab-" + b.dataset.tab; });
  }));

  $("profession").addEventListener("change", (e) => { state.profession = e.target.value; renderRecipes(); });
  for (const id of ["knownOnly", "incomplete", "sellMode", "buyMode", "feeEnabled", "feeCut"])
    $(id).addEventListener("change", renderRecipes);
  document.querySelectorAll("#recipeTable th.sortable").forEach((th) =>
    th.addEventListener("click", () => { state.sortBy = th.dataset.sort; renderRecipes(); }));
  $("itemFilter").addEventListener("input", (e) => { state.itemFilter = e.target.value; renderItems(); });
  $("clear").addEventListener("click", () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignoruj */ }
    state.model = { items: new Map(), known: new Set(), scannedAt: 0 };
    renderAll({ cls: "dim", text: "Usunięto zapamiętane dane." });
  });
}

async function init() {
  wire();
  restore();
  state.recipes = await loadJson("data/recipes.json", []);
  state.catalog = await loadJson("data/items.json", { items: {} });
  renderProfessions();
  renderAll();
}
init();
