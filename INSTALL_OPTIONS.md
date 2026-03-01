# Lectura - Installation Options

Lectura offers two installation methods:

## Option 1: Standalone (Browser-based) ✨ Recommended

Launches in your default web browser. Lightweight and simple.

### Windows
```bash
install-standalone-windows.bat
```

### Linux
```bash
chmod +x install-standalone-linux.sh
./install-standalone-linux.sh
lectura
```

**Pros:**
- ✅ Smaller installation size
- ✅ Uses your preferred browser
- ✅ Faster startup
- ✅ Easy updates

---

## Option 2: Desktop App (Electron-based)

Native desktop application with its own window interface.

### Requirements
- Node.js 16+ ([nodejs.org](https://nodejs.org))
- Python 3.8+

### Windows
```bash
install-electron-windows.bat
npm start
```

### Linux
```bash
chmod +x install-electron-linux.sh
./install-electron-linux.sh
npm start
```

### Build Distributable
```bash
# Linux (creates AppImage and .deb)
npm run build-linux

# Windows (creates installer)
npm run build-win
```

**Pros:**
- ✅ Native desktop app
- ✅ Standalone window (not browser)
- ✅ Can be distributed as AppImage/installer
- ✅ More "app-like" experience

**Cons:**
- ❌ Larger installation (~200MB with Electron)
- ❌ Requires Node.js

---

## Which Should I Choose?

**Choose Standalone if:**
- You want quick, lightweight installation
- You're comfortable using browser-based apps
- You want faster startup times

**Choose Desktop App if:**
- You want a native desktop application
- You prefer apps with their own windows
- You want to distribute as AppImage/installer
- You want the "Typora-like" native experience

---

## Uninstall

### Standalone
**Linux:**
```bash
rm -rf ~/.local/share/lectura ~/.local/bin/lectura ~/.local/share/applications/lectura.desktop
```

**Windows:**
```
Delete: %LOCALAPPDATA%\Lectura
Delete: Desktop and Start Menu shortcuts
```

### Desktop App
**Linux:**
```bash
rm -rf ~/Lectura_app
# Or if installed via .deb: sudo apt remove lectura
```

**Windows:**
```
Use "Add or Remove Programs" or delete installation folder
```
