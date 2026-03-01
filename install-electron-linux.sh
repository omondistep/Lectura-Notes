#!/bin/bash
# Lectura Electron App Installer for Linux

set -e

echo "========================================="
echo "  Lectura Desktop App Installer (Linux)"
echo "========================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is required"
    echo "Install: sudo apt install nodejs npm"
    exit 1
fi

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is required"
    echo "Install: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

INSTALL_DIR="$HOME/.local/share/lectura-electron"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "📦 Installing to: $INSTALL_DIR"
echo ""

# Create directories
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

# Copy files
echo "📋 Copying files..."
cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR"
rm -rf .git __pycache__ .pytest_cache 2>/dev/null || true

# Install Node dependencies
echo "📥 Installing Electron..."
npm install --silent

# Create Python virtual environment
echo "🐍 Setting up Python environment..."
python3 -m venv venv
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
deactivate

# Create launcher script
cat > "$BIN_DIR/lectura-app" << 'LAUNCHER'
#!/bin/bash
cd "$HOME/.local/share/lectura-electron"
npm start
LAUNCHER

chmod +x "$BIN_DIR/lectura-app"

# Create desktop entry
cat > "$DESKTOP_DIR/lectura-app.desktop" << DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Lectura Desktop
Comment=Markdown Note-Taking Desktop App
Exec=$BIN_DIR/lectura-app
Icon=accessories-text-editor
Terminal=false
Categories=Office;TextEditor;Utility;
StartupNotify=true
DESKTOP

chmod +x "$DESKTOP_DIR/lectura-app.desktop"

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 Launch Lectura Desktop App:"
echo "   • Type: lectura-app"
echo "   • Or search 'Lectura Desktop' in applications"
echo ""
echo "📦 To build distributable:"
echo "   cd $INSTALL_DIR && npm run build-linux"
echo ""
