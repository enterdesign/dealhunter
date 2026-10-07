// Touch buttons on page 3. `key` is sent as a USB HID key press (map the same keys in the game / SimHub).
#pragma once
struct ButtonDef { const char* label; char key; };

constexpr ButtonDef kButtons[] = {
  {"Pit request", 'p'}, {"Flash", 'f'},   {"Radio", 'r'},    {"Wipers", 'w'},
  {"TC +", '1'},        {"TC -", '2'},    {"ABS +", '3'},    {"ABS -", '4'},
  {"Brake bias +", '5'},{"Brake bias -", '6'}, {"Fuel mix +", '7'}, {"Fuel mix -", '8'},
};
constexpr int kButtonCount = sizeof(kButtons) / sizeof(kButtons[0]);
