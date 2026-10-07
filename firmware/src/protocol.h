// Line protocol PC (SimHub) -> ESP32. Pure C++, no Arduino deps, so it is unit-testable on a PC.
//
//   D;speed;rpm;rpmMax;gear;fuelPct;lap;pos;cars     telemetry (~30 Hz)
//   S;idx;pos;name;gap                                one standings row (idx 0..7, ~2 Hz)
//
// gear: -1/R = reverse, 0/N = neutral, 1.. = gear. Unknown lines are ignored.
#pragma once
#include <cstdlib>
#include <cstring>

namespace proto {

constexpr int kRows = 8;

struct Telemetry {
  int speed = 0, rpm = 0, rpmMax = 8000, gear = 0, fuelPct = 0, lap = 0, pos = 0, cars = 0;
};
struct Row {
  int pos = 0;
  char name[24] = "";
  char gap[12] = "";
};
struct State {
  Telemetry t;
  Row rows[kRows];
};
enum class Kind { Ignored, Telemetry, Standing, Error };

inline int parseGear(const char* s) {
  if (s[0] == 'R' || s[0] == 'r') return -1;
  if (s[0] == 'N' || s[0] == 'n') return 0;
  return atoi(s);
}

inline void copyStr(char* dst, size_t n, const char* src) {
  strncpy(dst, src, n - 1);
  dst[n - 1] = '\0';
}

// Parses one line (no trailing newline) into `st`.
inline Kind parseLine(const char* line, State& st) {
  char buf[96];
  if (strlen(line) >= sizeof(buf)) return Kind::Error;
  strcpy(buf, line);

  char* f[10];
  int n = 0;
  for (char* p = buf; n < 10;) {
    f[n++] = p;
    char* sep = strchr(p, ';');
    if (!sep) break;
    *sep = '\0';
    p = sep + 1;
  }

  if (!strcmp(f[0], "D")) {
    if (n != 9) return Kind::Error;
    Telemetry& t = st.t;
    t.speed = atoi(f[1]);
    t.rpm = atoi(f[2]);
    t.rpmMax = atoi(f[3]);
    t.gear = parseGear(f[4]);
    t.fuelPct = atoi(f[5]);
    t.lap = atoi(f[6]);
    t.pos = atoi(f[7]);
    t.cars = atoi(f[8]);
    return Kind::Telemetry;
  }
  if (!strcmp(f[0], "S")) {
    if (n != 5) return Kind::Error;
    int idx = atoi(f[1]);
    if (idx < 0 || idx >= kRows) return Kind::Error;
    st.rows[idx].pos = atoi(f[2]);
    copyStr(st.rows[idx].name, sizeof(st.rows[idx].name), f[3]);
    copyStr(st.rows[idx].gap, sizeof(st.rows[idx].gap), f[4]);
    return Kind::Standing;
  }
  return Kind::Ignored;
}

}  // namespace proto
