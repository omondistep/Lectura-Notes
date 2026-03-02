@echo off
REM Lectura Installer for Windows

echo ===================================
echo   Lectura Installer for Windows
echo ===================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is required but not installed.
    echo Download from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

REM Install directory
set INSTALL_DIR=%LOCALAPPDATA%\Lectura

echo Installing to: %INSTALL_DIR%
echo.

REM Create directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM Copy files
echo Copying files...
xcopy /E /I /Y /Q . "%INSTALL_DIR%" >nul

REM Install dependencies
echo Installing dependencies...
cd /d "%INSTALL_DIR%"
python -m pip install --quiet fastapi uvicorn python-multipart gitpython dropbox google-api-python-client google-auth-httplib2 google-auth-oauthlib

REM Create launcher script
echo @echo off > "%INSTALL_DIR%\lectura.bat"
echo cd /d "%%LOCALAPPDATA%%\Lectura" >> "%INSTALL_DIR%\lectura.bat"
echo start /B python main.py >> "%INSTALL_DIR%\lectura.bat"
echo timeout /t 2 /nobreak ^>nul >> "%INSTALL_DIR%\lectura.bat"
echo start http://localhost:8000 >> "%INSTALL_DIR%\lectura.bat"

REM Create desktop shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\CreateShortcut.vbs"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\Lectura.lnk" >> "%TEMP%\CreateShortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\CreateShortcut.vbs"
echo oLink.TargetPath = "%INSTALL_DIR%\lectura.bat" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.WorkingDirectory = "%INSTALL_DIR%" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Description = "Lectura - Markdown Note-Taking App" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.IconLocation = "%INSTALL_DIR%\build\icon.ico" >> "%TEMP%\CreateShortcut.vbs"
echo oLink.Save >> "%TEMP%\CreateShortcut.vbs"
cscript /nologo "%TEMP%\CreateShortcut.vbs"
del "%TEMP%\CreateShortcut.vbs"

REM Add to Start Menu
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura"
copy "%USERPROFILE%\Desktop\Lectura.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Lectura\Lectura.lnk" >nul

echo.
echo ✅ Installation complete!
echo.
echo To start Lectura:
echo   1. Double-click the Lectura icon on your Desktop
echo   2. Or search for 'Lectura' in the Start Menu
echo.
echo To uninstall:
echo   Delete: %INSTALL_DIR%
echo   Delete: Desktop shortcut and Start Menu entry
echo.
pause
