local _, ns = ...
local UI = {}
ns.UI = UI

local ROWS, ROW_H = 14, 20
local COLS = {
  { key = "name",   label = "Receptura", x = 8,   w = 190 },
  { key = "cost",   label = "Koszt",     x = 200, w = 90, sort = "cost" },
  { key = "value",  label = "Wartość",   x = 292, w = 90, sort = "value" },
  { key = "profit", label = "Zysk",      x = 384, w = 100, sort = "profit" },
  { key = "roi",    label = "ROI",       x = 486, w = 50, sort = "roi" },
  { key = "use",    label = "Jak",       x = 538, w = 70 },
}
local USE_LABEL = { vendor = "kupiec", ah = "AH", disenchant = "rozbiór" }

local state = { profession = nil, knownOnly = false, incomplete = false, sortBy = "profit", results = {} }
local frame

local function profList()
  local seen, list = {}, {}
  for _, r in ipairs((ns.Data and ns.Data.recipes) or {}) do
    if r.profession and not seen[r.profession] then seen[r.profession] = true; list[#list + 1] = r.profession end
  end
  table.sort(list)
  return list
end

function UI.refresh()
  if not frame then return end
  local recipes = ns.Data and ns.Data.recipes
  if not recipes then
    state.results = {}
    frame.status:SetText("Brak danych receptur (Data\\Recipes.lua nie wygenerowany).")
  else
    state.results = ns.Recipes.rank(recipes, ns.MakeContext(), {
      profession = state.profession, known = ns.Known.all(), knownOnly = state.knownOnly,
      includeIncomplete = state.incomplete, sortBy = state.sortBy,
      feeOpts = { ahType = DealHunterAHDB.ahType },
    })
    frame.status:SetText(string.format("%d receptur  |  sortuj: %s", #state.results, state.sortBy))
  end
  UI.update()
end

function UI.update()
  local scroll = frame.scroll
  FauxScrollFrame_Update(scroll, #state.results, ROWS, ROW_H)
  local offset = FauxScrollFrame_GetOffset(scroll)
  for i = 1, ROWS do
    local row, r = frame.rows[i], state.results[offset + i]
    if r then
      local F = ns.Format
      local name = r.recipe.name .. (r.known and "" or " |cff888888[?]|r")
      if not r.complete then name = name .. " |cffff8800*|r" end
      row.cells.name:SetText(name)
      row.cells.cost:SetText(F.money(r.cost))
      row.cells.value:SetText(F.money(r.value))
      local color = (r.profit or 0) >= 0 and "|cff55ff55" or "|cffff5555"
      row.cells.profit:SetText(color .. F.money(r.profit) .. "|r")
      row.cells.roi:SetText(F.pct(r.roi))
      row.cells.use:SetText(USE_LABEL[r.use] or "")
      row.result = r
      row:Show()
    else
      row.result = nil
      row:Hide()
    end
  end
end

local function showTooltip(row)
  local r = row.result
  if not r then return end
  local F = ns.Format
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  GameTooltip:AddLine(r.recipe.name, 1, 1, 1)
  if r.recipe.skill then GameTooltip:AddLine("Wymagana umiejętność: " .. r.recipe.skill, 0.8, 0.8, 0.8) end
  if r.recipe.source then GameTooltip:AddLine("Źródło: " .. r.recipe.source, 0.8, 0.8, 0.8) end
  GameTooltip:AddLine(" ")
  GameTooltip:AddLine("Składniki:")
  for _, reagent in ipairs(r.recipe.reagents) do
    local name = GetItemInfo(reagent.item) or ("item " .. reagent.item)
    GameTooltip:AddDoubleLine(string.format("  %dx %s", reagent.count, name), "")
  end
  if #r.missing > 0 then
    GameTooltip:AddLine(string.format("Brak ceny dla %d składników - zrób skan AH.", #r.missing), 1, 0.5, 0)
  end
  local v = r.valueInfo
  if v then
    GameTooltip:AddLine(" ")
    GameTooltip:AddDoubleLine("Kupiec", F.money(v.vendor))
    GameTooltip:AddDoubleLine("AH", F.money(v.ah))
    GameTooltip:AddDoubleLine("Rozbiór", F.money(v.disenchant) .. (v.deIncomplete and " *" or ""))
    local item = DealHunterAHDB.items[r.recipe.produces]
    local tr = item and ns.Stats.trend(item.history)
    if tr then GameTooltip:AddDoubleLine("Trend 7 dni", string.format("%s (%s)", tr.dir, F.pct(tr.change))) end
  end
  GameTooltip:Show()
end

local function makeButton(parent, text, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 22); b:SetText(text); b:SetScript("OnClick", onClick)
  return b
end

local function makeCheck(parent, label, get, set)
  local c = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  c:SetSize(24, 24)
  c.label = c:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  c.label:SetPoint("LEFT", c, "RIGHT", 2, 1); c.label:SetText(label)
  c:SetScript("OnClick", function(self) set(self:GetChecked() and true or false); UI.refresh() end)
  c:SetChecked(get())
  return c
end

local function build()
  frame = CreateFrame("Frame", "DealHunterAHFrame", UIParent, "BasicFrameTemplateWithInset")
  frame:SetSize(630, 410); frame:SetPoint("CENTER")
  frame:SetMovable(true); frame:EnableMouse(true); frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  frame:SetFrameStrata("HIGH")
  frame.TitleText:SetText("DealHunter AH")
  tinsert(UISpecialFrames, "DealHunterAHFrame") -- Esc zamyka okno

  -- wybór profesji
  local dd = CreateFrame("Frame", "DealHunterAHProfDropdown", frame, "UIDropDownMenuTemplate")
  dd:SetPoint("TOPLEFT", 0, -28)
  UIDropDownMenu_SetWidth(dd, 130)
  UIDropDownMenu_Initialize(dd, function()
    local function add(label, value)
      local info = UIDropDownMenu_CreateInfo()
      info.text, info.checked = label, (state.profession == value)
      info.func = function() state.profession = value; UIDropDownMenu_SetText(dd, label); UI.refresh() end
      UIDropDownMenu_AddButton(info)
    end
    add("Wszystkie profesje", nil)
    for _, p in ipairs(profList()) do add(p, p) end
  end)
  UIDropDownMenu_SetText(dd, "Wszystkie profesje")

  local c1 = makeCheck(frame, "tylko znane", function() return state.knownOnly end, function(v) state.knownOnly = v end)
  c1:SetPoint("LEFT", dd, "RIGHT", -6, 2)
  local c2 = makeCheck(frame, "niekompletne", function() return state.incomplete end, function(v) state.incomplete = v end)
  c2:SetPoint("LEFT", c1, "RIGHT", 90, 0)
  makeButton(frame, "Odśwież", 70, UI.refresh):SetPoint("LEFT", c2, "RIGHT", 90, 0)

  -- nagłówki kolumn (klik = sortowanie)
  for _, col in ipairs(COLS) do
    local h = CreateFrame("Button", nil, frame)
    h:SetPoint("TOPLEFT", 12 + col.x, -64); h:SetSize(col.w, 16)
    h.text = h:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    h.text:SetAllPoints(); h.text:SetJustifyH("LEFT"); h.text:SetText(col.label)
    if col.sort then
      h:SetScript("OnClick", function() state.sortBy = col.sort; UI.refresh() end)
    end
  end

  -- lista
  frame.scroll = CreateFrame("ScrollFrame", "DealHunterAHScroll", frame, "FauxScrollFrameTemplate")
  frame.scroll:SetPoint("TOPLEFT", 10, -82); frame.scroll:SetSize(590, ROWS * ROW_H)
  frame.scroll:SetScript("OnVerticalScroll", function(self, offset)
    FauxScrollFrame_OnVerticalScroll(self, offset, ROW_H, UI.update)
  end)
  frame.rows = {}
  for i = 1, ROWS do
    local row = CreateFrame("Frame", nil, frame)
    row:SetSize(590, ROW_H); row:SetPoint("TOPLEFT", 12, -82 - (i - 1) * ROW_H)
    row:EnableMouse(true)
    row.cells = {}
    for _, col in ipairs(COLS) do
      local fs = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      fs:SetPoint("LEFT", col.x, 0); fs:SetWidth(col.w); fs:SetJustifyH("LEFT")
      row.cells[col.key] = fs
    end
    row:SetScript("OnEnter", showTooltip)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
    frame.rows[i] = row
  end

  frame.status = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  frame.status:SetPoint("BOTTOMLEFT", 14, 12)
  local legend = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  legend:SetPoint("BOTTOMRIGHT", -14, 12)
  legend:SetText("[?] nieznana receptura   * brak części cen")
end

function UI.toggle()
  if not frame then build() end
  if frame:IsShown() then frame:Hide() else frame:Show(); UI.refresh() end
end
