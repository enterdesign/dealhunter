@echo off
cd /d "%~dp0"
if not exist holdem\holdem.exe (
  echo holdem\holdem.exe not found.
  pause
  goto :eof
)
holdem\holdem.exe play strategies\hu_20bb.bin
pause
