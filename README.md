# flightware -> sim dashboard

Touch dashboard for sim racing (AC, ACC, iRacing) on a **Waveshare ESP32-S3-Touch-LCD-7B** (7", 1024x600, capacitive touch),
fed by SimHub over USB. Swipe between pages:

1. **Dashboard**: speed, gear, RPM bar, fuel, lap, position
2. **Standings**: top 8
3. **Buttons**: touch buttons that send USB HID keys (pit, TC/ABS, brake bias, ...)

```
SimHub (PC) --USB serial lines--> ESP32-S3 --LVGL--> screen
                             <--USB HID keys-- touch buttons
```

## Status
- `firmware/src/protocol.h`: line protocol parser, **tested on PC** (`firmware/test/protocol_test.cpp`).
- `tools/simulator.py`: fake SimHub for developing without a sim running.
- `firmware/src/ui.cpp`, `main.cpp`: LVGL pages, serial reader and HID keys. **Not compiled or run yet.**
- `firmware/src/board.cpp`: **stub**. Panel/touch/backlight init must be copied from Waveshare's demo once the board is in hand.
- `docs/simhub-setup.md`: SimHub configuration (property names to be verified).

## Open questions (need the hardware)
- Is the board's USB-C the native ESP32-S3 USB? If not, serial and HID can't share one cable.
- Required `lv_conf.h` settings (fonts 28/48, memory in PSRAM).

## Hardware
Waveshare ESP32-S3-Touch-LCD-7B (Amazon.ie, 53.99 EUR), USB-C data cable, powered USB hub.
