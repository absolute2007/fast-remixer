const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
});
