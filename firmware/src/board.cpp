// TODO(hardware): fill in once the board arrives.
// The 7B drives the RGB panel directly and uses a CH422G I/O expander for backlight/reset/touch-reset,
// so the pin map and init order matter. Use Waveshare's wiki demo for ESP32-S3-Touch-LCD-7B
// (ESP32_Display_Panel + lvgl port) as the reference and keep it in this file only:
// everything else (ui.cpp, main.cpp) only needs a ready-to-use LVGL display + touch input.
#include "board.h"
#include <lvgl.h>

void board_init() {
  lv_init();
  // 1. I2C + CH422G: backlight on, resets released
  // 2. esp_lcd RGB panel 1024x600, framebuffer in PSRAM
  // 3. GT911 touch (I2C) -> lv_indev_drv (pointer)
  // 4. lv_disp_drv_register(...), lv_tick via esp_timer
}
