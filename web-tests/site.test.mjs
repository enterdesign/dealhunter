// Testy logiki strony na sztucznych danych (fixture) - to NIE są prawdziwe ceny ani receptury.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedVariables } from "../docs/js/luaparse.js";
import { summarize, trend, netProceeds, itemValue, evaluateRecipe, rankRecipes, formatMoney, formatPct, disenchantStats, confidenceLabel } from "../docs/js/engine.js";
import { loadSavedVariables, makeContext } from "../docs/js/datasource.js";

// ---------- parser Lua ----------
test("parser: format zapisu WoW (komentarze, klucze, tablice)", () => {
  const text = `
DealHunterAHDB = {
	["items"] = {
		[1234] = {
			["history"] = {
				{
					["t"] = 1700000000,
					["low"] = 100.5,
					["median"] = 1.5e2,
				}, -- [1]
				{
					["t"] = 1700003600,
					["low"] = -3,
				}, -- [2]
			},
		},
	},
	["ahType"] = "faction",
	["flag"] = true,
}
`;
  const v = parseSavedVariables(text);
  const hist = v.DealHunterAHDB.items["1234"].history;
  assert.equal(hist.length, 2);
  assert.equal(hist[0].median, 150);
  assert.equal(hist[1].low, -3);
  assert.equal(v.DealHunterAHDB.ahType, "faction");
  assert.equal(v.DealHunterAHDB.flag, true);
});

test("parser: teksty, komentarze blokowe, długie teksty, wiele zmiennych", () => {
  const v = parseSavedVariables(`
--[[ komentarz
wieloliniowy ]]
A = "a\\"b\\n" -- koniec
B = [[long
text]]
C = { 1, 2, 3 }
D = { x = 1, ["y z"] = 2; [5] = 3 }
`);
  assert.equal(v.A, 'a"b\n');
  assert.equal(v.B, "long\ntext");
  assert.deepEqual(v.C, [1, 2, 3]);
  assert.deepEqual(v.D, { x: 1, "y z": 2, 5: 3 });
});

test("parser: błędny plik rzuca wyjątek", () => {
  assert.throws(() => parseSavedVariables("A = {"));
  assert.throws(() => parseSavedVariables("A = foo"));
});

// ---------- statystyki ----------
test("summarize: low / mediana ważona / średnia", () => {
  const s = summarize([{ unit: 100, qty: 1 }, { unit: 200, qty: 1 }, { unit: 1000, qty: 1 }]);
  assert.equal(s.low, 100); assert.equal(s.median, 200); assert.equal(s.qty, 3);
  assert.ok(Math.abs(s.avg - 1300 / 3) < 1e-9);
  assert.equal(summarize([{ unit: 100, qty: 1 }, { unit: 300, qty: 20 }]).median, 300);
  assert.equal(summarize([]), null);
});

const hist = (medians, step = 86400) => medians.map((m, i) => ({ t: 1_000_000 + i * step, median: m, low: m, avg: m }));

test("trend: kierunek, minimum punktów, okno czasowe", () => {
  assert.equal(trend(hist([100, 100, 100, 150])).dir, "up");
  assert.equal(trend(hist([100, 100, 100, 70])).dir, "down");
  assert.equal(trend(hist([100, 101, 99, 102])).dir, "flat");
  assert.equal(trend(hist([100, 120])), null);
  assert.equal(trend(hist([1000, 100, 100, 100, 100], 10 * 86400)), null);
});

// ---------- wycena ----------
const ctxOf = (prices, { vendorSell = {}, vendorBuy = {}, de = {} } = {}) => ({
  ahPrice: (id, mode) => prices[`${id}:${mode}`] ?? prices[id] ?? null,
  vendorSell: (id) => vendorSell[id] ?? null,
  vendorBuy: (id) => vendorBuy[id] ?? null,
  disenchant: (id) => de[id] ?? null,
});

test("prowizja: domyślnie wyłączona, po włączeniu odejmuje procent", () => {
  assert.equal(netProceeds(1000), 1000);
  assert.equal(netProceeds(1000, { enabled: true, cut: 0.05 }), 950);
});

test("itemValue: wybór najlepszej opcji i flaga niekompletnego rozbioru", () => {
  let v = itemValue(1, ctxOf({ 1: 1000, 2: 600 }, { vendorSell: { 1: 100 }, de: { 1: [{ item: 2, qty: 2, chance: 0.5 }] } }));
  assert.equal(v.best, "ah"); assert.equal(v.ah, 1000); assert.equal(v.disenchant, 600); assert.equal(v.vendor, 100);
  v = itemValue(1, ctxOf({ 2: 3000 }, { vendorSell: { 1: 100 }, de: { 1: [{ item: 2, qty: 1, chance: 1 }, { item: 3, qty: 1, chance: 0.1 }] } }));
  assert.equal(v.best, "disenchant"); assert.equal(v.deIncomplete, true);
  assert.equal(itemValue(1, ctxOf({})), null);
});

const recipe = (id, produces, reagents, extra = {}) => ({
  id, name: `r${id}`, profession: "TestProf", produces, qty: 1,
  reagents: reagents.map(([item, count]) => ({ item, count })), ...extra,
});

test("receptura: kupno po najniższej, sprzedaż po medianie, zysk", () => {
  const ctx = ctxOf({ "10:low": 100, "10:median": 150, "99:median": 1000, "99:low": 900 });
  const r = evaluateRecipe(recipe(1, 99, [[10, 4]]), ctx);
  assert.equal(r.cost, 400); assert.equal(r.value, 1000); assert.equal(r.profit, 600); assert.equal(r.complete, true);
});

test("receptura: składnik od kupca zawsze po cenie kupca (też gdy AH tańsze); brak ceny = niekompletna", () => {
  const cheap = evaluateRecipe(recipe(1, 99, [[10, 2]]), ctxOf({ "10:low": 100, "99:median": 1000 }, { vendorBuy: { 10: 40 } }));
  assert.equal(cheap.cost, 80);
  const dearer = evaluateRecipe(recipe(1, 99, [[10, 2]]), ctxOf({ "10:low": 10, "99:median": 1000 }, { vendorBuy: { 10: 40 } }));
  assert.equal(dearer.cost, 80); // vendor 40, mimo że na AH jest 10
  const onlyVendor = evaluateRecipe(recipe(1, 99, [[10, 2]]), ctxOf({ "99:median": 1000 }, { vendorBuy: { 10: 40 } }));
  assert.equal(onlyVendor.complete, true);
  const miss = evaluateRecipe(recipe(1, 99, [[10, 1]]), ctxOf({ "99:median": 1000 }));
  assert.equal(miss.complete, false); assert.deepEqual(miss.missing, [10]);
});

test("ranking: filtr profesji, znane, sortowanie", () => {
  const ctx = ctxOf({ "10:low": 100, "11:low": 1000, "98:median": 400, "99:median": 3000 });
  const recipes = [
    recipe(1, 98, [[10, 1]]),
    recipe(2, 99, [[11, 1]]),
    recipe(3, 99, [[10, 1]], { profession: "Other" }),
  ];
  const ids = (o) => rankRecipes(recipes, ctx, o).map((r) => r.recipe.id);
  assert.deepEqual(ids({ profession: "TestProf", sortBy: "profit" }), [2, 1]);
  assert.deepEqual(ids({ profession: "TestProf", sortBy: "roi" }), [1, 2]);
  assert.deepEqual(ids({ profession: "TestProf", sortBy: "cost" }), [2, 1]);
  const known = rankRecipes(recipes, ctx, { profession: "TestProf", known: new Set([1]) });
  assert.equal(known.find((r) => r.recipe.id === 1).known, true);
  assert.equal(known.find((r) => r.recipe.id === 2).known, false);
  assert.deepEqual(ids({ profession: "TestProf", known: new Set([1]), knownOnly: true }), [1]);
});

test("formatowanie", () => {
  assert.equal(formatMoney(123456), "12g 34s 56c");
  assert.equal(formatMoney(-150), "-0g 1s 50c");
  assert.equal(formatMoney(null), "?");
  assert.equal(formatPct(0.256), "+26%");
  assert.equal(formatPct(null), "-");
});

// ---------- źródło danych ----------
test("loadSavedVariables: plik addona DealHunterAH", () => {
  const m = loadSavedVariables(`DealHunterAHDB = {
    ["items"] = { [50] = { ["history"] = { { ["t"] = 20, ["low"] = 5 }, { ["t"] = 10, ["low"] = 4 } } } },
    ["known"] = { ["Engineering"] = { [3918] = true } },
  }`);
  assert.equal(m.error, undefined);
  assert.deepEqual(m.items.get(50).map((p) => p.t), [10, 20]); // posortowane po czasie
  assert.ok(m.known.has(3918));
  assert.equal(m.scannedAt, 20);
  const ctx = makeContext(m);
  assert.equal(ctx.ahPrice(50, "low"), 5);
  assert.equal(ctx.ahPrice(51, "low"), null);
});

test("loadSavedVariables: znane receptury o kluczach 1..n (parser zwraca tablicę)", () => {
  const m = loadSavedVariables('DealHunterAHDB = { ["items"] = {}, ["known"] = { ["Engineering"] = { [1] = true, [2] = true } } }');
  assert.deepEqual([...m.known].sort(), [1, 2]);
});

test("makeContext: przedmiot BoP nie ma ceny AH, katalog daje nazwę i cenę u kupca", () => {
  const m = loadSavedVariables('DealHunterAHDB = { ["items"] = { [7] = { ["history"] = { { ["t"] = 1, ["low"] = 5 } } } } }');
  const ctx = makeContext(m, { items: { 7: { name: "X", bop: true, vendorSell: 9 }, 8: { vendorSell: 3 } } });
  assert.equal(ctx.ahPrice(7, "low"), null);
  assert.equal(ctx.vendorSell(7), 9);
  assert.equal(ctx.vendorSell(8), 3);
});

test("loadSavedVariables: nieznany format i plik Auctionatora dają czytelny błąd", () => {
  assert.match(loadSavedVariables("Foo = {}").error, /Nie rozpoznano/);
  assert.match(loadSavedVariables("AUCTIONATOR_PRICE_DATABASE = {}").error, /Auctionatora/);
  assert.match(loadSavedVariables("A = {").error, /Nie udało się/);
});

// ---------- okazje ----------
import { professionIndex, matchesProfession, vendorFlips, ahFlips, disenchantFlips, craftFlips,
  resolveWatchlist, guideInvestments, filterRows, sortRows, onlyProfitable, NO_PROFESSION } from "../docs/js/opportunities.js";

const mk = (entries) => ({ items: new Map(entries.map(([id, h]) => [id, h])) });
const H = (prices, extra = {}) => prices.map((p, i) => ({ t: 1_000_000 + i * 86400, low: p, median: p, avg: p, qty: 5, ...extra }));
const cat = (items) => ({ items });

test("indeks profesji i filtr", () => {
  const idx = professionIndex([recipe(1, 99, [[10, 1]]), recipe(2, 98, [[10, 1]], { profession: "Other" })]);
  assert.deepEqual([...idx.get(10)].sort(), ["Other", "TestProf"]);
  assert.deepEqual([...idx.get(99)], ["TestProf"]);
  assert.equal(matchesProfession(["A"], ""), true);
  assert.equal(matchesProfession(["A"], "A"), true);
  assert.equal(matchesProfession(["A"], "B"), false);
  assert.equal(matchesProfession([], NO_PROFESSION), true);
  assert.equal(matchesProfession(["A"], NO_PROFESSION), false);
});

test("flipy do vendora: pokazuje wszystkie przedmioty z ceną u kupca, także ze stratą", () => {
  const model = mk([[1, H([100, 100, 100])], [2, H([500])], [3, H([50])]]);
  const catalog = cat({ 1: { name: "A", vendorSell: 300 }, 2: { name: "B", vendorSell: 400 }, 3: { name: "C" } });
  const rows = sortRows(vendorFlips(model, catalog, new Map()), "profit");
  assert.deepEqual(rows.map((r) => [r.id, r.profit]), [[1, 200], [2, -100]]);
  assert.equal(rows[0].roi, 2);
  assert.deepEqual(onlyProfitable(rows).map((r) => r.id), [1]);
});

test("flipy AH: porównanie z historyczną medianą, wszystkie z historią, ujemne też", () => {
  const model = mk([
    [1, H([1000, 1000, 1000, 600])],   // okazja: 600 vs 1000
    [2, H([1000, 1000, 1000, 950])],   // za mała zniżka
    [3, H([1000, 600])],               // za mało punktów
    [4, H([1000, 1000, 1000, 1500])],  // drożej niż zwykle
    [5, H([50, 50, 50, 10])],          // poniżej minPrice
  ]);
  const catalog = cat({ 1: { name: "A" }, 2: { name: "B" }, 3: { name: "C" }, 4: { name: "D" }, 5: { name: "E" } });
  const rows = sortRows(ahFlips(model, catalog, new Map()), "profit");
  assert.deepEqual(rows.map((r) => [r.id, r.profit]), [[1, 400], [2, 50], [4, -500]]); // 3 (za mało punktów) i 5 (za tanie) pominięte
  assert.equal(rows[0].trend.dir, "down");
  // prowizja zmniejsza zysk
  const withFee = sortRows(ahFlips(model, catalog, new Map(), { fee: { enabled: true, cut: 0.1 } }), "profit");
  assert.equal(withFee[0].profit, 300);
});

test("rozbiór: zawsze pokazany (także ze stratą), z EV, rozrzutem i dwoma najczęstszymi wynikami", () => {
  const model = mk([[1, H([100])], [2, H([1000])], [9, H([5000])]]);
  const ctx = ctxOf({}, { de: {
    1: [{ item: 2, chance: 0.75, qty: 1.5, dist: [[1, 0.5], [2, 0.5]] }, { item: 3, chance: 0.25, dist: [[1, 1]] }],
    9: [{ item: 2, chance: 1, dist: [[1, 1]] }],
  } });
  ctx.ahPrice = (id, mode) => model.items.get(id)?.at(-1)[mode] ?? null;
  ctx.deSample = (id) => (id === 1 ? 800 : 20);
  const rows = sortRows(disenchantFlips(model, cat({ 1: { name: "Zielony" }, 9: { name: "Drogi" } }), ctx), "profit");
  assert.equal(rows.length, 2); // ujemny też
  const [good, bad] = rows;
  assert.equal(good.id, 1);
  // materiał 3 bez ceny -> niekompletne; EV z samego materiału 2: 0.375*1000 + 0.375*2000 = 1125
  assert.equal(good.complete, false);
  assert.equal(Math.round(good.value), 1125); assert.equal(Math.round(good.profit), 1025);
  assert.deepEqual(good.de.top.map((x) => [x.item, x.qty]).slice(0, 2).sort(), [[2, 1], [2, 2]].sort());
  assert.equal(good.confidence, "wysoka"); assert.equal(bad.confidence, "niska");
  assert.equal(bad.profit, 1000 - 5000);
  assert.deepEqual(good.professions, ["Enchanting"]);
});

test("disenchantStats: EV i odchylenie dla wykluczających się wyników", () => {
  // 50%: 1 szt. po 100, 50%: nic -> EV 50, SD 50
  const s = disenchantStats([{ item: 1, chance: 0.5, dist: [[1, 1]] }], () => 100);
  assert.equal(s.ev, 50); assert.equal(s.sd, 50); assert.equal(s.exclusive, true);
  // dwa wykluczające się wyniki po 50%: 100 albo 300 -> EV 200, SD 100
  const t = disenchantStats([{ item: 1, chance: 0.5, dist: [[1, 1]] }, { item: 2, chance: 0.5, dist: [[1, 1]] }], (i) => (i === 1 ? 100 : 300));
  assert.equal(t.ev, 200); assert.equal(t.sd, 100);
  assert.equal(t.top.length, 2); assert.equal(t.top[0].p, 0.5);
  // szanse > 1 -> przybliżenie niezależnością
  const u = disenchantStats([{ item: 1, chance: 1, dist: [[1, 1]] }, { item: 2, chance: 1, dist: [[1, 1]] }], () => 100);
  assert.equal(u.exclusive, false); assert.equal(u.ev, 200); assert.equal(u.sd, 0);
  assert.equal(confidenceLabel(500), "wysoka"); assert.equal(confidenceLabel(100), "średnia"); assert.equal(confidenceLabel(10), "niska");
  assert.equal(confidenceLabel(null), "nieznana");
});

test("receptury jako okazje: koszt, zysk i profesja", () => {
  const ctx = ctxOf({ "10:low": 100, "99:median": 1000 });
  const rows = craftFlips([recipe(1, 99, [[10, 2]])], ctx, {});
  assert.equal(rows[0].cost, 200); assert.equal(rows[0].profit, 800); assert.deepEqual(rows[0].professions, ["TestProf"]);
});

test("inwestycje z guidów: nazwy -> id, cena, dystans do historii", () => {
  const catalog = cat({ 7: { name: "Primal Mana" }, 8: { name: "Primal Mana" }, 9: { name: "Void Crystal" } });
  const model = mk([[8, H([1000, 1000, 1000, 800])]]);
  const strategies = [{ title: "Zielarstwo", profession: "Herbalism", items: [{ name: "Primal Mana", value: "Moderate" }, { name: "Nie ma takiego" }] }];
  const watch = resolveWatchlist(strategies, catalog, model);
  assert.deepEqual(watch.map((w) => w.id), [8]); // wybiera zeskanowany wariant
  const rows = guideInvestments(watch, model, catalog);
  assert.equal(rows[0].cost, 800); assert.equal(rows[0].value, 1000); assert.equal(rows[0].profit, 200);
  assert.deepEqual(rows[0].professions, ["Herbalism"]);
});

test("filtrowanie i sortowanie po zysku, koszcie, ROI", () => {
  const rows = [
    { name: "a", cost: 100, profit: 50, roi: 0.5, professions: ["X"] },
    { name: "b", cost: 1000, profit: 200, roi: 0.2, professions: ["Y"] },
    { name: "c", cost: 10, profit: 5, roi: null, professions: [] },
  ];
  assert.deepEqual(sortRows(rows, "profit").map((r) => r.name), ["b", "a", "c"]);
  assert.deepEqual(sortRows(rows, "cost", "asc").map((r) => r.name), ["c", "a", "b"]);
  assert.deepEqual(sortRows(rows, "roi").map((r) => r.name), ["a", "b", "c"]);
  assert.deepEqual(filterRows(rows, "X").map((r) => r.name), ["a"]);
  assert.deepEqual(filterRows(rows, NO_PROFESSION).map((r) => r.name), ["c"]);
});

import { runCheck } from "../docs/js/opportunities.js";
import { makeDisenchant } from "../docs/js/datasource.js";

test("makeDisenchant: wyniki rozbioru po przedziale; brak = null", () => {
  const de = makeDisenchant({ brackets: { 5: { n: 10, outcomes: [[22445, 0.8, [[2, 0.5], [3, 0.5]]], [22447, 0.2, [[1, 1]]]] } }, items: { 100: 5 } });
  assert.deepEqual(de(100), [{ item: 22445, chance: 0.8, dist: [[2, 0.5], [3, 0.5]], qty: 2.5 }, { item: 22447, chance: 0.2, dist: [[1, 1]], qty: 1 }]);
  assert.equal(de.sample(100), 10);
  assert.equal(de(101), null);
  assert.equal(makeDisenchant(null), null);
});

test("makeContext: ceny składników u kupców z vendors.json", () => {
  const m = loadSavedVariables('DealHunterAHDB = { ["items"] = {} }');
  const ctx = makeContext(m, { items: {}, vendors: { 5140: 24 } });
  assert.equal(ctx.vendorBuy(5140), 24);
  assert.equal(ctx.vendorBuy(1), null);
});

test("runCheck: brak skanu = null, z danymi najlepsze receptury", () => {
  const empty = mk([]);
  const ctx = ctxOf({ "10:low": 100, "99:median": 1000 });
  const env = { recipes: [recipe(1, 99, [[10, 2]])], model: empty, catalog: cat({}), ctx };
  assert.equal(runCheck({ type: "topRecipes", profession: "TestProf" }, env), null);
  const withData = { ...env, model: mk([[10, H([100])]]) };
  const rows = runCheck({ type: "topRecipes", profession: "TestProf" }, withData);
  assert.equal(rows.length, 1); assert.equal(rows[0].profit, 800);
  assert.equal(runCheck({ type: "nieznany" }, withData), null);
});
