const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolderDialog: (defaultPath) => ipcRenderer.invoke('open-folder-dialog', defaultPath),
  createNewFileDialog: (defaultPath) => ipcRenderer.invoke('create-new-file-dialog', defaultPath),
  createNewFolderDialog: (defaultPath) => ipcRenderer.invoke('create-new-folder-dialog', defaultPath)
});
