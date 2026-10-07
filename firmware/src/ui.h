#pragma once
#include "protocol.h"
using KeyCb = void (*)(char key);
void ui_init(KeyCb onKey);
void ui_update(const proto::State& st);  // call from the LVGL thread / main loop
