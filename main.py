# -*- coding: utf-8 -*-
"""
Lectura - A self-hosted Markdown note-taking application

26. Type Hints - Comprehensive type annotations
27. Error Handling Standardization - Custom exception classes
28. Configuration Validation - Pydantic models for config
29. Logging - Structured logging throughout
"""
import io
import json
import logging
import os
import shutil
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl, Field, field_validator

# ── 29. Logging Setup ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
logger.info("Starting Lectura")

# ── optional heavy deps ────────────────────────────────────────────────────────
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    from docx import Document as DocxDocument
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    import git
    HAS_GIT = True
except ImportError:
    HAS_GIT = False

try:
    from weasyprint import HTML as WP_HTML
    HAS_WEASYPRINT = True
except ImportError:
    HAS_WEASYPRINT = False

try:
    import dropbox as dbx_sdk
    HAS_DROPBOX = True
except ImportError:
    HAS_DROPBOX = False

try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build as gdrive_build
    from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
    HAS_GDRIVE = True
except ImportError:
    HAS_GDRIVE = False

# ── app setup ──────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
NOTES = BASE / "notes"
NOTES.mkdir(exist_ok=True)
CONFIG_PATH = BASE / "config.json"

# GitHub OAuth
GITHUB_SECRETS_PATH = BASE / "github_secrets.json"
GITHUB_TOKEN_PATH = BASE / ".github_token.json"

# Dropbox OAuth
DROPBOX_SECRETS_PATH = BASE / "dropbox_secrets.json"
DROPBOX_TOKEN_PATH = BASE / ".dropbox_token.json"

# Google Drive OAuth
GDRIVE_SECRETS_PATH = BASE / "gdrive_secrets.json"
GDRIVE_TOKEN_PATH = BASE / ".gdrive_token.json"
GDRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

app = FastAPI(title="Lectura")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def save_config(cfg: dict):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


# ── 27. Error Handling Standardization ────────────────────────────────────────
class AppError(HTTPException):
    """Base exception for application errors."""
    def __init__(self, status_code: int, detail: str, error_code: str = None):
        self.error_code = error_code or f"ERR_{status_code}"
        super().__init__(status_code=status_code, detail=detail)


class NotFoundError(AppError):
    """Resource not found."""
    def __init__(self, resource: str, identifier: str):
        super().__init__(404, f"{resource} '{identifier}' not found", "NOT_FOUND")


class ValidationError(AppError):
    """Validation error."""
    def __init__(self, detail: str):
        super().__init__(400, detail, "VALIDATION_ERROR")


class ConfigurationError(AppError):
    """Configuration error."""
    def __init__(self, detail: str):
        super().__init__(400, detail, "CONFIG_ERROR")


class DependencyError(AppError):
    """Missing dependency error."""
    def __init__(self, dependency: str, install_hint: str = ""):
        detail = f"{dependency} not installed"
        if install_hint:
            detail += f" — run: {install_hint}"
        super().__init__(501, detail, "DEPENDENCY_ERROR")


# ── 28. Configuration Validation with Pydantic ────────────────────────────────
class GitHubConfig(BaseModel):
    """GitHub configuration model."""
    repo_url: Optional[str] = ""
    branch: str = "main"
    token: Optional[str] = ""
    
    @field_validator('branch')
    @classmethod
    def validate_branch(cls, v: str) -> str:
        if v and not v.replace('-', '').replace('_', '').isalnum():
            raise ValueError('Invalid branch name')
        return v or "main"


class DropboxConfig(BaseModel):
    """Dropbox configuration model."""
    enabled: bool = False
    token: Optional[str] = ""


class GDriveConfig(BaseModel):
    """Google Drive configuration model."""
    enabled: bool = False
    connected: bool = False


class AppConfig(BaseModel):
    """Application configuration model."""
    github: GitHubConfig = Field(default_factory=GitHubConfig)
    dropbox: DropboxConfig = Field(default_factory=DropboxConfig)
    gdrive: GDriveConfig = Field(default_factory=GDriveConfig)


# ── models ─────────────────────────────────────────────────────────────────────
class NoteBody(BaseModel):
    """Request body for saving notes."""
    content: str = Field(..., min_length=0, max_length=10_000_000)  # 10MB max


class PublishBody(BaseModel):
    """Request body for publishing notes."""
    content: str
    message: str = Field(default="", max_length=1000)


class HtmlBody(BaseModel):
    """Request body for HTML export."""
    html: str


class ConfigBody(BaseModel):
    """Request body for configuration updates."""
    config: Dict[str, Any]


class FileListResponse(BaseModel):
    """Response model for file listing."""
    files: List[str]
    folders: List[str]
    current_folder: str = ""


class SearchResult(BaseModel):
    """Single search result."""
    name: str
    snippet: str


class SearchResponse(BaseModel):
    """Response model for search."""
    results: List[SearchResult]


# ── routes ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    return FileResponse(BASE / "static" / "index.html")


# ── file management ────────────────────────────────────────────────────────────

@app.get("/files")
async def list_files(folder: str = "", recursive: bool = True):
    """List files and folders. If recursive=True, returns all files/folders for tree view.
    If recursive=False, returns only items in the specified folder."""
    # Determine the target directory
    if folder:
        target_dir = NOTES / folder
        if not target_dir.exists() or not target_dir.is_dir():
            raise HTTPException(404, f"Folder '{folder}' not found")
    else:
        target_dir = NOTES
    
    if recursive:
        # Return ALL files and folders recursively for tree view
        files = []
        folders = []
        
        for p in NOTES.rglob("*"):
            if p.is_file() and p.suffix == ".md":
                files.append(p.relative_to(NOTES).as_posix())
            elif p.is_dir():
                folders.append(p.relative_to(NOTES).as_posix() + "/")
        
        files = sorted(files)
        folders = sorted(folders)
        return {"files": files, "folders": folders, "current_folder": ""}
    else:
        # Non-recursive: only items in the specified folder
        files = sorted(
            p.relative_to(NOTES).as_posix()
            for p in target_dir.glob("*.md")
            if p.is_file()
        )
        
        folders = []
        for d in target_dir.iterdir():
            if d.is_dir():
                rel_path = d.relative_to(NOTES).as_posix() + "/"
                folders.append(rel_path)
        folders = sorted(folders)
        
        return {"files": files, "folders": folders, "current_folder": folder}


@app.get("/files/{name:path}")
async def read_file(name: str):
    """Read a file by its path (can include folder path)."""
    path = NOTES / name
    if not path.exists():
        raise HTTPException(404, "File not found")
    if path.is_dir():
        raise HTTPException(400, "Path is a directory, not a file")
    return {"name": name, "content": path.read_text()}


@app.post("/files/{name:path}")
async def save_file(name: str, body: NoteBody):
    """Save a file by its path (can include folder path)."""
    path = NOTES / name
    
    # Handle folder creation - paths ending with /.folder or just folder path
    if name.endswith("/.folder") or (not name.endswith(".md") and not "." in Path(name).name):
        folder_path = NOTES / name.replace("/.folder", "")
        folder_path.mkdir(parents=True, exist_ok=True)
        return {"saved": name, "type": "folder"}
    
    # Regular file save
    if not name.endswith(".md"):
        name += ".md"
        path = NOTES / name
    
    # Ensure parent directory exists
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.content)
    return {"saved": name, "type": "file"}


@app.delete("/files/{name:path}")
async def delete_file(name: str):
    """Delete a file or folder by its path."""
    path = NOTES / name
    if not path.exists():
        raise HTTPException(404, "File or folder not found")
    
    if path.is_dir():
        # Delete folder and all contents
        shutil.rmtree(path)
        return {"deleted": name, "type": "folder"}
    else:
        path.unlink()
        return {"deleted": name, "type": "file"}


# ── folder operations ──────────────────────────────────────────────────────────

@app.post("/folders/{name:path}")
async def create_folder(name: str):
    """Create a new folder."""
    folder_path = NOTES / name
    folder_path.mkdir(parents=True, exist_ok=True)
    return {"created": name}


@app.put("/folders/{name:path}")
async def rename_folder(name: str, new_name: str = ""):
    """Rename a folder."""
    if not new_name:
        raise HTTPException(400, "new_name parameter required")
    old_path = NOTES / name
    new_path = NOTES / new_name
    if not old_path.exists():
        raise HTTPException(404, f"Folder '{name}' not found")
    old_path.rename(new_path)
    return {"renamed": name, "to": new_name}


@app.post("/reveal/{name:path}")
async def reveal_in_file_manager(name: str):
    """Open the file manager with the given path selected (Linux xdg-open)."""
    import subprocess
    target = NOTES / name
    if not target.exists():
        raise HTTPException(404, f"'{name}' not found")
    # Open the parent directory so the item is visible
    parent = target.parent if target.is_file() else target
    subprocess.Popen(["xdg-open", str(parent)])
    return {"opened": str(parent)}


# ── search ─────────────────────────────────────────────────────────────────────

@app.get("/search")
async def search_notes(q: str = ""):
    """Full-text search across all notes (recursive). Returns [{name, snippet}]."""
    if not q:
        return {"results": []}
    q_lower = q.lower()
    results = []
    # Search recursively for all .md files
    for path in sorted(NOTES.rglob("*.md")):
        content = path.read_text(errors="replace")
        if q_lower in content.lower():
            # find first matching line for snippet
            for line in content.splitlines():
                if q_lower in line.lower():
                    snippet = line.strip()[:120]
                    break
            else:
                snippet = content[:120]
            # Return path relative to NOTES
            rel_path = path.relative_to(NOTES).as_posix()
            results.append({"name": rel_path, "snippet": snippet})
    return {"results": results}


# ── download / export ──────────────────────────────────────────────────────────

@app.get("/download/md/{name}")
async def download_md(name: str):
    path = NOTES / name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="text/markdown",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/export/html/{name}")
async def export_html(name: str, body: HtmlBody):
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{name}</title>
<style>
  body {{ font-family: Georgia, serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }}
  pre {{ background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; }}
  code {{ background: #f4f4f4; padding: .2em .4em; border-radius: 3px; }}
  blockquote {{ border-left: 4px solid #ccc; margin: 0; padding-left: 1rem; color: #555; }}
  img {{ max-width: 100%; }}
</style>
</head>
<body>
{body.html}
</body>
</html>"""
    stem = name.removesuffix(".md")
    return Response(
        content=html,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{stem}.html"'},
    )


@app.post("/export/pdf/{name}")
async def export_pdf(name: str, body: HtmlBody):
    if not HAS_WEASYPRINT:
        raise HTTPException(501, "WeasyPrint not installed")
    stem = name.removesuffix(".md")
    pdf_bytes = WP_HTML(string=body.html).write_pdf()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )


# ── image upload ───────────────────────────────────────────────────────────────

IMAGES = BASE / "static" / "images"
IMAGES.mkdir(exist_ok=True)

@app.post("/upload/image")
async def upload_image(file: UploadFile = File(...)):
    filename = Path(file.filename or "image.png").name
    # sanitise filename
    safe = "".join(c for c in filename if c.isalnum() or c in "._-")
    if not safe:
        safe = "image.png"
    dest = IMAGES / safe
    # avoid collisions
    stem, ext = os.path.splitext(safe)
    counter = 1
    while dest.exists():
        dest = IMAGES / f"{stem}_{counter}{ext}"
        counter += 1
    dest.write_bytes(await file.read())
    return {"url": f"/static/images/{dest.name}"}


# ── import ─────────────────────────────────────────────────────────────────────

@app.post("/import")
async def import_file(file: UploadFile = File(...)):
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    data = await file.read()

    if ext in (".md", ".txt"):
        return {"content": data.decode("utf-8", errors="replace")}

    if ext == ".pdf":
        if not HAS_PYMUPDF:
            raise HTTPException(501, "PyMuPDF not installed — run: pip install pymupdf")
        doc = fitz.open(stream=data, filetype="pdf")
        text = "\n\n".join(page.get_text() for page in doc)
        return {"content": text}

    if ext == ".docx":
        if not HAS_DOCX:
            raise HTTPException(501, "python-docx not installed — run: pip install python-docx")
        doc = DocxDocument(io.BytesIO(data))
        lines = []
        for para in doc.paragraphs:
            style = para.style.name if para.style else ""
            if style.startswith("Heading 1"):
                lines.append(f"# {para.text}")
            elif style.startswith("Heading 2"):
                lines.append(f"## {para.text}")
            elif style.startswith("Heading 3"):
                lines.append(f"### {para.text}")
            else:
                lines.append(para.text)
        return {"content": "\n\n".join(lines)}

    raise HTTPException(415, f"Unsupported file type: {ext}")


# ── github publish ─────────────────────────────────────────────────────────────

@app.post("/publish/{name}")
async def publish(name: str, body: PublishBody):
    if not HAS_GIT:
        raise HTTPException(501, "gitpython not installed")
    cfg = load_config()
    gh = cfg.get("github", {})
    repo_url = gh.get("repo_url", "")
    token = gh.get("token", "")
    branch = gh.get("branch", "main")

    if not repo_url:
        raise HTTPException(400, "GitHub repo_url not configured in config.json")

    if not name.endswith(".md"):
        name += ".md"
    note_path = NOTES / name
    note_path.write_text(body.content)

    authed_url = repo_url.replace("https://", f"https://{token}@") if (token and "https://" in repo_url) else repo_url

    repo_dir = BASE / ".git_repo_cache"
    try:
        if repo_dir.exists():
            repo = git.Repo(repo_dir)
            repo.remotes.origin.set_url(authed_url)
            repo.remotes.origin.pull()
        else:
            repo = git.Repo.clone_from(authed_url, repo_dir, branch=branch)

        shutil.copy(note_path, repo_dir / name)
        repo.index.add([name])
        repo.index.commit(body.message or f"Update {name}")
        repo.remotes.origin.set_url(authed_url)
        repo.remotes.origin.push(branch)
    except Exception as e:
        raise HTTPException(500, f"Git error: {e}")

    results = {"published": name, "branch": branch}

    # ── optional Dropbox sync ──────────────────────────────────────────────────
    dbx_cfg = cfg.get("dropbox", {})
    if dbx_cfg.get("enabled") and dbx_cfg.get("token"):
        if not HAS_DROPBOX:
            results["dropbox"] = "dropbox SDK not installed"
        else:
            try:
                dbx = dbx_sdk.Dropbox(dbx_cfg["token"])
                content_bytes = note_path.read_bytes()
                dbx.files_upload(
                    content_bytes,
                    f"/student-companion/{name}",
                    mode=dbx_sdk.files.WriteMode("overwrite"),
                )
                results["dropbox"] = "synced"
            except Exception as e:
                results["dropbox"] = f"error: {e}"

    # ── optional Google Drive sync ────────────────────────────────────────────
    gd_cfg = cfg.get("gdrive", {})
    if gd_cfg.get("enabled") and GDRIVE_TOKEN_PATH.exists():
        if not HAS_GDRIVE:
            results["gdrive"] = "google SDK not installed"
        else:
            try:
                creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_PATH), GDRIVE_SCOPES)
                service = gdrive_build("drive", "v3", credentials=creds)
                file_metadata = {"name": name}
                media = MediaIoBaseUpload(io.BytesIO(note_path.read_bytes()), mimetype="text/markdown")
                # check if file already exists
                existing = service.files().list(
                    q=f"name='{name}' and trashed=false",
                    fields="files(id)"
                ).execute().get("files", [])
                if existing:
                    service.files().update(fileId=existing[0]["id"], media_body=media).execute()
                else:
                    service.files().create(body=file_metadata, media_body=media, fields="id").execute()
                results["gdrive"] = "synced"
            except Exception as e:
                results["gdrive"] = f"error: {e}"

    return results


# ── dropbox: list & open ───────────────────────────────────────────────────────

@app.get("/dropbox/files")
async def dropbox_list():
    if not HAS_DROPBOX:
        raise HTTPException(501, "dropbox SDK not installed")
    cfg = load_config().get("dropbox", {})
    if not cfg.get("enabled") or not cfg.get("token"):
        raise HTTPException(400, "Dropbox not configured")
    try:
        dbx = dbx_sdk.Dropbox(cfg["token"])
        result = dbx.files_list_folder("/student-companion")
        files = [e.name for e in result.entries if isinstance(e, dbx_sdk.files.FileMetadata) and e.name.endswith(".md")]
        return {"files": files}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/dropbox/open/{name}")
async def dropbox_open(name: str):
    if not HAS_DROPBOX:
        raise HTTPException(501, "dropbox SDK not installed")
    cfg = load_config().get("dropbox", {})
    if not cfg.get("enabled") or not cfg.get("token"):
        raise HTTPException(400, "Dropbox not configured")
    try:
        dbx = dbx_sdk.Dropbox(cfg["token"])
        _, response = dbx.files_download(f"/student-companion/{name}")
        return {"name": name, "content": response.content.decode("utf-8", errors="replace")}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── google drive oauth ─────────────────────────────────────────────────────────

@app.get("/gdrive/auth")
async def gdrive_auth():
    """Start Google OAuth2 flow. Requires gdrive_client_secrets.json next to main.py."""
    if not HAS_GDRIVE:
        raise HTTPException(501, "google SDK not installed")
    if not GDRIVE_SECRETS_PATH.exists():
        raise HTTPException(400, "gdrive_client_secrets.json not found. Download it from Google Cloud Console.")
    flow = Flow.from_client_secrets_file(
        str(GDRIVE_SECRETS_PATH),
        scopes=GDRIVE_SCOPES,
        redirect_uri="http://localhost:8000/gdrive/callback",
    )
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")
    return RedirectResponse(auth_url)


@app.get("/gdrive/callback")
async def gdrive_callback(code: str, state: str = ""):
    if not HAS_GDRIVE:
        raise HTTPException(501, "google SDK not installed")
    flow = Flow.from_client_secrets_file(
        str(GDRIVE_SECRETS_PATH),
        scopes=GDRIVE_SCOPES,
        redirect_uri="http://localhost:8000/gdrive/callback",
    )
    flow.fetch_token(code=code)
    creds = flow.credentials
    GDRIVE_TOKEN_PATH.write_text(creds.to_json())
    # enable gdrive in config
    cfg = load_config()
    cfg.setdefault("gdrive", {})["enabled"] = True
    save_config(cfg)
    return HTMLResponse("<html><body><h2>Google Drive connected!</h2><p>You can close this tab.</p><script>window.close()</script></body></html>")


@app.get("/gdrive/status")
async def gdrive_status():
    connected = GDRIVE_TOKEN_PATH.exists()
    return {"connected": connected}


@app.get("/gdrive/files")
async def gdrive_list():
    if not HAS_GDRIVE:
        raise HTTPException(501, "google SDK not installed")
    if not GDRIVE_TOKEN_PATH.exists():
        raise HTTPException(401, "Not authenticated with Google Drive")
    try:
        creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_PATH), GDRIVE_SCOPES)
        service = gdrive_build("drive", "v3", credentials=creds)
        results = service.files().list(
            q="name contains '.md' and trashed=false",
            fields="files(id,name)"
        ).execute()
        return {"files": [f["name"] for f in results.get("files", [])]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/gdrive/open/{name}")
async def gdrive_open(name: str):
    if not HAS_GDRIVE:
        raise HTTPException(501, "google SDK not installed")
    if not GDRIVE_TOKEN_PATH.exists():
        raise HTTPException(401, "Not authenticated with Google Drive")
    try:
        creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_PATH), GDRIVE_SCOPES)
        service = gdrive_build("drive", "v3", credentials=creds)
        results = service.files().list(
            q=f"name='{name}' and trashed=false",
            fields="files(id,name)"
        ).execute().get("files", [])
        if not results:
            raise HTTPException(404, f"{name} not found on Google Drive")
        file_id = results[0]["id"]
        buf = io.BytesIO()
        request = service.files().get_media(fileId=file_id)
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return {"name": name, "content": buf.getvalue().decode("utf-8", errors="replace")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── GitHub OAuth ───────────────────────────────────────────────────────────────

@app.get("/github/auth")
async def github_auth():
    if not GITHUB_SECRETS_PATH.exists():
        return HTMLResponse(f"<h1>GitHub OAuth Not Configured</h1><p>Create {GITHUB_SECRETS_PATH} with client_id and client_secret from GitHub Developer Settings</p>", 400)
    secrets = json.loads(GITHUB_SECRETS_PATH.read_text())
    redirect_uri = "http://localhost:8000/github/callback"
    state = os.urandom(16).hex()
    (BASE / ".github_state.json").write_text(json.dumps({"state": state}))
    auth_url = f"https://github.com/login/oauth/authorize?client_id={secrets['client_id']}&redirect_uri={redirect_uri}&scope=repo&state={state}"
    return RedirectResponse(auth_url)


@app.get("/github/callback")
async def github_callback(code: str, state: str):
    state_file = BASE / ".github_state.json"
    if not state_file.exists() or json.loads(state_file.read_text())["state"] != state:
        return HTMLResponse("<h1>Invalid state</h1>", 400)
    secrets = json.loads(GITHUB_SECRETS_PATH.read_text())
    data = f"client_id={secrets['client_id']}&client_secret={secrets['client_secret']}&code={code}"
    req = urllib.request.Request("https://github.com/login/oauth/access_token", data.encode(), headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        token_data = json.loads(resp.read())
    GITHUB_TOKEN_PATH.write_text(json.dumps(token_data))
    state_file.unlink()
    return HTMLResponse("<h1>✅ GitHub Connected</h1><script>window.close()</script>")


@app.get("/github/status")
async def github_status():
    return {"connected": GITHUB_TOKEN_PATH.exists()}


# ── Dropbox OAuth ──────────────────────────────────────────────────────────────

@app.get("/dropbox/auth")
async def dropbox_auth():
    if not DROPBOX_SECRETS_PATH.exists():
        return HTMLResponse(f"<h1>Dropbox OAuth Not Configured</h1><p>Create {DROPBOX_SECRETS_PATH} with app_key and app_secret from Dropbox App Console</p>", 400)
    secrets = json.loads(DROPBOX_SECRETS_PATH.read_text())
    state = os.urandom(16).hex()
    (BASE / ".dropbox_state.json").write_text(json.dumps({"state": state}))
    auth_url = f"https://www.dropbox.com/oauth2/authorize?client_id={secrets['app_key']}&redirect_uri=http://localhost:8000/dropbox/callback&response_type=code&state={state}"
    return RedirectResponse(auth_url)


@app.get("/dropbox/callback")
async def dropbox_callback(code: str, state: str):
    if not HAS_DROPBOX:
        raise HTTPException(501, "dropbox SDK not installed")
    secrets = json.loads(DROPBOX_SECRETS_PATH.read_text())
    
    # Exchange code for token
    data = f"code={code}&grant_type=authorization_code&redirect_uri=http://localhost:8000/dropbox/callback&client_id={secrets['app_key']}&client_secret={secrets['app_secret']}"
    req = urllib.request.Request("https://api.dropboxapi.com/oauth2/token", data.encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        token_data = json.loads(resp.read())
    
    DROPBOX_TOKEN_PATH.write_text(json.dumps({"access_token": token_data["access_token"]}))
    (BASE / ".dropbox_state.json").unlink(missing_ok=True)
    return HTMLResponse("<h1>✅ Dropbox Connected</h1><script>window.close()</script>")


@app.get("/dropbox/status")
async def dropbox_status():
    return {"connected": DROPBOX_TOKEN_PATH.exists()}


# ── Publish to Cloud ───────────────────────────────────────────────────────────

@app.post("/publish")
async def publish():
    """Publish all notes to connected cloud service."""
    # Check which service is connected
    github_connected = GITHUB_TOKEN_PATH.exists()
    dropbox_connected = DROPBOX_TOKEN_PATH.exists()
    gdrive_connected = GDRIVE_TOKEN_PATH.exists()
    
    if not any([github_connected, dropbox_connected, gdrive_connected]):
        raise HTTPException(400, "No cloud service connected. Login to GitHub, Dropbox, or Google Drive first.")
    
    # Collect all files
    files = {}
    for p in NOTES.rglob("*.md"):
        rel_path = p.relative_to(NOTES).as_posix()
        files[rel_path] = p.read_bytes()
    
    if not files:
        raise HTTPException(400, "No notes to publish")
    
    results = {}
    
    # Publish to GitHub
    if github_connected and HAS_GIT:
        try:
            token_data = json.loads(GITHUB_TOKEN_PATH.read_text())
            token = token_data["access_token"]
            cfg = load_config().get("github", {})
            repo_url = cfg.get("repo_url")
            branch = cfg.get("branch", "main")
            
            if not repo_url:
                results["github"] = "Error: repo_url not configured"
            else:
                cache = BASE / ".git_cache"
                if cache.exists():
                    shutil.rmtree(cache)
                auth_url = repo_url.replace("https://", f"https://{token}@")
                repo = git.Repo.clone_from(auth_url, cache, branch=branch)
                
                for rel_path, content in files.items():
                    dest = cache / rel_path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(content)
                
                repo.git.add(A=True)
                if repo.is_dirty():
                    repo.index.commit(f"Publish {len(files)} notes")
                    repo.remote().push()
                    results["github"] = f"✅ Pushed {len(files)} files"
                else:
                    results["github"] = "✅ Up to date"
        except Exception as e:
            results["github"] = f"Error: {e}"
    
    # Publish to Dropbox
    if dropbox_connected:
        if not HAS_DROPBOX:
            results["dropbox"] = "Error: Dropbox SDK not installed (pip install dropbox)"
        else:
            try:
                token_data = json.loads(DROPBOX_TOKEN_PATH.read_text())
                dbx = dbx_sdk.Dropbox(token_data["access_token"])
                
                # Create Lectura folder if needed
                try:
                    dbx.files_get_metadata("/Lectura")
                except:
                    dbx.files_create_folder_v2("/Lectura")
                
                # Upload files preserving folder structure
                for rel_path, content in files.items():
                    dropbox_path = f"/Lectura/{rel_path}"
                    # Create parent folders if needed
                    parts = rel_path.split("/")
                    if len(parts) > 1:
                        for i in range(1, len(parts)):
                            folder_path = f"/Lectura/{'/'.join(parts[:i])}"
                            try:
                                dbx.files_create_folder_v2(folder_path)
                            except:
                                pass
                    dbx.files_upload(content, dropbox_path, mode=dbx_sdk.files.WriteMode.overwrite)
                results["dropbox"] = f"✅ Uploaded {len(files)} files to /Lectura/"
            except Exception as e:
                logger.error(f"Dropbox publish error: {e}")
                results["dropbox"] = f"Error: {str(e)}"
    
    # Publish to Google Drive
    if gdrive_connected and HAS_GDRIVE:
        try:
            creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_PATH), GDRIVE_SCOPES)
            service = gdrive_build("drive", "v3", credentials=creds)
            
            # Find or create root folder
            results_list = service.files().list(q="name='Lectura' and mimeType='application/vnd.google-apps.folder' and trashed=false", fields="files(id)").execute()
            if results_list.get("files"):
                root_id = results_list["files"][0]["id"]
            else:
                root_meta = {"name": "Lectura", "mimeType": "application/vnd.google-apps.folder"}
                root_folder = service.files().create(body=root_meta, fields="id").execute()
                root_id = root_folder["id"]
            
            # Helper to get or create folder
            folder_cache = {".": root_id}
            def get_folder_id(path):
                if path in folder_cache:
                    return folder_cache[path]
                parent_path = "/".join(path.split("/")[:-1]) or "."
                parent_id = get_folder_id(parent_path)
                folder_name = path.split("/")[-1]
                q = f"name='{folder_name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
                res = service.files().list(q=q, fields="files(id)").execute()
                if res.get("files"):
                    folder_id = res["files"][0]["id"]
                else:
                    meta = {"name": folder_name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]}
                    folder = service.files().create(body=meta, fields="id").execute()
                    folder_id = folder["id"]
                folder_cache[path] = folder_id
                return folder_id
            
            # Upload files preserving folder structure
            for rel_path, content in files.items():
                parts = rel_path.split("/")
                if len(parts) > 1:
                    folder_path = "/".join(parts[:-1])
                    parent_id = get_folder_id(folder_path)
                else:
                    parent_id = root_id
                
                file_name = parts[-1]
                media = MediaIoBaseUpload(io.BytesIO(content), mimetype="text/markdown")
                file_meta = {"name": file_name, "parents": [parent_id]}
                service.files().create(body=file_meta, media_body=media).execute()
            
            results["gdrive"] = f"✅ Uploaded {len(files)} files to Lectura/"
        except Exception as e:
            results["gdrive"] = f"Error: {e}"
    
    return {"published": len(files), "results": results}


# ── config ─────────────────────────────────────────────────────────────────────

@app.get("/config")
async def get_config():
    cfg = load_config()
    if "github" in cfg:
        cfg["github"]["token"] = "***" if cfg["github"].get("token") else ""
    gdrive_connected = GDRIVE_TOKEN_PATH.exists()
    cfg.setdefault("gdrive", {})["connected"] = gdrive_connected
    return cfg


@app.post("/config")
async def post_config(body: ConfigBody):
    existing = load_config()
    if body.config.get("github", {}).get("token") == "***":
        body.config["github"]["token"] = existing.get("github", {}).get("token", "")
    # preserve gdrive connected state
    body.config.setdefault("gdrive", {}).pop("connected", None)
    save_config(body.config)
    return {"saved": True}
