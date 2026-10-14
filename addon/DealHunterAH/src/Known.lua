local _, ns = ...
local Known = {}
ns.Known = Known

-- Zapamiętuje receptury znane postaci z OTWARTEGO okna profesji (tradeskill) albo enchantingu (craft).
-- Skan uruchamia użytkownik (przycisk w oknie profesji albo /dhah recipes), nie dzieje się sam przy każdym otwarciu.
-- DealHunterAHDB.known[nazwaProfesji][recipeId] = true; identyfikator to numer czaru z linku receptury.
-- Zbiory kumulują się (suma), więc nic nie ginie, gdy okno pokazuje tylko część listy (zwinięte kategorie, filtry).

local function recipeId(link)
  if not link then return nil end
  return tonumber(link:match("enchant:(%d+)") or link:match("spell:(%d+)"))
end

-- Dodaje receptury z `ids` do zapisanych dla profesji; zwraca: liczbę NOWYCH, nazwę profesji, łączną liczbę zapisanych.
function Known.merge(profession, ids)
  if not profession or profession == "" or profession == "UNKNOWN" then return 0 end
  local db = DealHunterAHDB
  db.known = db.known or {}
  local set = db.known[profession]
  if not set then set = {}; db.known[profession] = set end
  local added = 0
  for _, id in ipairs(ids) do
    if not set[id] then set[id] = true; added = added + 1 end
  end
  local total = 0
  for _ in pairs(set) do total = total + 1 end
  return added, profession, total
end

function Known.scanTradeSkill()
  if not (GetTradeSkillLine and GetNumTradeSkills and GetTradeSkillInfo and GetTradeSkillRecipeLink) then return 0 end
  local ids = {}
  for i = 1, GetNumTradeSkills() do
    local _, kind = GetTradeSkillInfo(i)
    if kind ~= "header" then
      local id = recipeId(GetTradeSkillRecipeLink(i))
      if id then ids[#ids + 1] = id end
    end
  end
  return Known.merge(GetTradeSkillLine(), ids)
end

-- Enchanting w TBC używa osobnego okna "craft".
function Known.scanCraft()
  if not (GetCraftDisplaySkillLine and GetNumCrafts and GetCraftInfo and GetCraftRecipeLink) then return 0 end
  local ids = {}
  for i = 1, GetNumCrafts() do
    local _, _, kind = GetCraftInfo(i)
    if kind ~= "header" then
      local id = recipeId(GetCraftRecipeLink(i))
      if id then ids[#ids + 1] = id end
    end
  end
  return Known.merge(GetCraftDisplaySkillLine(), ids)
end

function Known.count()
  local total, perProfession = 0, {}
  for prof, set in pairs(DealHunterAHDB.known or {}) do
    local n = 0
    for _ in pairs(set) do n = n + 1 end
    perProfession[prof] = n
    total = total + n
  end
  return total, perProfession
end
