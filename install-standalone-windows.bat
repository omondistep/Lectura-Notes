@echo off
REM Lectura Standalone Installer for Windows

echo ===================================
echo   Lectura Standalone Installer
echo ===================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Python is required
    echo Download: https://www.python.org/downloads/
    echo ⚠️  Check "Add Python to PATH" during install
    pause
    exit /b 1
)

set INSTALL_DIR=%LOCALAPPDATA%\Lectura

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
if exist venv rmdir /s /q venv
if exist __pycache__ rmdir /s /q __pycache__

REM Create virtual environment
echo 🐍 Setting up Python environment...
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

REM Create launcher batch file
echo @echo off > "%INSTALL_DIR%\Lectura.bat"
echo cd /d "%%LOCALAPPDATA%%\Lectura" >> "%INSTALL_DIR%\Lectura.bat"
echo call venv\Scripts\activate.bat >> "%INSTALL_DIR%\Lectura.bat"
echo pythonw lectura-launcher.py >> "%INSTALL_DIR%\Lectura.bat"

REM Create VBS launcher (no console window)
echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_DIR%\Lectura.vbs"
echo WshShell.Run chr(34) ^& "%INSTALL_DIR%\Lectura.bat" ^& chr(34), 0 >> "%INSTALL_DIR%\Lectura.vbs"
echo Set WshShell = Nothing >> "%INSTALL_DIR%\Lectura.vbs"

REM Create desktop shortcut
echo 🖥️  Creating shortcuts...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\CreateShortcut.vbs"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\Lectura.lnk" >> "%TEMP%\CreateShortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\CreateShortcut.vbs"
echo oLink.TargetPath = "%INSTALL_DIR%\Lectura.vbs" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.WorkingDirectory = "%INSTALL_DIR%" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Description = "Lectura - Markdown Note-Taking App" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.IconLocation = "%INSTALL_DIR%\build\icon.ico" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Save >> "%TEMP%\CreateShortcut.vbs"
cscript /nologo "%TEMP%\CreateShortcut.vbs"
del "%TEMP%\CreateShortcut.vbs"

REM Create Start Menu shortcut
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura"
copy "%USERPROFILE%\Desktop\Lectura.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura\Lectura.lnk" >nul

echo.
echo ✅ Installation complete!
echo.
echo 🚀 Launch Lectura:
echo    • Double-click Desktop icon
echo    • Or search 'Lectura' in Start Menu
echo.
pause
