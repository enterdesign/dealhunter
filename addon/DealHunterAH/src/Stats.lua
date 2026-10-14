local _, ns = ...
local Stats = {}
ns.Stats = Stats

-- listings: { {unit = copper za sztukę, qty = ilość}, ... }
-- Zwraca low / median (ważona ilością) / avg (ważona ilością) / qty / n albo nil.
function Stats.summarize(listings)
  local rows, total, sum = {}, 0, 0
  for _, l in ipairs(listings) do
    if l.unit and l.unit > 0 and l.qty and l.qty > 0 then
      rows[#rows + 1] = l
      total = total + l.qty
      sum = sum + l.unit * l.qty
    end
  end
  if total == 0 then return nil end
  table.sort(rows, function(a, b) return a.unit < b.unit end)
  local half, acc, median = total / 2, 0, rows[#rows].unit
  for _, r in ipairs(rows) do
    acc = acc + r.qty
    if acc >= half then median = r.unit; break end
  end
  return { low = rows[1].unit, median = median, avg = sum / total, qty = total, n = #rows }
end

-- history: tablica {t, low, median, avg} rosnąco po t.
-- Porównuje ostatni punkt ze średnią wcześniejszych punktów z okna `days`.
-- opts: days (7), flat (0.05 = próg "bez zmian"), field ("median").
function Stats.trend(history, opts)
  opts = opts or {}
  local days, flat, field = opts.days or 7, opts.flat or 0.05, opts.field or "median"
  if #history == 0 then return nil end
  local cutoff = history[#history].t - days * 86400
  local pts = {}
  for _, h in ipairs(history) do
    if h.t >= cutoff and h[field] then pts[#pts + 1] = h end
  end
  if #pts < 3 then return nil end

  local base = 0
  for i = 1, #pts - 1 do base = base + pts[i][field] end
  base = base / (#pts - 1)
  local current = pts[#pts][field]
  local change = current / base - 1

  -- nachylenie regresji liniowej jako ułamek bazy na dobę
  local t0, sx, sy, sxx, sxy = pts[1].t, 0, 0, 0, 0
  for _, p in ipairs(pts) do
    local x = (p.t - t0) / 86400
    sx, sy, sxx, sxy = sx + x, sy + p[field], sxx + x * x, sxy + x * p[field]
  end
  local n, den = #pts, #pts * sxx - sx * sx
  local slope = den ~= 0 and ((n * sxy - sx * sy) / den) / base or 0

  local dir = "flat"
  if change > flat then dir = "up" elseif change < -flat then dir = "down" end
  return { change = change, slope = slope, dir = dir, baseline = base, current = current, points = n }
end
