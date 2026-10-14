local _, ns = ...
local Known = {}
ns.Known = Known

-- Zapamiętuje receptury znane postaci, gdy otwierasz okno profesji.
-- DealHunterAHDB.known[nazwaProfesji][recipeId] = true. Id to numer czaru z linku receptury.
-- UWAGA: format linku (enchant:ID / spell:ID) do potwierdzenia na kliencie TBC Anniversary.
function Known.scan()
  if not (GetTradeSkillLine and GetNumTradeSkills and GetTradeSkillRecipeLink) then return end
  local prof = GetTradeSkillLine()
  if not prof or prof == "UNKNOWN" then return end
  local db = DealHunterAHDB
  db.known = db.known or {}
  local set = {}
  for i = 1, GetNumTradeSkills() do
    local _, kind = GetTradeSkillInfo(i)
    if kind ~= "header" then
      local link = GetTradeSkillRecipeLink(i)
      local id = link and tonumber(link:match("enchant:(%d+)") or link:match("spell:(%d+)"))
      if id then set[id] = true end
    end
  end
  db.known[prof] = set
end

-- Zbiór wszystkich znanych receptur (sumuje profesje).
function Known.all()
  local all = {}
  for _, set in pairs(DealHunterAHDB.known or {}) do
    for id in pairs(set) do all[id] = true end
  end
  return all
end
