local _, ns = ...
local History = {}
ns.History = History

History.MAX_POINTS = 60
History.MIN_GAP = 3600 -- skany w odstępie < 1 h nadpisują ostatni punkt

-- db.items[itemId] = { history = { {t, low, median, avg, qty}, ... } }
function History.add(db, itemId, summary, t)
  db.items = db.items or {}
  local item = db.items[itemId]
  if not item then item = { history = {} }; db.items[itemId] = item end
  local h = item.history
  local point = { t = t, low = summary.low, median = summary.median, avg = summary.avg, qty = summary.qty }
  if #h > 0 and t - h[#h].t < History.MIN_GAP then
    h[#h] = point
  else
    h[#h + 1] = point
  end
  while #h > History.MAX_POINTS do table.remove(h, 1) end
  return point
end

function History.latest(db, itemId)
  local item = db.items and db.items[itemId]
  if item and #item.history > 0 then return item.history[#item.history] end
end
