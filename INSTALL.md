# Lectura - Installation Guide

## Quick Install

### Windows
1. Download the Lectura folder
2. Right-click `install-windows.bat` → Run as Administrator
3. Wait for installation to complete
4. Double-click the Lectura icon on your Desktop

### Linux
1. Download the Lectura folder
2. Open terminal in the folder
3. Run: `chmod +x install-linux.sh && ./install-linux.sh`
4. Run: `lectura` or search for Lectura in applications

## Requirements

- **Python 3.8+** (Windows: https://python.org/downloads, Linux: `sudo apt install python3 python3-pip`)
- Internet connection for initial setup

## What Gets Installed

- Lectura app files
- Python dependencies (FastAPI, Git, Dropbox SDK, Google Drive API)
- Desktop shortcut / launcher
- Start menu entry (Windows) / Application menu entry (Linux)

## First Run Setup

1. Launch Lectura (opens in browser at http://localhost:8000)
2. Click Settings (⚙) to configure cloud services:
   - **GitHub**: Add OAuth credentials (see OAUTH_SETUP.md)
   - **Dropbox**: Add OAuth credentials
   - **Google Drive**: Add OAuth credentials
3. Start writing notes!

## Uninstall

### Windows
- Delete: `%LOCALAPPDATA%\Lectura`
- Delete: Desktop shortcut
- Delete: Start Menu entry

### Linux
```bash
rm -rf ~/.local/share/lectura ~/.local/bin/lectura ~/.local/share/applications/lectura.desktop
```

## Manual Installation

If the installer doesn't work:

1. Install Python dependencies:
   ```bash
   pip install fastapi uvicorn python-multipart gitpython dropbox google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```

2. Run the app:
   ```bash
   python main.py
   ```

3. Open browser: http://localhost:8000

## Troubleshooting

**"Python not found"**
- Install Python from python.org (Windows) or `sudo apt install python3` (Linux)
- Make sure "Add to PATH" is checked during installation

**"Permission denied" (Linux)**
- Run: `chmod +x install-linux.sh`

**Port 8000 already in use**
- Edit main.py, change the last line to use a different port: `uvicorn.run(app, host="0.0.0.0", port=8001)`
