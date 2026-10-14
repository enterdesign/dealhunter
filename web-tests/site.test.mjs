// Testy logiki strony na sztucznych danych (fixture) - to NIE są prawdziwe ceny ani receptury.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedVariables } from "../docs/js/luaparse.js";
import { summarize, trend, netProceeds, itemValue, evaluateRecipe, rankRecipes, formatMoney, formatPct } from "../docs/js/engine.js";
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

test("receptura: tańszy składnik od kupca; brak ceny = niekompletna", () => {
  const cheap = evaluateRecipe(recipe(1, 99, [[10, 2]]), ctxOf({ "10:low": 100, "99:median": 1000 }, { vendorBuy: { 10: 40 } }));
  assert.equal(cheap.cost, 80);
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

test("loadSavedVariables: nieznany format i plik Auctionatora dają czytelny błąd", () => {
  assert.match(loadSavedVariables("Foo = {}").error, /Nie rozpoznano/);
  assert.match(loadSavedVariables("AUCTIONATOR_PRICE_DATABASE = {}").error, /Auctionatora/);
  assert.match(loadSavedVariables("A = {").error, /Nie udało się/);
});
