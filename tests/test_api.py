"""
25. Testing - API Tests for Lectura

Run with: pytest tests/ -v
"""
import pytest
from fastapi.testclient import TestClient
from pathlib import Path
import tempfile
import shutil
import json
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app, NOTES, CONFIG_PATH


@pytest.fixture
def client():
    """Create a test client with a temporary notes directory."""
    # Create temp directory for tests
    temp_dir = Path(tempfile.mkdtemp())
    
    # Store original paths
    original_notes = NOTES
    original_config = CONFIG_PATH
    
    # Patch paths
    import main
    main.NOTES = temp_dir / "notes"
    main.NOTES.mkdir(exist_ok=True)
    main.CONFIG_PATH = temp_dir / "config.json"
    main.CONFIG_PATH.write_text(json.dumps({
        "github": {"repo_url": "", "branch": "main", "token": ""},
        "gdrive": {"enabled": False},
        "dropbox": {"enabled": False, "token": ""}
    }))
    
    # Create test client
    with TestClient(app) as test_client:
        yield test_client
    
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)
    main.NOTES = original_notes
    main.CONFIG_PATH = original_config


class TestFileOperations:
    """Tests for file CRUD operations."""
    
    def test_list_files_empty(self, client):
        """Test listing files when directory is empty."""
        response = client.get("/files")
        assert response.status_code == 200
        data = response.json()
        assert data["files"] == []
        assert data["folders"] == []
    
    def test_create_file(self, client):
        """Test creating a new file."""
        response = client.post(
            "/files/test.md",
            json={"content": "# Test Note\n\nThis is a test."}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["saved"] == "test.md"
        assert data["type"] == "file"
    
    def test_read_file(self, client):
        """Test reading a file."""
        # Create file first
        client.post("/files/read-test.md", json={"content": "Read me"})
        
        # Read it back
        response = client.get("/files/read-test.md")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "read-test.md"
        assert data["content"] == "Read me"
    
    def test_read_nonexistent_file(self, client):
        """Test reading a file that doesn't exist."""
        response = client.get("/files/nonexistent.md")
        assert response.status_code == 404
    
    def test_update_file(self, client):
        """Test updating an existing file."""
        # Create file
        client.post("/files/update-test.md", json={"content": "Original"})
        
        # Update it
        response = client.post(
            "/files/update-test.md",
            json={"content": "Updated content"}
        )
        assert response.status_code == 200
        
        # Verify update
        response = client.get("/files/update-test.md")
        assert response.json()["content"] == "Updated content"
    
    def test_delete_file(self, client):
        """Test deleting a file."""
        # Create file
        client.post("/files/delete-test.md", json={"content": "To be deleted"})
        
        # Delete it
        response = client.delete("/files/delete-test.md")
        assert response.status_code == 200
        assert response.json()["deleted"] == "delete-test.md"
        
        # Verify deletion
        response = client.get("/files/delete-test.md")
        assert response.status_code == 404
    
    def test_create_folder(self, client):
        """Test creating a folder."""
        response = client.post("/folders/my-folder")
        assert response.status_code == 200
        assert response.json()["created"] == "my-folder"
    
    def test_create_nested_file(self, client):
        """Test creating a file in a nested folder."""
        # Create folder first
        client.post("/folders/nested")
        
        # Create file in folder
        response = client.post(
            "/files/nested/note.md",
            json={"content": "Nested note"}
        )
        assert response.status_code == 200
        
        # Verify file exists
        response = client.get("/files/nested/note.md")
        assert response.status_code == 200
        assert response.json()["content"] == "Nested note"


class TestSearch:
    """Tests for search functionality."""
    
    def test_search_empty_query(self, client):
        """Test search with empty query."""
        response = client.get("/search?q=")
        assert response.status_code == 200
        assert response.json()["results"] == []
    
    def test_search_find_content(self, client):
        """Test searching for content."""
        # Create files
        client.post("/files/note1.md", json={"content": "Hello world"})
        client.post("/files/note2.md", json={"content": "Goodbye world"})
        client.post("/files/note3.md", json={"content": "Hello again"})
        
        # Search for "Hello"
        response = client.get("/search?q=Hello")
        assert response.status_code == 200
        results = response.json()["results"]
        assert len(results) == 2
        
        # Verify results contain the search term
        for r in results:
            assert "Hello" in r["snippet"] or "hello" in r["snippet"].lower()
    
    def test_search_no_results(self, client):
        """Test search with no matches."""
        client.post("/files/test.md", json={"content": "Some content"})
        
        response = client.get("/search?q=nonexistent")
        assert response.status_code == 200
        assert response.json()["results"] == []


class TestConfig:
    """Tests for configuration management."""
    
    def test_get_config(self, client):
        """Test getting configuration."""
        response = client.get("/config")
        assert response.status_code == 200
        data = response.json()
        assert "github" in data
        assert "dropbox" in data
        assert "gdrive" in data
    
    def test_update_config(self, client):
        """Test updating configuration."""
        response = client.post(
            "/config",
            json={
                "config": {
                    "github": {
                        "repo_url": "https://github.com/test/notes",
                        "branch": "main",
                        "token": "test-token"
                    },
                    "dropbox": {"enabled": False, "token": ""},
                    "gdrive": {"enabled": False}
                }
            }
        )
        assert response.status_code == 200
        
        # Verify update
        response = client.get("/config")
        data = response.json()
        assert data["github"]["repo_url"] == "https://github.com/test/notes"
        # Token should be masked
        assert data["github"]["token"] == "***"


class TestImport:
    """Tests for file import functionality."""
    
    def test_import_markdown(self, client):
        """Test importing a markdown file."""
        content = b"# Imported Note\n\nThis was imported."
        response = client.post(
            "/import",
            files={"file": ("test.md", content, "text/markdown")}
        )
        assert response.status_code == 200
        data = response.json()
        assert "# Imported Note" in data["content"]
    
    def test_import_text(self, client):
        """Test importing a plain text file."""
        content = b"Plain text content"
        response = client.post(
            "/import",
            files={"file": ("test.txt", content, "text/plain")}
        )
        assert response.status_code == 200
        assert response.json()["content"] == "Plain text content"


class TestExport:
    """Tests for export functionality."""
    
    def test_download_markdown(self, client):
        """Test downloading a markdown file."""
        # Create file
        client.post("/files/export-test.md", json={"content": "Export me"})
        
        # Download it
        response = client.get("/download/md/export-test.md")
        assert response.status_code == 200
        assert response.content == b"Export me"
    
    def test_export_html(self, client):
        """Test exporting to HTML."""
        response = client.post(
            "/export/html/test.md",
            json={"html": "<h1>Test</h1>"}
        )
        assert response.status_code == 200
        assert b"<!DOCTYPE html>" in response.content
        assert b"<h1>Test</h1>" in response.content


class TestSecurity:
    """Tests for security features."""
    
    def test_path_traversal_prevention(self, client):
        """Test that path traversal attacks are prevented."""
        # This should not allow reading files outside notes directory
        response = client.get("/files/../config.json")
        # Should either return 404 or 403, not the actual config
        assert response.status_code in [403, 404, 400]
    
    def test_hidden_file_access(self, client):
        """Test that hidden files are handled properly."""
        response = client.get("/files/.hidden")
        # Should not find or should be forbidden
        assert response.status_code in [403, 404]


    def test_path_traversal_deep(self, client):
        """Test deeper path traversal attempts."""
        response = client.get("/files/foo/../../config.json")
        assert response.status_code in [403, 404, 400]

    def test_path_traversal_save(self, client):
        """Test path traversal on save endpoint."""
        response = client.post(
            "/files/../evil.md",
            json={"content": "evil"}
        )
        assert response.status_code in [403, 404, 400]


class TestPublishAll:
    """Tests for the publish-all endpoint."""

    def test_publish_all_no_cloud(self, client):
        """Test publish all with no cloud service connected."""
        response = client.post("/publish")
        assert response.status_code == 400


class TestFolderOperations:
    """Tests for folder rename and delete."""

    def test_rename_folder(self, client):
        """Test renaming a folder."""
        client.post("/folders/old-name")
        response = client.put("/folders/old-name?new_name=new-name")
        assert response.status_code == 200
        assert response.json()["to"] == "new-name"

    def test_delete_folder(self, client):
        """Test deleting a folder."""
        client.post("/folders/to-delete")
        # Add a file inside
        client.post("/files/to-delete/note.md", json={"content": "hi"})
        response = client.delete("/files/to-delete")
        assert response.status_code == 200
        assert response.json()["type"] == "folder"


class TestErrorHandling:
    """Tests for error handling."""
    
    def test_invalid_json(self, client):
        """Test handling of invalid JSON in request body."""
        response = client.post(
            "/files/test.md",
            content="not json",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422  # Unprocessable Entity
    
    def test_missing_required_field(self, client):
        """Test handling of missing required fields."""
        response = client.post("/files/test.md", json={})
        assert response.status_code == 422  # Unprocessable Entity


if __name__ == "__main__":
    pytest.main([__file__, "-v"])