#!/bin/bash
# Lectura Installer for Linux

set -e

echo "==================================="
echo "  Lectura Installer for Linux"
echo "==================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    echo "Install with: sudo apt install python3 python3-pip (Debian/Ubuntu)"
    echo "           or: sudo pacman -S python python-pip (Arch)"
    exit 1
fi

# Install directory
INSTALL_DIR="$HOME/.local/share/lectura"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "Installing to: $INSTALL_DIR"

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"

# Copy files
echo "Copying files..."
cp -r . "$INSTALL_DIR/"

# Install Python dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"

# Try pip3 first, then pip
if command -v pip3 &> /dev/null; then
    pip3 install --user -q fastapi uvicorn python-multipart gitpython dropbox google-api-python-client google-auth-httplib2 google-auth-oauthlib
elif command -v pip &> /dev/null; then
    pip install --user -q fastapi uvicorn python-multipart gitpython dropbox google-api-python-client google-auth-httplib2 google-auth-oauthlib
else
    echo "Warning: pip not found. Installing with python -m pip..."
    python3 -m ensurepip --user 2>/dev/null || true
    python3 -m pip install --user -q fastapi uvicorn python-multipart gitpython dropbox google-api-python-client google-auth-httplib2 google-auth-oauthlib
fi

# Create launcher script
cat > "$BIN_DIR/lectura" << 'EOF'
#!/bin/bash
cd "$HOME/.local/share/lectura"
python3 main.py &
sleep 2
xdg-open http://localhost:8000 2>/dev/null || open http://localhost:8000 2>/dev/null || echo "Open http://localhost:8000 in your browser"
EOF

chmod +x "$BIN_DIR/lectura"

# Create desktop entry
cat > "$DESKTOP_DIR/lectura.desktop" << EOF
[Desktop Entry]
Name=Lectura
Comment=Markdown Note-Taking App
Exec=$BIN_DIR/lectura
Icon=accessories-text-editor
Terminal=false
Type=Application
Categories=Office;TextEditor;
EOF

echo ""
echo "✅ Installation complete!"
echo ""
echo "To start Lectura:"
echo "  1. Run: lectura"
echo "  2. Or search for 'Lectura' in your applications menu"
echo ""
echo "To uninstall:"
echo "  rm -rf $INSTALL_DIR $BIN_DIR/lectura $DESKTOP_DIR/lectura.desktop"
