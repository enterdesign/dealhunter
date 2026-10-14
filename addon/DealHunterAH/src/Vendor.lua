local ADDON, ns = ...

-- Ceny u kupców odczytane z klienta gry (prawda dla danej wersji, w przeciwieństwie do danych z sieci):
--   sell[itemId] = cena sprzedaży kupcowi (miedź, 0 = nie da się sprzedać) - z GetItemInfo,
--   buy[itemId]  = cena kupna za sztukę (miedź) - z okna kupca, tylko towar bez limitu i za same pieniądze.
local Vendor = {}
ns.Vendor = Vendor

local pending = {}

local function store()
  local db = DealHunterAHDB
  db.vendor = db.vendor or {}
  db.vendor.sell = db.vendor.sell or {}
  db.vendor.buy = db.vendor.buy or {}
  return db.vendor
end

local function itemInfo(id)
  local fn = GetItemInfo or (C_Item and C_Item.GetItemInfo)
  if not fn then return nil end
  return select(11, fn(id))
end

-- Zwraca true, gdy cena jest już znana (zapisana); w przeciwnym razie prosi klienta o dane przedmiotu.
function Vendor.recordSell(id)
  local price = itemInfo(id)
  if price ~= nil then
    store().sell[id] = price
    pending[id] = nil
    return true
  end
  pending[id] = true
  if C_Item and C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, id) end
  return false
end

function Vendor.onItemInfo(id)
  if pending[id] then Vendor.recordSell(id) end
end

-- Przegląda przedmioty z zapisanych skanów AH; zwraca (znane, oczekujące).
function Vendor.sweep()
  local known, waiting = 0, 0
  for id in pairs(DealHunterAHDB.items or {}) do
    if Vendor.recordSell(id) then known = known + 1 else waiting = waiting + 1 end
  end
  return known, waiting
end

local function idFromLink(link)
  return link and tonumber(link:match("item:(%d+)"))
end

-- Okno kupca: zapisuje cenę sztuki towaru bez limitu zapasu i bez kosztu w innej walucie.
function Vendor.scanMerchant()
  if not (GetMerchantNumItems and GetMerchantItemInfo and GetMerchantItemLink) then return 0 end
  local saved = 0
  for i = 1, GetMerchantNumItems() do
    local _, _, price, quantity, available = GetMerchantItemInfo(i)
    local id = idFromLink(GetMerchantItemLink(i))
    local extended = GetMerchantItemCostInfo and GetMerchantItemCostInfo(i) or 0
    if id and price and price > 0 and available == -1 and (extended or 0) == 0 then
      store().buy[id] = price / math.max(1, quantity or 1)
      saved = saved + 1
    end
  end
  return saved
end

function Vendor.count()
  local s, b = 0, 0
  local db = DealHunterAHDB.vendor
  if db then
    for _ in pairs(db.sell or {}) do s = s + 1 end
    for _ in pairs(db.buy or {}) do b = b + 1 end
  end
  return s, b
end
