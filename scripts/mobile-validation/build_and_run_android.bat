@echo off
REM Double-clickable wrapper for build_and_run_android.ps1.
REM Builds MagicHat debug APK, installs + launches on attached device/emulator.

setlocal EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"

set "PS_EXE="
where pwsh >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh"
if not defined PS_EXE (
    where powershell >nul 2>nul
    if not errorlevel 1 set "PS_EXE=powershell"
)

if not defined PS_EXE (
    echo [deploy] Neither pwsh nor powershell found on PATH.
    exit /b 1
)

echo [deploy] Using !PS_EXE!
"!PS_EXE!" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build_and_run_android.ps1" %*

set "EXITCODE=%ERRORLEVEL%"
echo.
echo [deploy] Exit code: %EXITCODE%
echo Press any key to close...
pause >nul
exit /b %EXITCODE%
