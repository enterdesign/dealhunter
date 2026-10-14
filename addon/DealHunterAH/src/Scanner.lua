local _, ns = ...
local Scanner = {}
ns.Scanner = Scanner

-- Zbiera aukcje, które gra pokazuje po TWOIM skanie (zalecany: pełny skan Auctionatora).
-- Nie wysyła zapytań i niczego nie kupuje ani nie wystawia.
--
-- Obsługiwane są trzy interfejsy aukcji:
--  * klasyczny (TBC, Classic Era): zdarzenie AUCTION_ITEM_LIST_UPDATE + GetNumAuctionItems / GetAuctionItemInfo,
--  * "replicate" (pełny skan w klientach z C_AuctionHouse): zdarzenie REPLICATE_ITEM_LIST_UPDATE +
--    C_AuctionHouse.GetNumReplicateItems / GetReplicateItemInfo (numeracja od 0). To zawsze kompletna lista,
--  * "browse" (WoW Forever beta; Auctionator w trybie "summary mode"): zdarzenia AUCTION_HOUSE_BROWSE_RESULTS_*
--    + C_AuctionHouse.GetBrowseResults(). Wynik to podsumowanie na przedmiot: najniższa cena i łączna ilość
--    (bez mediany i średniej).
--
-- W interfejsie klasycznym zapisujemy tylko KOMPLETNE listy: zwykłe wyszukiwanie pokazuje jedną stronę wyników,
-- a statystyki z jednej strony byłyby mylące. Po krótkiej ciszy zapisujemy najniższą cenę, medianę, średnią
-- i ilość każdego przedmiotu do historii.
local buffer = {}   -- buffer[itemId][klucz oferty] = { unit = cena za sztukę, qty = ilość }
local pending = false
local pendingSource = "classic"
Scanner.FLUSH_DELAY = 3
Scanner.FULL_SCAN_MIN = 5000   -- tyle ofert w jednej partii uznajemy za pełny skan (interfejs klasyczny)
Scanner.ignored = 0            -- ile częściowych list pominięto (do /dhah status)
Scanner.REPEAT_WINDOW = 600    -- ta sama lista (tyle samo ofert) w ciągu 10 minut to odświeżenie po skanie, nie nowy skan
Scanner.lastBatch = nil
Scanner.lastAt = 0
Scanner.events = { classic = 0, replicate = 0, browse = 0 }   -- ile zdarzeń list aukcji widziano (do /dhah debug)
Scanner.lastInfo = "brak"                         -- opis ostatnio przetworzonej listy (do /dhah debug)

function Scanner.isComplete(batch, total)
  total = total or batch
  return batch >= total or batch >= Scanner.FULL_SCAN_MIN
end

local function addOffer(seen, itemId, buyout, count, owner)
  if itemId and buyout and buyout > 0 and count and count > 0 then
    local base = itemId .. ":" .. buyout .. ":" .. count .. ":" .. (owner or "?")
    local k = (seen[base] or 0) + 1
    seen[base] = k
    local items = buffer[itemId]
    if not items then items = {}; buffer[itemId] = items end
    items[base .. "#" .. k] = { unit = buyout / count, qty = count }
  end
end

-- Interfejs klasyczny. Zwraca false, gdy lista jest pusta lub częściowa.
function Scanner.collect()
  if not GetNumAuctionItems then return false end
  local batch, total = GetNumAuctionItems("list")
  batch = batch or 0
  Scanner.lastInfo = ("klasyczny: partia %d, całość %s"):format(batch, tostring(total))
  if batch == 0 then return false end
  if not Scanner.isComplete(batch, total) then
    Scanner.ignored = Scanner.ignored + 1
    return false
  end
  local seen = {}
  for i = 1, batch do
    local _, _, count, _, _, _, _, _, _, buyout, _, _, _, owner, _, _, itemId = GetAuctionItemInfo("list", i)
    addOffer(seen, itemId, buyout, count, owner)
  end
  return true
end

-- Interfejs "replicate": pełna lista aukcji (numeracja od 0, pola jak w GetAuctionItemInfo).
function Scanner.collectReplicate()
  local ah = C_AuctionHouse
  if not (ah and ah.GetNumReplicateItems and ah.GetReplicateItemInfo) then return false end
  local n = ah.GetNumReplicateItems() or 0
  Scanner.lastInfo = ("replicate: %d ofert"):format(n)
  if n == 0 then return false end
  local seen = {}
  for i = 0, n - 1 do
    local _, _, count, _, _, _, _, _, _, buyout, _, _, _, owner, _, _, itemId = ah.GetReplicateItemInfo(i)
    addOffer(seen, itemId, buyout, count, owner)
  end
  return true
end

-- Interfejs "browse": podsumowania na przedmiot (najniższa cena i łączna ilość). Warianty tego samego przedmiotu
-- (różne klucze: poziom, przyrostek) łączymy: najniższa cena, suma ilości. Wyniki są dokładne dla każdego
-- wymienionego przedmiotu, także przy zawężonym wyszukiwaniu, więc zapisujemy wszystko, co gra pokazuje.
local browse = {}   -- browse[itemId] = { low, qty }
function Scanner.collectBrowse()
  local ah = C_AuctionHouse
  if not (ah and ah.GetBrowseResults) then return false end
  local results = ah.GetBrowseResults()
  local n = results and #results or 0
  Scanner.lastInfo = ("browse: %d wyników"):format(n)
  if n == 0 then return false end
  for _, r in ipairs(results) do
    local id = r.itemKey and r.itemKey.itemID
    local price, qty = r.minPrice, r.totalQuantity
    if id and price and price > 0 and qty and qty > 0 then
      local e = browse[id]
      if not e then e = { low = price, qty = 0 }; browse[id] = e end
      if price < e.low then e.low = price end
      e.qty = e.qty + qty
    end
  end
  return true
end

-- Zapisuje zebrane ceny do historii i czyści bufor. Zwraca liczbę zapisanych przedmiotów.
function Scanner.flush()
  local now = time()
  local saved = 0
  for itemId, offers in pairs(buffer) do
    local listings = {}
    for _, l in pairs(offers) do listings[#listings + 1] = l end
    local summary = ns.Stats.summarize(listings)
    if summary then
      ns.History.add(DealHunterAHDB, itemId, summary, now)
      saved = saved + 1
    end
  end
  buffer = {}
  for itemId, e in pairs(browse) do
    ns.History.add(DealHunterAHDB, itemId, { low = e.low, qty = e.qty }, now)   -- bez mediany i średniej
    saved = saved + 1
  end
  browse = {}
  if saved > 0 then
    print(("|cff66ccffDealHunterAH|r: zapisano ceny %d przedmiotów. Wpisz /reload, żeby plik się zapisał."):format(saved))
    if ns.onScanSaved then pcall(ns.onScanSaved) end
  end
  return saved
end

-- Odczyt i zapis robimy raz, po ciszy (pełny skan wywołuje te zdarzenia wielokrotnie).
function Scanner.process()
  pending = false
  local now = time()
  local source = pendingSource
  local n = 0
  local ah = C_AuctionHouse
  if source == "replicate" then
    n = (ah and ah.GetNumReplicateItems and ah.GetNumReplicateItems()) or 0
  elseif source == "browse" then
    local results = ah and ah.GetBrowseResults and ah.GetBrowseResults()
    n = results and #results or 0
  else
    n = GetNumAuctionItems and (GetNumAuctionItems("list") or 0) or 0
  end
  -- Po pełnym skanie gra odświeża listę jeszcze kilka razy; nie przetwarzamy i nie zgłaszamy tego samego skanu wielokrotnie.
  if n > 0 and n == Scanner.lastBatch and now - Scanner.lastAt < Scanner.REPEAT_WINDOW then return end
  local ok
  if source == "replicate" then ok = Scanner.collectReplicate()
  elseif source == "browse" then ok = Scanner.collectBrowse()
  else ok = Scanner.collect() end
  if ok then
    Scanner.flush()
    Scanner.lastBatch, Scanner.lastAt = n, now
  end
end

-- source: "classic" (domyślnie), "replicate" albo "browse"
function Scanner.onListUpdate(source)
  source = source or "classic"
  Scanner.events[source] = (Scanner.events[source] or 0) + 1
  pendingSource = source
  if not pending then
    pending = true
    C_Timer.After(Scanner.FLUSH_DELAY, Scanner.process)
  end
end
