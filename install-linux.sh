#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Lectura Installer for Linux
# Installs as a standalone app with isolated Python venv
# Supports: Web app (browser) and Electron desktop app
# ═══════════════════════════════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/lectura"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
APP_VERSION="2.0.0"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}================================================${NC}"
    echo -e "${CYAN}${BOLD}       Lectura Installer for Linux v${APP_VERSION}${NC}"
    echo -e "${CYAN}${BOLD}================================================${NC}"
    echo ""
}

print_step() { echo -e "${CYAN}[*]${NC} $1"; }
print_ok()   { echo -e "${GREEN}[+]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()  { echo -e "${RED}[-]${NC} $1"; }

# ── Dependency checks ────────────────────────────────────────────────────────
check_dependencies() {
    print_step "Checking dependencies..."

    if ! command -v python3 &>/dev/null; then
        print_err "Python 3 is required but not installed."
        echo "  Install with:"
        echo "    Debian/Ubuntu: sudo apt install python3 python3-pip python3-venv"
        echo "    Arch:          sudo pacman -S python python-pip"
        echo "    Fedora:        sudo dnf install python3 python3-pip"
        exit 1
    fi

    PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    print_ok "Python $PYTHON_VER found"

    # Check python3-venv
    if ! python3 -m venv --help &>/dev/null; then
        print_err "python3-venv is required."
        echo "  Install with: sudo apt install python3-venv"
        exit 1
    fi
}

# ── Install mode selection ────────────────────────────────────────────────────
select_mode() {
    echo ""
    echo -e "${BOLD}Select installation mode:${NC}"
    echo "  1) Web App      - Runs in your browser (lightweight)"
    echo "  2) Desktop App  - Electron desktop app (requires Node.js)"
    echo ""
    read -p "Choose [1/2] (default: 1): " mode_choice
    mode_choice=${mode_choice:-1}

    if [[ "$mode_choice" == "2" ]]; then
        if ! command -v node &>/dev/null; then
            print_err "Node.js is required for Desktop App mode."
            echo "  Install with:"
            echo "    Debian/Ubuntu: sudo apt install nodejs npm"
            echo "    Arch:          sudo pacman -S nodejs npm"
            echo "    Or:            https://nodejs.org/"
            exit 1
        fi
        NODE_VER=$(node -v)
        print_ok "Node.js $NODE_VER found"
        INSTALL_MODE="electron"
    else
        INSTALL_MODE="web"
    fi
}

# ── Copy project files ────────────────────────────────────────────────────────
install_files() {
    print_step "Installing to: $INSTALL_DIR"

    # Clean previous install
    if [ -d "$INSTALL_DIR" ]; then
        print_warn "Existing installation found, updating..."
        rm -rf "$INSTALL_DIR"
    fi

    mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

    # Copy project files (exclude dev/runtime artifacts)
    print_step "Copying files..."
    SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"

    # Copy essential files
    cp "$SOURCE_DIR/main.py" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/lectura-launcher.py" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/requirements.txt" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/cobalt.css" "$INSTALL_DIR/" 2>/dev/null || true

    # Copy directories
    cp -r "$SOURCE_DIR/static" "$INSTALL_DIR/"
    cp -r "$SOURCE_DIR/build" "$INSTALL_DIR/"

    # Create notes directory
    mkdir -p "$INSTALL_DIR/notes"

    # Copy config if exists
    cp "$SOURCE_DIR/config.json" "$INSTALL_DIR/" 2>/dev/null || true

    if [[ "$INSTALL_MODE" == "electron" ]]; then
        cp "$SOURCE_DIR/electron-main.js" "$INSTALL_DIR/"
        cp "$SOURCE_DIR/preload.js" "$INSTALL_DIR/"
        cp "$SOURCE_DIR/package.json" "$INSTALL_DIR/"
    fi

    print_ok "Files copied"
}

# ── Setup Python venv ─────────────────────────────────────────────────────────
setup_python() {
    print_step "Setting up Python virtual environment..."
    cd "$INSTALL_DIR"
    python3 -m venv venv
    source venv/bin/activate
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    deactivate
    print_ok "Python dependencies installed"
}

# ── Setup Electron (if selected) ─────────────────────────────────────────────
setup_electron() {
    if [[ "$INSTALL_MODE" != "electron" ]]; then return; fi
    print_step "Installing Electron dependencies..."
    cd "$INSTALL_DIR"
    npm install --silent 2>/dev/null
    print_ok "Electron installed"
}

# ── Create launchers ─────────────────────────────────────────────────────────
create_launchers() {
    if [[ "$INSTALL_MODE" == "electron" ]]; then
        # Electron launcher
        cat > "$BIN_DIR/lectura" << 'LAUNCHER'
#!/bin/bash
cd "$HOME/.local/share/lectura"
export PATH="$HOME/.local/share/lectura/venv/bin:$PATH"
npm start 2>/dev/null
LAUNCHER
    else
        # Web app launcher
        cat > "$BIN_DIR/lectura" << 'LAUNCHER'
#!/bin/bash
cd "$HOME/.local/share/lectura"
source venv/bin/activate
python3 lectura-launcher.py
LAUNCHER
    fi

    chmod +x "$BIN_DIR/lectura"
    print_ok "Launcher created: $BIN_DIR/lectura"
}

# ── Create desktop entry ─────────────────────────────────────────────────────
create_desktop_entry() {
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
Keywords=markdown;notes;editor;writing;
DESKTOP

    chmod +x "$DESKTOP_DIR/lectura.desktop"

    # Update desktop database if available
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

    print_ok "Desktop entry created"
}

# ── Build Electron distributable (optional) ──────────────────────────────────
offer_build() {
    if [[ "$INSTALL_MODE" != "electron" ]]; then return; fi
    echo ""
    read -p "Build distributable AppImage/deb package now? [y/N]: " build_choice
    if [[ "$build_choice" =~ ^[Yy]$ ]]; then
        print_step "Building Linux packages..."
        cd "$INSTALL_DIR"
        npm run build-linux
        print_ok "Packages built in: $INSTALL_DIR/dist/"
    fi
}

# ── PATH check ────────────────────────────────────────────────────────────────
check_path() {
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        echo ""
        print_warn "Add this to your ~/.bashrc or ~/.zshrc:"
        echo -e "    ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    fi
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}${BOLD}================================================${NC}"
    echo -e "${GREEN}${BOLD}         Installation complete!${NC}"
    echo -e "${GREEN}${BOLD}================================================${NC}"
    echo ""
    echo -e "  ${BOLD}Launch:${NC}    lectura"
    echo -e "  ${BOLD}Or:${NC}        Search 'Lectura' in your applications"
    echo ""
    echo -e "  ${BOLD}Uninstall:${NC}"
    echo "    rm -rf $INSTALL_DIR"
    echo "    rm -f $BIN_DIR/lectura"
    echo "    rm -f $DESKTOP_DIR/lectura.desktop"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
print_banner
check_dependencies
select_mode
install_files
setup_python
setup_electron
create_launchers
create_desktop_entry
offer_build
check_path
print_summary
