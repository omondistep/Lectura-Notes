@echo off
setlocal enabledelayedexpansion
REM ═══════════════════════════════════════════════════════════════════════════════
REM Lectura Installer for Windows
REM Installs as a standalone app with isolated Python venv
REM Supports: Web app (browser) and Electron desktop app (.exe)
REM ═══════════════════════════════════════════════════════════════════════════════

set APP_VERSION=2.0.0
set INSTALL_DIR=%LOCALAPPDATA%\Lectura
set DESKTOP=%USERPROFILE%\Desktop
set STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura

echo.
echo ================================================
echo       Lectura Installer for Windows v%APP_VERSION%
echo ================================================
echo.

REM ── Check Python ────────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3 is required but not installed.
    echo.
    echo   Download from: https://www.python.org/downloads/
    echo   IMPORTANT: Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PYTHON_VER=%%v
echo [OK] %PYTHON_VER% found

REM ── Select install mode ─────────────────────────────────────────────────────
echo.
echo Select installation mode:
echo   1) Web App      - Runs in your browser (lightweight)
echo   2) Desktop App  - Electron desktop app with .exe (requires Node.js)
echo.
set /p MODE_CHOICE="Choose [1/2] (default: 1): "
if "%MODE_CHOICE%"=="" set MODE_CHOICE=1

set INSTALL_MODE=web
if "%MODE_CHOICE%"=="2" (
    where node >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Node.js is required for Desktop App mode.
        echo   Download from: https://nodejs.org/
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('node -v 2^>^&1') do echo [OK] Node.js %%v found
    set INSTALL_MODE=electron
)

REM ── Copy files ──────────────────────────────────────────────────────────────
echo.
echo [*] Installing to: %INSTALL_DIR%

if exist "%INSTALL_DIR%" (
    echo [!] Existing installation found, updating...
    rmdir /s /q "%INSTALL_DIR%"
)

mkdir "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%\static"
mkdir "%INSTALL_DIR%\build"
mkdir "%INSTALL_DIR%\notes"

echo [*] Copying files...
set SOURCE_DIR=%~dp0

copy /Y "%SOURCE_DIR%main.py" "%INSTALL_DIR%\" >nul
copy /Y "%SOURCE_DIR%lectura-launcher.py" "%INSTALL_DIR%\" >nul
copy /Y "%SOURCE_DIR%requirements.txt" "%INSTALL_DIR%\" >nul
copy /Y "%SOURCE_DIR%cobalt.css" "%INSTALL_DIR%\" >nul 2>nul

xcopy /E /I /Y /Q "%SOURCE_DIR%static" "%INSTALL_DIR%\static" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%build" "%INSTALL_DIR%\build" >nul

if exist "%SOURCE_DIR%config.json" copy /Y "%SOURCE_DIR%config.json" "%INSTALL_DIR%\" >nul

if "%INSTALL_MODE%"=="electron" (
    copy /Y "%SOURCE_DIR%electron-main.js" "%INSTALL_DIR%\" >nul
    copy /Y "%SOURCE_DIR%package.json" "%INSTALL_DIR%\" >nul
)

echo [OK] Files copied

REM ── Setup Python venv ───────────────────────────────────────────────────────
echo [*] Setting up Python virtual environment...
cd /d "%INSTALL_DIR%"
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt
call deactivate

echo [OK] Python dependencies installed

REM ── Setup Electron (if selected) ────────────────────────────────────────────
if "%INSTALL_MODE%"=="electron" (
    echo [*] Installing Electron dependencies...
    cd /d "%INSTALL_DIR%"
    call npm install --silent 2>nul
    echo [OK] Electron installed
)

REM ── Create launcher scripts ─────────────────────────────────────────────────
if "%INSTALL_MODE%"=="electron" (
    REM Electron launcher batch
    (
        echo @echo off
        echo cd /d "%%LOCALAPPDATA%%\Lectura"
        echo call npm start
    ) > "%INSTALL_DIR%\Lectura.bat"
) else (
    REM Web app launcher batch
    (
        echo @echo off
        echo cd /d "%%LOCALAPPDATA%%\Lectura"
        echo call venv\Scripts\activate.bat
        echo pythonw lectura-launcher.py
    ) > "%INSTALL_DIR%\Lectura.bat"
)

REM VBS wrapper to hide console window
(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.Run chr^(34^) ^& "%INSTALL_DIR%\Lectura.bat" ^& chr^(34^), 0
    echo Set WshShell = Nothing
) > "%INSTALL_DIR%\Lectura.vbs"

echo [OK] Launcher created

REM ── Create desktop shortcut ─────────────────────────────────────────────────
echo [*] Creating shortcuts...

(
    echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
    echo sLinkFile = oWS.SpecialFolders^("Desktop"^) ^& "\Lectura.lnk"
    echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
    echo oLink.TargetPath = "%INSTALL_DIR%\Lectura.vbs"
    echo oLink.WorkingDirectory = "%INSTALL_DIR%"
    echo oLink.Description = "Lectura - Markdown Note-Taking App"
    echo oLink.IconLocation = "%INSTALL_DIR%\build\icon.ico"
    echo oLink.Save
) > "%TEMP%\CreateShortcut.vbs"
cscript /nologo "%TEMP%\CreateShortcut.vbs"
del "%TEMP%\CreateShortcut.vbs"

REM Start Menu shortcut
if not exist "%STARTMENU%" mkdir "%STARTMENU%"
copy /Y "%DESKTOP%\Lectura.lnk" "%STARTMENU%\Lectura.lnk" >nul

echo [OK] Shortcuts created

REM ── Build .exe (Electron mode) ─────────────────────────────────────────────
if "%INSTALL_MODE%"=="electron" (
    echo.
    set /p BUILD_CHOICE="Build distributable .exe installer now? [y/N]: "
    if /i "!BUILD_CHOICE!"=="y" (
        echo [*] Building Windows .exe installer...
        cd /d "%INSTALL_DIR%"
        call npm run build-win
        echo [OK] .exe installer built in: %INSTALL_DIR%\dist\
        echo.
        echo   Look for "Lectura Setup*.exe" in the dist folder.
        echo   You can distribute this .exe to install Lectura on any Windows PC.
    )
)

REM ── Summary ─────────────────────────────────────────────────────────────────
echo.
echo ================================================
echo          Installation complete!
echo ================================================
echo.
echo   Launch:    Double-click "Lectura" on Desktop
echo   Or:        Search "Lectura" in Start Menu
echo.
echo   Uninstall:
echo     1. Delete: %INSTALL_DIR%
echo     2. Delete: Desktop shortcut
echo     3. Delete: %STARTMENU%
echo.
pause
