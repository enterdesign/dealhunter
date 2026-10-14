local ADDON, ns = ...

local function money(c)
  if not c then return "?" end
  c = math.floor(c + 0.5)
  local sign = c < 0 and "-" or ""
  c = math.abs(c)
  return ("%s%dg %ds %dc"):format(sign, math.floor(c / 10000), math.floor(c / 100) % 100, c % 100)
end

local function say(msg) print("|cff66ccffDealHunterAH|r: " .. msg) end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("AUCTION_ITEM_LIST_UPDATE")
frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON then
    DealHunterAHDB = DealHunterAHDB or { items = {}, ahType = "faction" }
  elseif event == "AUCTION_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate()
  end
end)

local function cmdItem(arg)
  local itemId = tonumber(arg) or tonumber(arg:match("item:(%d+)"))
  if not itemId then return say("użycie: /dhah item <link lub id>") end
  local ctx = ns.MakeContext()
  local opts = { feeOpts = { ahType = DealHunterAHDB.ahType } }
  local val = ns.Valuation.itemValue(itemId, ctx, opts)
  local item = DealHunterAHDB.items[itemId]
  local last = item and item.history[#item.history]
  say(("item %d"):format(itemId))
  if last then
    say(("  AH: najniższa %s, mediana %s, średnia %s (ilość %d)"):format(
      money(last.low), money(last.median), money(last.avg), last.qty))
    local tr = ns.Stats.trend(item.history)
    if tr then say(("  trend 7d: %s (%+.1f%%)"):format(tr.dir, tr.change * 100)) end
  else
    say("  brak zapisanych cen AH (zrób skan)")
  end
  if val then
    say(("  vendor %s | AH netto %s | disenchant %s | najlepiej: %s"):format(
      money(val.vendor), money(val.ah), money(val.disenchant), val.best))
  end
end

local function cmdTop(arg)
  local recipes = ns.Data and ns.Data.recipes
  if not recipes then return say("brak danych receptur (Data\\Recipes.lua nie wygenerowany)") end
  local profession = arg ~= "" and arg or nil
  local ranked = ns.Recipes.rank(recipes, ns.MakeContext(), {
    profession = profession, feeOpts = { ahType = DealHunterAHDB.ahType },
  })
  for i = 1, math.min(10, #ranked) do
    local r = ranked[i]
    say(("%d. %s: zysk %s (koszt %s, %s)%s"):format(
      i, r.recipe.name, money(r.profit), money(r.cost), r.use, r.known and "" or " [nieznana]"))
  end
  if #ranked == 0 then say("brak kompletnych wyników - zrób skan AH dla składników i wyrobów") end
end

SLASH_DEALHUNTERAH1 = "/dhah"
SlashCmdList["DEALHUNTERAH"] = function(msg)
  local cmd, arg = msg:match("^(%S*)%s*(.*)$")
  if cmd == "item" then cmdItem(arg)
  elseif cmd == "top" then cmdTop(arg)
  elseif cmd == "ah" and (arg == "faction" or arg == "neutral") then
    DealHunterAHDB.ahType = arg; say("typ AH: " .. arg)
  else say("komendy: /dhah item <link> | /dhah top [profesja] | /dhah ah faction|neutral") end
end
