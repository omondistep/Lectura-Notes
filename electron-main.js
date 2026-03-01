const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mainWindow;
let pythonProcess;

function startPython() {
  const isWin = os.platform() === 'win32';
  const pythonCmd = isWin 
    ? path.join(__dirname, 'venv', 'Scripts', 'python.exe')
    : path.join(__dirname, 'venv', 'bin', 'python3');
  
  pythonProcess = spawn(pythonCmd, ['main.py'], {
    cwd: __dirname,
    stdio: 'pipe'
  });
  
  pythonProcess.stdout.on('data', (data) => console.log(`[Python] ${data}`));
  pythonProcess.stderr.on('data', (data) => console.error(`[Python] ${data}`));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Lectura',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  setTimeout(() => {
    mainWindow.loadURL('http://localhost:8000');
  }, 3000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startPython();
  createWindow();
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
