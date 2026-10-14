local _, ns = ...

-- Kontekst cenowy dla silnika wyceny. Wszystkie wywołania API gry są chronione (pcall),
-- bo nazwy i sygnatury trzeba potwierdzić na kliencie TBC Anniversary.
function ns.MakeContext()
  local db = DealHunterAHDB
  local ctx = {}

  function ctx.ahPrice(itemId, mode)
    local p = ns.History.latest(db, itemId)
    if p and p[mode] then return p[mode] end
    -- zapasowo: najniższa cena z Auctionatora (jeśli zainstalowany)
    if mode == "low" and Auctionator and Auctionator.API and Auctionator.API.v1 then
      local ok, price = pcall(Auctionator.API.v1.GetAuctionPriceByItemID, "DealHunterAH", itemId)
      if ok and price then return price end
    end
  end

  function ctx.vendorSell(itemId)
    local _, _, _, _, _, _, _, _, _, _, sell = GetItemInfo(itemId)
    return sell
  end

  function ctx.vendorBuy(itemId)
    return ns.Data and ns.Data.vendorBuy and ns.Data.vendorBuy[itemId]
  end

  function ctx.disenchant(itemId)
    if not (ns.Data and ns.Data.disenchantOutcomes) then return nil end
    local _, _, quality, ilvl, _, class = GetItemInfo(itemId)
    if not quality then return nil end
    return ns.Data.disenchantOutcomes(quality, ilvl, class)
  end

  return ctx
end
