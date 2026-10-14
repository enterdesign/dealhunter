local _, ns = ...
local Format = {}
ns.Format = Format

-- Miedź -> "12g 34s 56c" (ze znakiem minus dla strat).
function Format.money(c)
  if not c then return "?" end
  c = math.floor(c + 0.5)
  local sign = c < 0 and "-" or ""
  c = math.abs(c)
  return string.format("%s%dg %ds %dc", sign, math.floor(c / 10000), math.floor(c / 100) % 100, c % 100)
end

function Format.pct(x)
  if not x then return "-" end
  return string.format("%+.0f%%", x * 100)
end
