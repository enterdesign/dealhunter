local _, ns = ...
local V = {}
ns.Valuation = V

-- ctx:
--   vendorSell(itemId) -> miedź | nil
--   ahPrice(itemId, mode) -> miedź | nil     (mode: "low" | "median" | "avg")
--   disenchant(itemId) -> { {item=, qty=, chance=}, ... } | nil
-- opts: sellMode ("median"), feeOpts (patrz Fees.net)
-- Zwraca { vendor, ah (netto), ahGross, disenchant (netto), deIncomplete, best, value } albo nil.
function V.itemValue(itemId, ctx, opts)
  opts = opts or {}
  local mode = opts.sellMode or "median"
  local fee = {}
  for k, v in pairs(opts.feeOpts or {}) do fee[k] = v end

  local out = {}
  local vendor = ctx.vendorSell(itemId)
  if vendor and vendor > 0 then out.vendor = vendor end

  fee.itemId = itemId
  local gross = ctx.ahPrice(itemId, mode)
  if gross then
    out.ahGross = gross
    out.ah = ns.Fees.net(gross, fee)
  end

  local de = ctx.disenchant and ctx.disenchant(itemId)
  if de then
    local total, incomplete = 0, false
    for _, o in ipairs(de) do
      local p = ctx.ahPrice(o.item, mode)
      if p then
        fee.itemId = o.item
        total = total + o.chance * o.qty * ns.Fees.net(p, fee)
      else
        incomplete = true
      end
    end
    out.disenchant = total
    out.deIncomplete = incomplete or nil
  end

  local best, value
  for _, name in ipairs({ "vendor", "ah", "disenchant" }) do
    local v = out[name]
    if v and (not value or v > value) then best, value = name, v end
  end
  if not best then return nil end
  out.best, out.value = best, value
  return out
end
