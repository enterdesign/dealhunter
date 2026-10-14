local _, ns = ...
local Fees = {}
ns.Fees = Fees

-- UWAGA: wartości domyślne do potwierdzenia w grze na TBC Anniversary.
Fees.CUT = { faction = 0.05, neutral = 0.15 }

-- opts: ahType ("faction"|"neutral"), cutOverrides[itemId], itemId, deposit (miedź, stała kwota)
function Fees.cutRate(opts)
  opts = opts or {}
  if opts.itemId and opts.cutOverrides and opts.cutOverrides[opts.itemId] then
    return opts.cutOverrides[opts.itemId]
  end
  return Fees.CUT[opts.ahType or "faction"]
end

-- Ile zostaje po sprzedaży za `price` (miedź).
function Fees.net(price, opts)
  local net = price * (1 - Fees.cutRate(opts))
  if opts and opts.deposit then net = net - opts.deposit end
  return net
end
