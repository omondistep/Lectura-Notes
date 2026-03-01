# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Student Companion** is a desktop-grade Markdown note-taking app for lecture notes, inspired by JotBird. It runs as a local web app (Python FastAPI backend + vanilla JS frontend) and targets Linux (Hyprland/Arch).

Core workflow: type Markdown in the left pane → see live HTML preview in the right pane → hit **Publish** to save locally and push to GitHub.

## Build Plan & Status

### Core Editor
- [x] Split-pane layout: CodeMirror 6 (left) + markdown-it live preview (right)
- [x] Syntax highlighting in editor (CodeMirror markdown mode + oneDark theme)
- [x] Live word count in status bar
- [x] Line wrapping

### File Management
- [x] File sidebar — lists all `.md` files in `notes/`, click to open, ✕ to delete
- [x] New note button
- [x] Save locally (`Ctrl+S` or 💾 button) → writes to `notes/`
- [x] Editable filename bar
- [x] Sidebar collapse toggle (`Ctrl+B` / ☰ button)

### Import
- [x] Import `.md` files (read raw content)
- [x] Import `.txt` files
- [x] Import `.pdf` files (PyMuPDF text extraction)
- [x] Import `.docx` Word files (python-docx, preserves heading hierarchy)

### Export
- [x] Download raw `.md` file
- [x] Export standalone `.html` with embedded styles
- [x] Export `.pdf` via WeasyPrint (falls back to browser print if not installed)
- [x] Print (opens styled preview in new window → `window.print()`)

### Keyboard Shortcuts
- [x] `Ctrl+B` — Bold
- [x] `Ctrl+I` — Italic
- [x] `Ctrl+E` — Inline code
- [x] `Ctrl+K` — Insert link
- [x] `Ctrl+U` — Insert image
- [x] `Ctrl+Alt+1` — Heading 1
- [x] `Ctrl+Alt+2` — Heading 2
- [x] `Ctrl+Shift+8` — Bullet list
- [x] `Ctrl+Shift+7` — Numbered list
- [x] `Ctrl+Shift+X` — Task list
- [x] `Ctrl+Shift+.` — Blockquote
- [x] `Ctrl+S` — Save
- [x] `Ctrl+O` — Import file picker

### Toolbar Formatting Buttons
- [x] Bold, Italic, Code, Link, Image
- [x] H1, H2
- [x] Bullet list, Numbered list, Task list, Blockquote

### GitHub Integration
- [x] `POST /publish/{name}` — saves locally then git add/commit/push via gitpython
- [x] Commit message prompt modal before push
- [x] Token injected into remote URL at push time (never stored in git history)
- [x] Settings modal: repo URL, branch, token

### Cloud Storage
- [x] Dropbox: token-based, configured in Settings modal → `config.json`
- [x] Dropbox: upload note on Publish (backend route + frontend toggle)
- [x] Google Drive: OAuth2 flow + upload/download routes

### Settings
- [x] Settings modal (⚙ button)
- [x] `GET /config` / `POST /config` routes — token masked on read
- [x] `config.json` persisted on disk

### Backend API (main.py)
- [x] `GET /files` — list notes
- [x] `GET /files/{name}` — read note
- [x] `POST /files/{name}` — save note
- [x] `DELETE /files/{name}` — delete note
- [x] `GET /download/md/{name}` — download raw markdown
- [x] `POST /export/html/{name}` — export standalone HTML
- [x] `POST /export/pdf/{name}` — export PDF (WeasyPrint)
- [x] `POST /import` — import PDF/DOCX/TXT/MD
- [x] `POST /publish/{name}` — GitHub push
- [x] `GET /config` / `POST /config` — settings

### Remaining / Stretch
- [x] Dropbox sync — upload on Publish if enabled in Settings
- [x] Google Drive OAuth2 + sync — `/gdrive/auth` → `/gdrive/callback`, uploads on Publish
- [x] Search across notes — live debounced full-text search in sidebar (`/search?q=`)
- [x] Dark/light theme toggle — 🌙/☀️ button, persisted in `localStorage`
- [x] Auto-save on idle — 2 s after last keystroke, only when file has a real name
- [x] Markdown syntax help panel — slides in from right, `?` toolbar button, Escape to close
- [x] Show/hide preview toggle — `‹ Preview` toolbar button, editor expands to full width
- [x] Dark theme updated to deep navy-black anchored to `#040720`
- [x] Preview font set to `16px` (≥ 12 px, comfortable reading size)

## Running the App

```bash
# Quick start (installs deps if missing)
./start.sh

# Or manually:
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
xdg-open http://localhost:8000
```

## Project Structure

```
student_companion/
├── main.py              # FastAPI app — all API routes
├── requirements.txt     # Python dependencies
├── config.json          # GitHub / Dropbox settings (never commit tokens)
├── start.sh             # One-command launcher
├── notes/               # Local .md files stored here
├── what_it_is.md        # Reference doc
└── static/
    ├── index.html       # SPA shell: toolbar, sidebar, split panes, modals
    ├── editor.js        # CodeMirror 6, markdown-it, all UI logic
    └── style.css        # Dark theme (oneDark palette)
```

## Key Architecture Notes

- **No build step**: editor.js uses native ES modules + importmap for CodeMirror 6 via esm.sh CDN. markdown-it loaded via jsDelivr CDN.
- **Import flow**: file uploaded via `multipart/form-data` to `/import`; backend extracts text and returns `{ content }` JSON; frontend drops content into CodeMirror.
- **Publish flow**: frontend POSTs `{ content, message }` to `/publish/{name}`; backend writes file, then uses gitpython to clone/pull the repo into `.git_repo_cache/`, copies the note, commits, and pushes. Token injected into remote URL in memory only.
- **Export flow**: for HTML/PDF, frontend sends `{ html }` (the rendered innerHTML of the preview div) to the backend; backend wraps it in a styled document and returns as a downloadable blob.
- **Config security**: `GET /config` masks the GitHub token as `"***"`; `POST /config` preserves the real token if the frontend sends back the placeholder.

## config.json Schema

```json
{
  "github": { "repo_url": "", "branch": "main", "token": "" },
  "gdrive":  { "enabled": false },
  "dropbox": { "enabled": false, "token": "" }
}
```
