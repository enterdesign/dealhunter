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
for _, event in ipairs({ "AUCTION_ITEM_LIST_UPDATE", "TRADE_SKILL_SHOW", "CRAFT_SHOW" }) do
  pcall(frame.RegisterEvent, frame, event)
end

local function reportKnown(added, profession, total)
  if not profession then
    say("nie widzę otwartego okna profesji (otwórz profesję i spróbuj ponownie).")
  elseif added > 0 then
    say(("zapisano %d nowych receptur (%s, razem %d). Wpisz /reload, żeby plik się zapisał."):format(added, profession, total))
  else
    say(("brak nowych receptur (%s, zapisanych %d). Rozwiń wszystkie kategorie i wyłącz filtry, jeśli czegoś brakuje."):format(profession, total))
  end
end

-- Skan receptur uruchamia użytkownik: przycisk w oknie profesji albo /dhah recipes.
local function scanRecipes(kind)
  if kind == "craft" then return ns.Known.scanCraft() end
  return ns.Known.scanTradeSkill()
end

local function addButton(parent, name, kind)
  if not parent or _G[name] then return end
  local button = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  button:SetSize(130, 22)
  button:SetText("Zapisz receptury")
  button:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -70, -14)
  button:SetScript("OnClick", function() reportKnown(scanRecipes(kind)) end)
end

frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON then
    DealHunterAHDB = DealHunterAHDB or {}
    DealHunterAHDB.items = DealHunterAHDB.items or {}
    DealHunterAHDB.known = DealHunterAHDB.known or {}
  elseif event == "AUCTION_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate()
  elseif event == "TRADE_SKILL_SHOW" then
    pcall(addButton, _G.TradeSkillFrame, "DealHunterAHRecipesButton", "tradeskill")
  elseif event == "CRAFT_SHOW" then
    pcall(addButton, _G.CraftFrame, "DealHunterAHCraftButton", "craft")
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
  if ns.Scanner.ignored > 0 then
    say(("pominięto %d częściowych list aukcji (zwykłe wyszukiwanie pokazuje tylko jedną stronę). Ceny zapisują się z pełnego skanu."):format(ns.Scanner.ignored))
  end
  local total, per = ns.Known.count()
  if total == 0 then
    say("znane receptury: brak. Otwórz okno profesji (rozwiń kategorie, wyłącz filtry) i kliknij \"Zapisz receptury\" albo wpisz /dhah recipes.")
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
  elseif cmd == "recipes" or cmd == "scan" then
    -- zapisuje otwarte okno profesji (tradeskill i/lub craft)
    local added, prof, total = ns.Known.scanTradeSkill()
    if prof then reportKnown(added, prof, total) end
    local cAdded, cProf, cTotal = ns.Known.scanCraft()
    if cProf then reportKnown(cAdded, cProf, cTotal) end
    if not prof and not cProf then reportKnown(0, nil, 0) end
  elseif cmd == "reset" and arg == "yes" then
    DealHunterAHDB.items = {}
    DealHunterAHDB.known = {}
    say("usunięto zapisane ceny i receptury.")
  elseif cmd == "reset" then say("to usunie wszystkie zapisane ceny i receptury. Potwierdź: /dhah reset yes")
  else say("komendy: /dhah (status) | /dhah recipes (zapisz otwarte okno profesji) | /dhah item <link> | /dhah reset yes") end
end
