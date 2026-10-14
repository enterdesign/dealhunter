local _, ns = ...
local Scanner = {}
ns.Scanner = Scanner

-- Zbiera aukcje, które gra pokazuje po TWOIM skanie (zalecany: pełny skan Auctionatora, "GetAll").
-- Nie wysyła zapytań i niczego nie kupuje ani nie wystawia.
--
-- Zapisujemy tylko KOMPLETNE listy: zwykłe wyszukiwanie pokazuje jedną stronę wyników, a statystyki z jednej
-- strony byłyby mylące. Lista jest kompletna, gdy gra pokazuje wszystkie wyniki naraz (partia == całość) albo
-- jest to pełny skan (bardzo duża partia). Po krótkiej ciszy zapisujemy najniższą cenę, medianę, średnią
-- i ilość każdego przedmiotu do historii.
local buffer = {}   -- buffer[itemId][klucz oferty] = { unit = cena za sztukę, qty = ilość }
local pending = false
Scanner.FLUSH_DELAY = 3
Scanner.FULL_SCAN_MIN = 5000   -- tyle ofert w jednej partii uznajemy za pełny skan
Scanner.ignored = 0            -- ile częściowych list pominięto (do /dhah status)
Scanner.REPEAT_WINDOW = 600    -- ta sama lista (tyle samo ofert) w ciągu 10 minut to odświeżenie po skanie, nie nowy skan
Scanner.lastBatch = nil
Scanner.lastAt = 0

function Scanner.isComplete(batch, total)
  total = total or batch
  return batch >= total or batch >= Scanner.FULL_SCAN_MIN
end

-- Odczytuje całą listę aukcji, którą gra aktualnie pokazuje. Zwraca false, gdy lista jest częściowa.
-- Klucz oferty = przedmiot, cena, ilość, sprzedawca i numer wystąpienia identycznych ofert.
function Scanner.collect()
  local batch, total = GetNumAuctionItems("list")
  batch = batch or 0
  if batch == 0 then return false end
  if not Scanner.isComplete(batch, total) then
    Scanner.ignored = Scanner.ignored + 1
    return false
  end
  local seen = {}
  for i = 1, batch do
    local _, _, count, _, _, _, _, _, _, buyout, _, _, _, owner, _, _, itemId = GetAuctionItemInfo("list", i)
    if itemId and buyout and buyout > 0 and count and count > 0 then
      local base = itemId .. ":" .. buyout .. ":" .. count .. ":" .. (owner or "?")
      local k = (seen[base] or 0) + 1
      seen[base] = k
      local items = buffer[itemId]
      if not items then items = {}; buffer[itemId] = items end
      items[base .. "#" .. k] = { unit = buyout / count, qty = count }
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
  if saved > 0 then
    print(("|cff66ccffDealHunterAH|r: zapisano ceny %d przedmiotów. Wpisz /reload, żeby plik się zapisał."):format(saved))
  end
  return saved
end

-- Odczyt i zapis robimy raz, po ciszy (pełny skan wywołuje to zdarzenie wielokrotnie).
function Scanner.process()
  pending = false
  local batch = GetNumAuctionItems("list") or 0
  local now = time()
  -- Po pełnym skanie gra odświeża listę jeszcze kilka razy; nie przetwarzamy i nie zgłaszamy tego samego skanu wielokrotnie.
  if batch > 0 and batch == Scanner.lastBatch and now - Scanner.lastAt < Scanner.REPEAT_WINDOW then return end
  if Scanner.collect() then
    Scanner.flush()
    Scanner.lastBatch, Scanner.lastAt = batch, now
  end
end

function Scanner.onListUpdate()
  if not pending then
    pending = true
    C_Timer.After(Scanner.FLUSH_DELAY, Scanner.process)
  end
end
