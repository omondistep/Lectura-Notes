const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
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

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-new").click()')
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const folderPath = result.filePaths[0].replace(/\\/g, '/');
              mainWindow.webContents.executeJavaScript(
                `setWorkspace(${JSON.stringify(folderPath)}); void 0`
              );
            }
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.executeJavaScript('saveFile()')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.executeJavaScript('saveAs()')
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.executeJavaScript('setContent(""); currentFile = "untitled.md"; document.getElementById("filename-input").value = "untitled.md";')
        },
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-settings").click()')
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.executeJavaScript('document.querySelector(".cm-editor").cmView.view.dispatch({effects: []});document.execCommand("find")')
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow.webContents.executeJavaScript('document.execCommand("replace")')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-sidebar").click()')
        },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-toggle-preview").click()')
        },
        {
          label: 'Focus Mode',
          accelerator: 'F8',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-focus").click()')
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Shift+=',
          role: 'zoomIn'
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+Shift+-',
          role: 'zoomOut'
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+Shift+0',
          role: 'resetZoom'
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Markdown Help',
          click: () => mainWindow.webContents.executeJavaScript('document.getElementById("btn-help").click()')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Lectura',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  createMenu();

  setTimeout(() => {
    mainWindow.loadURL('http://localhost:8000');
  }, 3000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0].replace(/\\/g, '/');
  }
  return null;
});

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
