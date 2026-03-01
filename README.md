# Lectura

A self-hosted Markdown note-taking application with cloud sync support for GitHub, Dropbox, and Google Drive.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 📝 **Markdown Editor** - Live preview with syntax highlighting
- ☁️ **Cloud Sync** - OAuth login for GitHub, Dropbox, and Google Drive
- 📁 **Folder Structure** - Organize notes in folders, synced to cloud
- 🎨 **Multiple Themes** - Cobalt, Phantom, Seraph, Forest, and more
- 🔍 **Search** - Full-text search across all notes
- 📊 **Mermaid Diagrams** - Create flowcharts and diagrams
- 🖼️ **Image Upload** - Drag and drop images
- 📤 **Export** - Export to HTML and PDF
- ⌨️ **Vim Mode** - Optional Vim keybindings

## Quick Install

### Windows
1. Download and extract the Lectura folder
2. Right-click `install-windows.bat` → Run as Administrator
3. Double-click the Lectura icon on your Desktop

### Linux
```bash
chmod +x install-linux.sh
./install-linux.sh
lectura
```

## Requirements

- Python 3.8 or higher
- Internet connection (for cloud sync setup)

## Cloud Setup

See [OAUTH_SETUP.md](OAUTH_SETUP.md) for detailed instructions on setting up:
- GitHub OAuth
- Dropbox OAuth
- Google Drive OAuth

## Usage

1. Launch Lectura (opens at http://localhost:8000)
2. Create notes in the left sidebar
3. Click Settings (⚙) to connect cloud services
4. Click Publish (▲) to sync all notes to connected services

## Manual Installation

```bash
pip install -r requirements.txt
python main.py
```

Open http://localhost:8000 in your browser.

## Documentation

- [Installation Guide](INSTALL.md)
- [OAuth Setup Guide](OAUTH_SETUP.md)

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.
