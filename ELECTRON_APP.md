# Lectura Desktop App (Electron)

Native desktop application that runs Lectura in its own window.

## Quick Start

### First Time Setup

**Linux:**
```bash
./install-electron-linux.sh
```

**Windows:**
```bash
install-electron-windows.bat
```

This will:
1. Install Electron and Node dependencies
2. Create Python virtual environment
3. Install Python dependencies

### Running the App

After installation, launch from:

**Linux:**
- Type `lectura-app` in terminal
- Or search "Lectura Desktop" in applications menu

**Windows:**
- Double-click "Lectura Desktop" icon on Desktop
- Or search "Lectura Desktop" in Start Menu

The app will:
- Start the FastAPI backend automatically
- Open in a native desktop window
- Run independently (not in browser)

## Building Distributables

### Linux (AppImage + .deb)
```bash
npm run build-linux
```

Output: `dist/Lectura-1.0.0.AppImage` and `dist/Lectura_1.0.0_amd64.deb`

### Windows (Installer)
```bash
npm run build-win
```

Output: `dist/Lectura Setup 1.0.0.exe`

## How It Works

The Electron app:
1. Starts a Python FastAPI server in the background
2. Opens a native window (Chromium-based)
3. Loads the web interface from localhost:8000
4. Manages the Python process lifecycle
5. Closes everything when you quit the app

## Differences from Standalone

| Feature | Standalone | Desktop App |
|---------|-----------|-------------|
| Installation | ~50MB | ~200MB |
| Requires | Python | Python + Node.js |
| Runs in | Browser | Native window |
| Startup | Fast | Moderate |
| Distribution | Folder | AppImage/Installer |

## Troubleshooting

**"Cannot find module 'electron'"**
```bash
npm install
```

**Python server won't start**
```bash
source venv/bin/activate  # Linux
# or
venv\Scripts\activate.bat  # Windows

python main.py  # Test manually
```

**Port 8000 in use**
```bash
# Linux
lsof -ti:8000 | xargs kill -9

# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```
