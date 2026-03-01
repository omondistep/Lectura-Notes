# Lectura Standalone Installation

Install Lectura as a standalone desktop application (like Typora).

## Windows Installation

1. **Download** the Lectura folder
2. **Right-click** `install-standalone-windows.bat`
3. **Select** "Run as Administrator"
4. **Wait** for installation to complete
5. **Launch** from Desktop icon or Start Menu

The app will:
- Install to `%LOCALAPPDATA%\Lectura`
- Create isolated Python environment
- Add Desktop and Start Menu shortcuts
- Launch without console window

## Linux Installation

```bash
chmod +x install-standalone-linux.sh
./install-standalone-linux.sh
```

Then launch with:
```bash
lectura
```

Or search "Lectura" in your applications menu.

The app will:
- Install to `~/.local/share/lectura`
- Create isolated Python environment
- Add to `~/.local/bin` and applications menu
- Launch browser automatically

## Requirements

- **Python 3.8+** (must be installed first)
- **Internet connection** (for initial setup only)

## How It Works

Unlike the basic installers, these standalone installers:

1. Create an isolated virtual environment (no system-wide packages)
2. Install all dependencies locally
3. Create a launcher that:
   - Starts the FastAPI server in the background
   - Opens your default browser to http://localhost:8000
   - Runs silently without terminal windows

## Uninstall

**Windows:**
```
Delete: %LOCALAPPDATA%\Lectura
Delete: Desktop shortcut
Delete: Start Menu entry
```

**Linux:**
```bash
rm -rf ~/.local/share/lectura
rm ~/.local/bin/lectura
rm ~/.local/share/applications/lectura.desktop
```

## Troubleshooting

**Port 8000 already in use:**
```bash
# Linux/Mac
lsof -ti:8000 | xargs kill -9

# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**Python not found:**
- Download from https://python.org/downloads/
- On Windows: Check "Add Python to PATH" during installation
- On Linux: `sudo apt install python3 python3-venv python3-pip`
