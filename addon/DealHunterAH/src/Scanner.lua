local _, ns = ...
local Scanner = {}
ns.Scanner = Scanner

-- Zbiera aukcje, które gra pokazuje po TWOIM skanie lub wyszukiwaniu (także tym z Auctionatora).
-- Nie wysyła zapytań i niczego nie kupuje ani nie wystawia.
-- Po krótkiej ciszy (FLUSH_DELAY) zapisuje do historii najniższą cenę, medianę, średnią i ilość każdego przedmiotu.
local buffer = {}   -- buffer[itemId][klucz oferty] = { unit = cena za sztukę, qty = ilość }
local pending = false
Scanner.FLUSH_DELAY = 3

-- Odczytuje całą listę aukcji, którą gra aktualnie pokazuje. Powtórne odczyty tej samej listy nie
-- dublują ofert: klucz = przedmiot, cena, ilość, sprzedawca i numer wystąpienia identycznych ofert.
function Scanner.collect()
  local n = GetNumAuctionItems("list") or 0
  local seen = {}
  for i = 1, n do
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
end

-- Zapisuje zebrane ceny do historii i czyści bufor. Zwraca liczbę zapisanych przedmiotów.
function Scanner.flush()
  pending = false
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

function Scanner.onListUpdate()
  Scanner.collect()
  if not pending then
    pending = true
    C_Timer.After(Scanner.FLUSH_DELAY, Scanner.flush)
  end
end
