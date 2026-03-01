#!/usr/bin/env python3
import subprocess
import webbrowser
import time
import sys
import os
from pathlib import Path

def main():
    app_dir = Path(__file__).parent
    os.chdir(app_dir)
    
    # Start server
    server = subprocess.Popen(
        [sys.executable, "main.py"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    # Wait for server
    time.sleep(2)
    
    # Open browser
    webbrowser.open("http://localhost:8000")
    
    try:
        server.wait()
    except KeyboardInterrupt:
        server.terminate()

if __name__ == "__main__":
    main()
