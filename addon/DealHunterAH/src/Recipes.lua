local _, ns = ...
local R = {}
ns.Recipes = R

-- recipe: { id, name, profession, skill, produces = itemId, qty = 1,
--           reagents = { {item=, count=}, ... }, source = "trener"|"drop"|... }
-- ctx: jak w Valuation + vendorBuy(itemId) -> miedź | nil
-- opts: buyMode ("low"), sellMode ("median"), feeOpts
function R.evaluate(recipe, ctx, opts)
  opts = opts or {}
  local buyMode = opts.buyMode or "low"
  local cost, missing = 0, {}
  for _, r in ipairs(recipe.reagents) do
    -- składnik sprzedawany przez kupcę liczymy po cenie kupca, nie z AH
    local vb = ctx.vendorBuy and ctx.vendorBuy(r.item)
    local unit = vb or ctx.ahPrice(r.item, buyMode)
    if unit then cost = cost + unit * r.count else missing[#missing + 1] = r.item end
  end

  local res = { recipe = recipe, cost = cost, missing = missing }
  local val = ns.Valuation.itemValue(recipe.produces, ctx, opts)
  if val then
    res.valueInfo = val
    res.use = val.best
    res.value = val.value * (recipe.qty or 1)
    res.profit = res.value - cost
    res.roi = cost > 0 and res.profit / cost or nil
  end
  res.complete = (#missing == 0 and val ~= nil and not val.deIncomplete)
  return res
end

-- opts: profession, known (zbiór recipeId -> true), knownOnly, includeIncomplete, minProfit,
--       sortBy ("profit" | "roi" | "cost" | "value", malejąco)
function R.rank(recipes, ctx, opts)
  opts = opts or {}
  local out = {}
  for _, recipe in ipairs(recipes) do
    if not opts.profession or recipe.profession == opts.profession then
      local known = opts.known and opts.known[recipe.id] or false
      if not opts.knownOnly or known then
        local res = R.evaluate(recipe, ctx, opts)
        res.known = known
        if res.profit and (res.complete or opts.includeIncomplete)
            and (not opts.minProfit or res.profit >= opts.minProfit) then
          out[#out + 1] = res
        end
      end
    end
  end
  local key = opts.sortBy or "profit"
  table.sort(out, function(a, b)
    local x, y = a[key] or -math.huge, b[key] or -math.huge
    if x ~= y then return x > y end
    return a.recipe.id < b.recipe.id
  end)
  return out
end
