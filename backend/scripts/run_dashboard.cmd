@echo off
setlocal

set "LOCAL_PY=%~dp0..\..\.tools\python-3.12.8-embed-amd64\python.exe"
set "LOCAL_PY_FALLBACK=%~dp0..\..\python-3.12.8-embed-amd64\python.exe"

if exist "%LOCAL_PY%" (
  "%LOCAL_PY%" "%~dp0machine_sim_dashboard.py" %*
  exit /b %ERRORLEVEL%
)

if exist "%LOCAL_PY_FALLBACK%" (
  "%LOCAL_PY_FALLBACK%" "%~dp0machine_sim_dashboard.py" %*
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py "%~dp0machine_sim_dashboard.py" %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python "%~dp0machine_sim_dashboard.py" %*
  exit /b %ERRORLEVEL%
)

echo Python 3.11+ is required to run the MMS simulator dashboard.
exit /b 1
