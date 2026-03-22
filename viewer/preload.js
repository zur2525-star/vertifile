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
  onTriggerSaveAs: (callback) => {
    ipcRenderer.on('trigger-save-as', () => callback());
  },
  onTriggerPrint: (callback) => {
    ipcRenderer.on('trigger-print', () => callback());
  },
  onTriggerProperties: (callback) => {
    ipcRenderer.on('trigger-properties', () => callback());
  },
  onTriggerZoomIn: (callback) => {
    ipcRenderer.on('trigger-zoom-in', () => callback());
  },
  onTriggerZoomOut: (callback) => {
    ipcRenderer.on('trigger-zoom-out', () => callback());
  },
  onTriggerFit: (callback) => {
    ipcRenderer.on('trigger-fit', () => callback());
  },
  // Request file open dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  // Request reading a file (drag & drop)
  readPvfFile: (path) => ipcRenderer.invoke('read-pvf-file', path),
  // Save As
  saveAs: (fileName, content) => ipcRenderer.invoke('save-as', fileName, content),
  // Copy to clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-clipboard', text),
  // Open URL in browser
  openInBrowser: (url) => ipcRenderer.invoke('open-browser', url)
});
