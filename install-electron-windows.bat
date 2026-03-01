@echo off
REM Lectura Electron App Installer for Windows

echo =========================================
echo   Lectura Desktop App Installer (Windows)
echo =========================================
echo.

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Node.js is required
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

REM Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Python is required
    echo Download: https://python.org/downloads/
    pause
    exit /b 1
)

set INSTALL_DIR=%LOCALAPPDATA%\Lectura-Electron

echo 📦 Installing to: %INSTALL_DIR%
echo.

REM Create directory
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%"

REM Copy files
echo 📋 Copying files...
xcopy /E /I /Y /Q . "%INSTALL_DIR%" >nul
cd /d "%INSTALL_DIR%"
if exist .git rmdir /s /q .git
if exist __pycache__ rmdir /s /q __pycache__

REM Install Node dependencies
echo 📥 Installing Electron...
call npm install --silent

REM Create Python virtual environment
echo 🐍 Setting up Python environment...
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt
call venv\Scripts\deactivate.bat

REM Create launcher batch file
echo @echo off > "%INSTALL_DIR%\Lectura-App.bat"
echo cd /d "%%LOCALAPPDATA%%\Lectura-Electron" >> "%INSTALL_DIR%\Lectura-App.bat"
echo npm start >> "%INSTALL_DIR%\Lectura-App.bat"

REM Create VBS launcher (no console window)
echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_DIR%\Lectura-App.vbs"
echo WshShell.Run chr(34) ^& "%INSTALL_DIR%\Lectura-App.bat" ^& chr(34), 0 >> "%INSTALL_DIR%\Lectura-App.vbs"
echo Set WshShell = Nothing >> "%INSTALL_DIR%\Lectura-App.vbs"

REM Create desktop shortcut
echo 🖥️  Creating shortcuts...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\CreateShortcut.vbs"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\Lectura Desktop.lnk" >> "%TEMP%\CreateShortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\CreateShortcut.vbs"
echo oLink.TargetPath = "%INSTALL_DIR%\Lectura-App.vbs" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.WorkingDirectory = "%INSTALL_DIR%" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Description = "Lectura Desktop App" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.IconLocation = "%%SystemRoot%%\System32\imageres.dll,14" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Save >> "%TEMP%\CreateShortcut.vbs"
cscript /nologo "%TEMP%\CreateShortcut.vbs"
del "%TEMP%\CreateShortcut.vbs"

REM Create Start Menu shortcut
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura"
copy "%USERPROFILE%\Desktop\Lectura Desktop.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura\Lectura Desktop.lnk" >nul

echo.
echo ✅ Installation complete!
echo.
echo 🚀 Launch Lectura Desktop App:
echo    • Double-click "Lectura Desktop" icon
echo    • Or search 'Lectura Desktop' in Start Menu
echo.
pause
