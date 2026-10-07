@echo off
cd /d "%~dp0"
if not exist holdem\holdem.exe (
  echo holdem\holdem.exe not found.
  pause
  goto :eof
)
if not exist strategies\6max_20bb_lite.bin (
  echo strategies\6max_20bb_lite.bin not found. Train it first: START_GUI.bat, preset "6-max 20 bb - lite", output file strategies\6max_20bb_lite.bin
  pause
  goto :eof
)
holdem\holdem.exe play strategies\6max_20bb_lite.bin
pause
