#!/bin/bash
# Lectura Standalone Installer for Linux

set -e

echo "==================================="
echo "  Lectura Standalone Installer"
echo "==================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is required"
    echo "Install: sudo apt install python3 python3-pip"
    exit 1
fi

INSTALL_DIR="$HOME/.local/share/lectura"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "📦 Installing to: $INSTALL_DIR"

# Create directories
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

# Copy files
echo "📋 Copying files..."
cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR"
rm -rf .git venv __pycache__ .pytest_cache 2>/dev/null || true

# Create virtual environment
echo "🐍 Setting up Python environment..."
python3 -m venv venv
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

# Create launcher
cat > "$BIN_DIR/lectura" << 'LAUNCHER'
#!/bin/bash
cd "$HOME/.local/share/lectura"
source venv/bin/activate
python3 lectura-launcher.py
LAUNCHER

chmod +x "$BIN_DIR/lectura"
chmod +x "$INSTALL_DIR/lectura-launcher.py"

# Create desktop entry
cat > "$DESKTOP_DIR/lectura.desktop" << DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Lectura
Comment=Markdown Note-Taking App
Exec=$BIN_DIR/lectura
Icon=$INSTALL_DIR/build/icon.png
Terminal=false
Categories=Office;TextEditor;Utility;
StartupNotify=true
DESKTOP

chmod +x "$DESKTOP_DIR/lectura.desktop"

# Add to PATH if needed
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "⚠️  Add to your ~/.bashrc or ~/.zshrc:"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 Launch Lectura:"
echo "   • Type: lectura"
echo "   • Or search 'Lectura' in applications"
echo ""
