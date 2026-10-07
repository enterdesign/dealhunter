// Three swipeable pages: 0 = dashboard, 1 = standings, 2 = buttons.
// Needs LV_FONT_MONTSERRAT_48 / 28 / 20 enabled in lv_conf.h.
#include "ui.h"
#include <lvgl.h>
#include <stdio.h>
#include "buttons.h"

static KeyCb g_onKey;
static lv_obj_t *lblSpeed, *lblGear, *lblRpm, *barRpm, *lblFuel, *lblLap, *lblPos;
static lv_obj_t* rows[proto::kRows];

static void onBtn(lv_event_t* e) {
  if (g_onKey) g_onKey((char)(intptr_t)lv_event_get_user_data(e));
}

static lv_obj_t* label(lv_obj_t* parent, const lv_font_t* font, lv_align_t al, int x, int y) {
  lv_obj_t* l = lv_label_create(parent);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_align(l, al, x, y);
  lv_label_set_text(l, "-");
  return l;
}

void ui_init(KeyCb onKey) {
  g_onKey = onKey;
  lv_obj_t* scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
  lv_obj_set_style_text_color(scr, lv_color_white(), 0);

  lv_obj_t* tv = lv_tileview_create(scr);
  lv_obj_t* t0 = lv_tileview_add_tile(tv, 0, 0, LV_DIR_RIGHT);
  lv_obj_t* t1 = lv_tileview_add_tile(tv, 1, 0, LV_DIR_LEFT | LV_DIR_RIGHT);
  lv_obj_t* t2 = lv_tileview_add_tile(tv, 2, 0, LV_DIR_LEFT);

  // Dashboard
  barRpm = lv_bar_create(t0);
  lv_obj_set_size(barRpm, lv_pct(92), 40);
  lv_obj_align(barRpm, LV_ALIGN_TOP_MID, 0, 20);
  lblRpm = label(t0, &lv_font_montserrat_28, LV_ALIGN_TOP_MID, 0, 70);
  lblGear = label(t0, &lv_font_montserrat_48, LV_ALIGN_CENTER, 0, -10);
  lblSpeed = label(t0, &lv_font_montserrat_48, LV_ALIGN_BOTTOM_MID, 0, -90);
  lblFuel = label(t0, &lv_font_montserrat_28, LV_ALIGN_BOTTOM_LEFT, 20, -20);
  lblLap = label(t0, &lv_font_montserrat_28, LV_ALIGN_BOTTOM_MID, 0, -20);
  lblPos = label(t0, &lv_font_montserrat_28, LV_ALIGN_BOTTOM_RIGHT, -20, -20);

  // Standings
  for (int i = 0; i < proto::kRows; i++)
    rows[i] = label(t1, &lv_font_montserrat_28, LV_ALIGN_TOP_LEFT, 30, 20 + i * 68);

  // Buttons: 4 columns x 3 rows
  for (int i = 0; i < kButtonCount; i++) {
    lv_obj_t* b = lv_btn_create(t2);
    lv_obj_set_size(b, 230, 150);
    lv_obj_align(b, LV_ALIGN_TOP_LEFT, 20 + (i % 4) * 250, 20 + (i / 4) * 175);
    lv_obj_add_event_cb(b, onBtn, LV_EVENT_CLICKED, (void*)(intptr_t)kButtons[i].key);
    lv_obj_t* l = lv_label_create(b);
    lv_label_set_text(l, kButtons[i].label);
    lv_obj_set_style_text_font(l, &lv_font_montserrat_28, 0);
    lv_obj_center(l);
  }
}

void ui_update(const proto::State& st) {
  const auto& t = st.t;
  char b[48];
  snprintf(b, sizeof b, "%d km/h", t.speed);  lv_label_set_text(lblSpeed, b);
  snprintf(b, sizeof b, "%d rpm", t.rpm);     lv_label_set_text(lblRpm, b);
  snprintf(b, sizeof b, "Fuel %d%%", t.fuelPct); lv_label_set_text(lblFuel, b);
  snprintf(b, sizeof b, "Lap %d", t.lap);     lv_label_set_text(lblLap, b);
  snprintf(b, sizeof b, "P%d/%d", t.pos, t.cars); lv_label_set_text(lblPos, b);
  lv_label_set_text(lblGear, t.gear < 0 ? "R" : t.gear == 0 ? "N" : (snprintf(b, sizeof b, "%d", t.gear), b));
  lv_bar_set_range(barRpm, 0, t.rpmMax > 0 ? t.rpmMax : 8000);
  lv_bar_set_value(barRpm, t.rpm, LV_ANIM_OFF);
  for (int i = 0; i < proto::kRows; i++) {
    snprintf(b, sizeof b, "%2d  %-20s %s", st.rows[i].pos, st.rows[i].name, st.rows[i].gap);
    lv_label_set_text(rows[i], b);
  }
}
