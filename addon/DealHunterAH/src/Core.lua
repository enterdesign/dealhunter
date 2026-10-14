local ADDON, ns = ...

local function say(msg) print("|cff66ccffDealHunterAH|r: " .. msg) end

local function money(c)
  if not c then return "?" end
  c = math.floor(c + 0.5)
  return ("%dg %ds %dc"):format(math.floor(c / 10000), math.floor(c / 100) % 100, c % 100)
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
-- Zdarzenia opcjonalne rejestrujemy w pcall: jeśli któregoś klient nie zna, addon i tak się załaduje.
for _, event in ipairs({ "AUCTION_ITEM_LIST_UPDATE", "TRADE_SKILL_SHOW", "TRADE_SKILL_UPDATE", "CRAFT_SHOW", "CRAFT_UPDATE" }) do
  pcall(frame.RegisterEvent, frame, event)
end

local function reportKnown(added, profession)
  if added and added > 0 then
    say(("zapisano %d nowych receptur (%s). Wpisz /reload, żeby plik się zapisał."):format(added, tostring(profession)))
  end
end

frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON then
    DealHunterAHDB = DealHunterAHDB or {}
    DealHunterAHDB.items = DealHunterAHDB.items or {}
    DealHunterAHDB.known = DealHunterAHDB.known or {}
  elseif event == "AUCTION_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate()
  elseif event == "TRADE_SKILL_SHOW" or event == "TRADE_SKILL_UPDATE" then
    reportKnown(ns.Known.scanTradeSkill())
  elseif event == "CRAFT_SHOW" or event == "CRAFT_UPDATE" then
    reportKnown(ns.Known.scanCraft())
  end
end)

local function cmdStatus()
  local items, last = 0, 0
  for _, entry in pairs(DealHunterAHDB.items) do
    items = items + 1
    local h = entry.history
    if h and h[#h] and h[#h].t > last then last = h[#h].t end
  end
  say(("przedmiotów z cenami: %d, ostatni skan: %s"):format(items, last > 0 and date("%Y-%m-%d %H:%M", last) or "brak"))
  local total, per = ns.Known.count()
  if total == 0 then
    say("znane receptury: brak. Otwórz okno każdej profesji (rozwiń kategorie i wyłącz filtry).")
  else
    local parts = {}
    for prof, n in pairs(per) do parts[#parts + 1] = ("%s %d"):format(prof, n) end
    table.sort(parts)
    say("znane receptury: " .. table.concat(parts, ", "))
  end
  say("plik zapisuje się przy /reload albo wylogowaniu: WTF/Account/<konto>/SavedVariables/DealHunterAH.lua")
end

local function cmdItem(arg)
  local itemId = tonumber(arg) or tonumber(arg:match("item:(%d+)"))
  if not itemId then return say("użycie: /dhah item <link lub id>") end
  local entry = DealHunterAHDB.items[itemId]
  local h = entry and entry.history
  local last = h and h[#h]
  if not last then return say(("brak zapisanych cen dla przedmiotu %d"):format(itemId)) end
  say(("%s: najniższa %s, mediana %s, średnia %s, ofert %d, zapisanych skanów %d"):format(
    GetItemInfo(itemId) or ("item " .. itemId), money(last.low), money(last.median), money(last.avg), last.qty, #h))
  local tr = ns.Stats.trend(h)
  if tr then say(("trend 7 dni: %s (%+.1f%%)"):format(tr.dir, tr.change * 100)) end
end

SLASH_DEALHUNTERAH1 = "/dhah"
SlashCmdList["DEALHUNTERAH"] = function(msg)
  local cmd, arg = msg:match("^(%S*)%s*(.*)$")
  if cmd == "" or cmd == "status" then cmdStatus()
  elseif cmd == "item" then cmdItem(arg)
  elseif cmd == "reset" and arg == "yes" then
    DealHunterAHDB.items = {}
    DealHunterAHDB.known = {}
    say("usunięto zapisane ceny i receptury.")
  elseif cmd == "reset" then say("to usunie wszystkie zapisane ceny i receptury. Potwierdź: /dhah reset yes")
  else say("komendy: /dhah (status) | /dhah item <link> | /dhah reset yes") end
end
