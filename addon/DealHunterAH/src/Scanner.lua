local _, ns = ...
local Scanner = {}
ns.Scanner = Scanner

-- Zbiera aukcje, które gra pokazuje po TWOIM skanie/wyszukiwaniu (też tym z Auctionatora).
-- Nie wysyła zapytań ani niczego nie kupuje.
local buffer = {}   -- buffer[itemId][sygnatura] = {unit, qty}
local pending = false
local FLUSH_DELAY = 3

local function collectPage()
  local n = GetNumAuctionItems("list")
  for i = 1, n do
    local name, _, count, _, _, _, _, _, _, buyout, _, _, _, owner, _, _, itemId =
      GetAuctionItemInfo("list", i)
    if itemId and buyout and buyout > 0 and count and count > 0 then
      local items = buffer[itemId]
      if not items then items = {}; buffer[itemId] = items end
      items[(owner or "?") .. ":" .. buyout .. ":" .. count] = { unit = buyout / count, qty = count }
    end
  end
end

function Scanner.flush()
  pending = false
  local now = time()
  local saved = 0
  for itemId, sigs in pairs(buffer) do
    local listings = {}
    for _, l in pairs(sigs) do listings[#listings + 1] = l end
    local summary = ns.Stats.summarize(listings)
    if summary then ns.History.add(DealHunterAHDB, itemId, summary, now); saved = saved + 1 end
  end
  buffer = {}
  if saved > 0 then print(("|cff66ccffDealHunterAH|r: zapisano ceny %d przedmiotów."):format(saved)) end
end

function Scanner.onListUpdate()
  collectPage()
  if not pending then
    pending = true
    C_Timer.After(FLUSH_DELAY, Scanner.flush)
  end
end
