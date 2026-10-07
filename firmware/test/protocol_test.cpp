// g++ -std=c++17 -I../src protocol_test.cpp -o /tmp/ptest && /tmp/ptest
#include <cassert>
#include <cstdio>
#include "protocol.h"
using namespace proto;

int main() {
  State s;
  assert(parseLine("D;212;7450;8200;4;63;5;3;22", s) == Kind::Telemetry);
  assert(s.t.speed == 212 && s.t.rpm == 7450 && s.t.rpmMax == 8200 && s.t.gear == 4);
  assert(s.t.fuelPct == 63 && s.t.lap == 5 && s.t.pos == 3 && s.t.cars == 22);
  assert(parseLine("D;0;900;8200;N;63;1;3;22", s) == Kind::Telemetry && s.t.gear == 0);
  assert(parseLine("D;5;1500;8200;R;63;1;3;22", s) == Kind::Telemetry && s.t.gear == -1);
  assert(parseLine("S;1;2;M. Verstappen;+1.234", s) == Kind::Standing);
  assert(s.rows[1].pos == 2 && !strcmp(s.rows[1].name, "M. Verstappen") && !strcmp(s.rows[1].gap, "+1.234"));
  assert(parseLine("S;8;1;X;0", s) == Kind::Error);   // idx out of range
  assert(parseLine("D;1;2;3", s) == Kind::Error);     // too few fields
  assert(parseLine("hello", s) == Kind::Ignored);
  assert(parseLine("", s) == Kind::Ignored);
  char big[200]; memset(big, 'A', 199); big[199] = 0;
  assert(parseLine(big, s) == Kind::Error);
  puts("protocol OK");
}
