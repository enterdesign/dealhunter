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
local EVENTS = { "AUCTION_ITEM_LIST_UPDATE", "REPLICATE_ITEM_LIST_UPDATE", "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED",
  "AUCTION_HOUSE_BROWSE_RESULTS_ADDED", "AUCTION_HOUSE_SHOW", "TRADE_SKILL_SHOW", "CRAFT_SHOW" }
for _, event in ipairs(EVENTS) do
  pcall(frame.RegisterEvent, frame, event)
end

-- Tryb podsłuchu (/dhah spy): zlicza zdarzenia z nazwą dotyczącą aukcji, żeby zobaczyć, co robi klient.
local spy = nil
local function isAuctionEvent(name)
  return name:find("AUCTION") or name:find("REPLICATE") or name:find("COMMODIT") or name:find("BROWSE")
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
  local added, prof, total = ns.Known.scanTradeSkill()
  if prof then return added, prof, total end
  return ns.Known.scanModern()
end

-- Okno profesji różni się między wersjami gry, więc przycisk jest samodzielny (na UIParent, wysoka warstwa)
-- i przyczepiany pod oknem, które akurat jest otwarte. Awaryjnie zawsze działa /dhah recipes.
local WINDOWS = { "ProfessionsFrame", "TradeSkillFrame", "CraftFrame" }

local function findWindow(kind)
  if kind == "craft" then return _G.CraftFrame end
  for _, name in ipairs(WINDOWS) do
    local w = _G[name]
    if w and w.IsShown and w:IsShown() then return w end
  end
  return _G.TradeSkillFrame or _G.ProfessionsFrame
end

local function addButton(kind)
  local name = "DealHunterAHRecipesButton"
  local button = _G[name]
  if not button then
    button = CreateFrame("Button", name, UIParent, "UIPanelButtonTemplate")
    button:SetSize(150, 24)
    button:SetText("Zapisz receptury")
    button:SetFrameStrata("FULLSCREEN_DIALOG")
    button:SetScript("OnClick", function() reportKnown(scanRecipes(button.kind)) end)
  end
  button.kind = kind
  local window = findWindow(kind)
  button:ClearAllPoints()
  if window then
    button:SetPoint("TOPLEFT", window, "BOTTOMLEFT", 10, 4)
    if window.HookScript and not window.dhahHooked then
      window.dhahHooked = true
      window:HookScript("OnHide", function() button:Hide() end)
    end
  else
    button:SetPoint("CENTER", UIParent, "CENTER", 0, -300)
  end
  button:Show()
end

frame:SetScript("OnEvent", function(_, event, arg1)
  if spy and isAuctionEvent(event) then spy[event] = (spy[event] or 0) + 1 end
  if event == "ADDON_LOADED" and arg1 == ADDON then
    DealHunterAHDB = DealHunterAHDB or {}
    DealHunterAHDB.items = DealHunterAHDB.items or {}
    DealHunterAHDB.known = DealHunterAHDB.known or {}
  elseif event == "AUCTION_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate("classic")
  elseif event == "REPLICATE_ITEM_LIST_UPDATE" then
    ns.Scanner.onListUpdate("replicate")
  elseif event == "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED" or event == "AUCTION_HOUSE_BROWSE_RESULTS_ADDED" then
    ns.Scanner.onListUpdate("browse")
  elseif event == "AUCTION_HOUSE_SHOW" then
    ns.ahOpened = (ns.ahOpened or 0) + 1
  elseif event == "TRADE_SKILL_SHOW" then
    pcall(addButton, "tradeskill")
    if C_Timer and C_Timer.After then C_Timer.After(0.3, function() pcall(addButton, "tradeskill") end) end
  elseif event == "CRAFT_SHOW" then
    pcall(addButton, "craft")
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

local function cmdDebug()
  say("diagnostyka aukcji (przepisz to, jeśli ceny się nie zapisują):")
  local ah = C_AuctionHouse
  say(("API klasyczne: GetNumAuctionItems=%s, GetAuctionItemInfo=%s, QueryAuctionItems=%s"):format(
    type(GetNumAuctionItems), type(GetAuctionItemInfo), type(QueryAuctionItems)))
  say(("API replicate: C_AuctionHouse=%s, GetNumReplicateItems=%s, GetReplicateItemInfo=%s, ReplicateItems=%s"):format(
    type(ah), type(ah and ah.GetNumReplicateItems), type(ah and ah.GetReplicateItemInfo), type(ah and ah.ReplicateItems)))
  say(("API browse: GetBrowseResults=%s, HasFullBrowseResults=%s"):format(
    type(ah and ah.GetBrowseResults), type(ah and ah.HasFullBrowseResults)))
  local tui = C_TradeSkillUI
  say(("profesje: klasyczne GetNumTradeSkills=%s, nowe C_TradeSkillUI=%s (GetAllRecipeIDs=%s, GetRecipeInfo=%s)"):format(
    type(GetNumTradeSkills), type(tui), type(tui and tui.GetAllRecipeIDs), type(tui and tui.GetRecipeInfo)))
  say(("zdarzenia list aukcji: klasyczne %d, replicate %d, browse %d; otwarć AH: %d"):format(
    ns.Scanner.events.classic, ns.Scanner.events.replicate, ns.Scanner.events.browse, ns.ahOpened or 0))
  say(("ostatnia lista: %s; pominiętych częściowych: %d"):format(ns.Scanner.lastInfo, ns.Scanner.ignored))
  if GetNumAuctionItems then say(("GetNumAuctionItems(\"list\") teraz: %s"):format(table.concat({ tostring((GetNumAuctionItems("list"))), tostring(select(2, GetNumAuctionItems("list"))) }, " / "))) end
  if ah and ah.GetNumReplicateItems then say(("GetNumReplicateItems() teraz: %s"):format(tostring(ah.GetNumReplicateItems()))) end
  if ah and ah.GetBrowseResults then
    local results = ah.GetBrowseResults()
    say(("GetBrowseResults() teraz: %d wyników"):format(results and #results or 0))
  end
  if spy then
    local names = {}
    for name, n in pairs(spy) do names[#names + 1] = ("%s=%d"):format(name, n) end
    table.sort(names)
    say("podsłuch zdarzeń: " .. (#names > 0 and table.concat(names, ", ") or "nic nie złapano"))
  else
    say("podsłuch zdarzeń wyłączony (włącz: /dhah spy, zrób skan, potem /dhah debug)")
  end
end

local function cmdSpy()
  if spy then
    frame:UnregisterAllEvents()
    for _, event in ipairs(EVENTS) do pcall(frame.RegisterEvent, frame, event) end
    say("podsłuch wyłączony.")
    spy = nil
  else
    spy = {}
    frame:RegisterAllEvents()
    say("podsłuch włączony: zrób skan AH, potem wpisz /dhah debug. Wyłącz: /dhah spy.")
  end
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
  elseif cmd == "debug" then cmdDebug()
  elseif cmd == "spy" then cmdSpy()
  elseif cmd == "recipes" or cmd == "scan" then
    -- zapisuje otwarte okno profesji (tradeskill i/lub craft)
    local added, prof, total = scanRecipes("tradeskill")
    if prof then reportKnown(added, prof, total) end
    local cAdded, cProf, cTotal = ns.Known.scanCraft()
    if cProf then reportKnown(cAdded, cProf, cTotal) end
    if not prof and not cProf then reportKnown(0, nil, 0) end
  elseif cmd == "reset" and arg == "yes" then
    DealHunterAHDB.items = {}
    DealHunterAHDB.known = {}
    say("usunięto zapisane ceny i receptury.")
  elseif cmd == "reset" then say("to usunie wszystkie zapisane ceny i receptury. Potwierdź: /dhah reset yes")
  else say("komendy: /dhah (status) | /dhah recipes (zapisz otwarte okno profesji) | /dhah item <link> | /dhah debug | /dhah spy | /dhah reset yes") end
end
