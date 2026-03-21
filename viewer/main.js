const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

let mainWindow = null;

function createWindow(pvfPath) {
  // Get screen size for smart default window
  const { screen } = require('electron');
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = Math.min(Math.round(screenW * 0.75), 1400);
  const winH = Math.min(Math.round(screenH * 0.85), 1000);

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 700,
    minHeight: 550,
    title: 'PVF Viewer',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile('viewer.html');

  if (pvfPath) {
    mainWindow.webContents.once('did-finish-load', () => loadPvfFile(pvfPath));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadPvfFile(filePath) {
  if (!mainWindow) return;
  try {
    if (!fs.existsSync(filePath)) {
      mainWindow.webContents.send('pvf-error', 'File not found: ' + filePath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pvf') {
      mainWindow.webContents.send('pvf-error', 'Only .pvf files can be opened.\n\nThis file has extension "' + ext + '"');
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    // PVF validation — must have Vertifile markers
    // After obfuscation, variable names may change, so check for multiple indicators
    var hasMagic = content.startsWith('<!--PVF:1.0-->');
    var hasVertifile = content.includes('Vertifile') || content.includes('vertifile');
    var hasHash = content.includes('var HASH=') || content.includes('pvf:hash') || content.includes('api/verify');
    var hasPvfStructure = content.includes('doc-frame') || content.includes('stamp') || content.includes('page-wrap');
    if ((!hasMagic && !hasVertifile) || (!hasHash && !hasPvfStructure)) {
      mainWindow.webContents.send('pvf-error', 'This is not a valid PVF file.\n\nOnly files created by Vertifile can be opened.');
      return;
    }

    mainWindow.webContents.send('pvf-loaded', { content, fileName });
    mainWindow.setTitle(fileName + ' — PVF Viewer');
  } catch (err) {
    mainWindow.webContents.send('pvf-error', 'Error: ' + err.message);
  }
}

ipcMain.handle('open-file-dialog', async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Open PVF Document',
    filters: [
      { name: 'PVF Documents', extensions: ['pvf'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    loadPvfFile(result.filePaths[0]);
  }
});

ipcMain.handle('read-pvf-file', async (event, filePath) => {
  if (typeof filePath === 'string') loadPvfFile(filePath);
});

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'Open PVF...', accelerator: 'CmdOrCtrl+O', click: () => { if (mainWindow) mainWindow.webContents.send('trigger-open'); } },
      { type: 'separator' }, { role: 'close' }
    ]},
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] }
  ]));
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) loadPvfFile(filePath);
  else app._pendingFile = filePath;
});

app.whenReady().then(() => {
  buildMenu();
  const filePath = process.argv.find(arg => arg.endsWith('.pvf') && !arg.startsWith('-'));
  createWindow(app._pendingFile || filePath);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
