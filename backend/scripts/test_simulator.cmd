@echo off
setlocal

set "LOCAL_PY=..\.tools\python-3.12.8-embed-amd64\python.exe"

if exist "%LOCAL_PY%" (
  "%LOCAL_PY%" "%~dp0test_simulator_core.py" %*
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py "%~dp0test_simulator_core.py" %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python "%~dp0test_simulator_core.py" %*
  exit /b %ERRORLEVEL%
)

echo Python 3.11+ is required to test the MMS simulator.
exit /b 1
