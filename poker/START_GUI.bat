@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py gui.py & goto :eof)
where python >nul 2>nul && (python gui.py & goto :eof)
echo Python is not installed. Get it from https://www.python.org/downloads/ (tick "Add Python to PATH"), then run this file again.
pause
