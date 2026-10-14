local ADDON, ns = ...

local money = function(c) return ns.Format.money(c) end

local function say(msg) print("|cff66ccffDealHunterAH|r: " .. msg) end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("AUCTION_ITEM_LIST_UPDATE")
frame:RegisterEvent("TRADE_SKILL_SHOW")
frame:RegisterEvent("TRADE_SKILL_UPDATE")
frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON then
    DealHunterAHDB = DealHunterAHDB or { items = {}, ahType = "faction" }
  elseif event == "AUCTION_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate()
  elseif event == "TRADE_SKILL_SHOW" or event == "TRADE_SKILL_UPDATE" then
    ns.Known.scan()
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
    say(("  vendor %s | AH %s | disenchant %s | najlepiej: %s"):format(
      money(val.vendor), money(val.ah), money(val.disenchant), val.best))
  end
end

SLASH_DEALHUNTERAH1 = "/dhah"
SlashCmdList["DEALHUNTERAH"] = function(msg)
  local cmd, arg = msg:match("^(%S*)%s*(.*)$")
  if cmd == "item" then cmdItem(arg)
  elseif cmd == "" or cmd == "top" then ns.UI.toggle()
  else say("komendy: /dhah (okno) | /dhah item <link>") end
end
