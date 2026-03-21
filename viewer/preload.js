const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pvfBridge', {
  // Receive PVF content from main process
  onPvfLoaded: (callback) => {
    ipcRenderer.on('pvf-loaded', (event, data) => callback(data));
  },
  onPvfError: (callback) => {
    ipcRenderer.on('pvf-error', (event, msg) => callback(msg));
  },
  onTriggerOpen: (callback) => {
    ipcRenderer.on('trigger-open', () => callback());
  },
  // Request file open dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  // Request reading a file (drag & drop)
  readPvfFile: (path) => ipcRenderer.invoke('read-pvf-file', path),
  // Save As
  saveAs: (fileName, content) => ipcRenderer.invoke('save-as', fileName, content)
});
