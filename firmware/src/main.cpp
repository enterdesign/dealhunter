#include <Arduino.h>
#include <USB.h>
#include <USBHIDKeyboard.h>
#include <lvgl.h>
#include "board.h"
#include "protocol.h"
#include "ui.h"

static USBHIDKeyboard Keyboard;
static proto::State g_state;
static char g_line[96];
static size_t g_len;

static void sendKey(char k) { Keyboard.write(k); }

// SimHub Custom Serial output arrives on the CDC serial port, one line per message.
static void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      g_line[g_len] = '\0';
      if (g_len) proto::parseLine(g_line, g_state);
      g_len = 0;
    } else if (g_len < sizeof g_line - 1) {
      g_line[g_len++] = c;
    } else {
      g_len = 0;  // overlong line: drop
    }
  }
}

void setup() {
  Serial.begin(115200);
  Keyboard.begin();
  USB.begin();
  board_init();
  ui_init(sendKey);
}

void loop() {
  pollSerial();
  static uint32_t last;
  if (millis() - last >= 33) {  // ~30 fps UI refresh
    last = millis();
    ui_update(g_state);
  }
  lv_timer_handler();
  delay(2);
}
