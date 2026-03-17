const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

// Disable hardware acceleration for stability
app.disableHardwareAcceleration();

let mainWindow = null;

function createWindow(pvfPath) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    title: 'PVF Viewer',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged, // DevTools only in development
      sandbox: true
    },
    show: false
  });

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the viewer shell
  mainWindow.loadFile('viewer.html');

  // If a PVF path was provided, load it once the viewer is ready
  if (pvfPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      loadPvfFile(pvfPath);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Load a .pvf file into the viewer
function loadPvfFile(filePath) {
  if (!mainWindow) return;

  try {
    if (!fs.existsSync(filePath)) {
      mainWindow.webContents.send('pvf-error', 'File not found: ' + filePath);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    // Validate it looks like a PVF file
    if (!content.includes('Vertifile') || !content.includes('var HASH=') || !content.includes('var SIG=')) {
      mainWindow.webContents.send('pvf-error', 'Invalid PVF file — missing verification data.');
      return;
    }

    mainWindow.webContents.send('pvf-loaded', {
      content,
      fileName,
      filePath
    });

    mainWindow.setTitle(`${fileName} — PVF Viewer`);
  } catch (err) {
    mainWindow.webContents.send('pvf-error', 'Failed to read file: ' + err.message);
  }
}

// IPC: Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PVF Document',
    filters: [
      { name: 'PVF Documents', extensions: ['pvf'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    loadPvfFile(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// IPC: Read file (for drag & drop)
ipcMain.handle('read-pvf-file', async (event, filePath) => {
  loadPvfFile(filePath);
});

// App menu
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PVF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            ipcMain.emit('open-file-dialog');
            // Trigger via renderer
            if (mainWindow) mainWindow.webContents.send('trigger-open');
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Handle file open from OS (double-click .pvf)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    loadPvfFile(filePath);
  } else {
    // Store for when window is ready
    app._pendingFile = filePath;
  }
});

// ===== Auto-update =====
function setupAutoUpdate() {
  if (!app.isPackaged) return; // Skip in development

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATE] New version available:', info.version);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[UPDATE] Downloaded:', info.version);
    // Notify user via dialog
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `PVF Viewer ${info.version} is ready to install.`,
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later']
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[UPDATE] Error:', err.message);
  });

  // Check for updates every 4 hours
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
}

// App lifecycle
app.whenReady().then(() => {
  buildMenu();
  setupAutoUpdate();

  // Check for file path from CLI args (e.g., `pvf-viewer document.pvf`)
  const filePath = process.argv.find(arg => arg.endsWith('.pvf') && !arg.startsWith('-'));

  // Or from macOS open-file event
  const pendingFile = app._pendingFile || filePath;

  createWindow(pendingFile);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
