# OAuth Setup Guide

## Overview
Login with GitHub, Dropbox, or Google Drive. When you click Publish, all notes and folders sync to your connected service.

## Setup Instructions

### 1. GitHub OAuth

Create `github_secrets.json` in the app directory:
```json
{
  "client_id": "your_github_client_id",
  "client_secret": "your_github_client_secret"
}
```

**Get credentials:**
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set Authorization callback URL: `http://localhost:8000/github/callback`
4. Copy Client ID and Client Secret

**Configure repo:**
- Open Settings in the app
- Enter your GitHub repo URL (e.g., `https://github.com/username/notes.git`)
- Set branch (default: `main`)
- Click "Login with GitHub"

### 2. Dropbox OAuth

Create `dropbox_secrets.json`:
```json
{
  "app_key": "your_dropbox_app_key",
  "app_secret": "your_dropbox_app_secret"
}
```

**Get credentials:**
1. Go to https://www.dropbox.com/developers/apps
2. Create app → Scoped access → Full Dropbox
3. In Settings tab, add Redirect URI: `http://localhost:8000/dropbox/callback`
4. Copy App key and App secret

**Login:**
- Open Settings → Click "Login with Dropbox"
- Notes will sync to `/notes/` folder in Dropbox

### 3. Google Drive OAuth

Create `gdrive_secrets.json`:
```json
{
  "installed": {
    "client_id": "your_client_id.apps.googleusercontent.com",
    "client_secret": "your_client_secret",
    "redirect_uris": ["http://localhost:8000/gdrive/callback"],
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token"
  }
}
```

**Get credentials:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID → Web application
3. Add Authorized redirect URI: `http://localhost:8000/gdrive/callback`
4. Enable Google Drive API: https://console.cloud.google.com/apis/library/drive.googleapis.com
5. Download JSON and format as above

**Login:**
- Open Settings → Click "Login with Google Drive"
- Notes will sync to `Lectura` folder in Drive

## Usage

1. **Login**: Open Settings (⚙) → Click login button for your preferred service
2. **Publish**: Click "▲ Publish" button → Confirm → All notes sync to cloud
3. **Status**: Settings shows connection status (✅ Connected)

## Notes

- You can connect to multiple services - publish syncs to all connected
- Local `notes/` folder is the source of truth
- GitHub requires repo URL configuration
- Dropbox and Drive work without additional config after OAuth
