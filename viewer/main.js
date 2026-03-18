const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

// Disable hardware acceleration for stability
app.disableHardwareAcceleration();

// Maximum PVF file size: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Pending file from OS open-file event (before window is ready)
let pendingFile = null;
let mainWindow = null;

// Single instance lock — prevent multiple windows on double-click
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to open another instance — focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      // Check if a .pvf file was passed
      const pvfArg = commandLine.find(arg => arg.endsWith('.pvf') && !arg.startsWith('-'));
      if (pvfArg) loadPvfFile(pvfArg);
    }
  });
}

/**
 * Validate that a file path is safe to read:
 * - Must have .pvf extension
 * - Must resolve to a real path (no symlink tricks)
 * - Must not be a directory
 */
function validatePvfPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pvf') {
    return { valid: false, error: 'Only .pvf files can be opened.' };
  }

  try {
    const realPath = fs.realpathSync(filePath);
    const realExt = path.extname(realPath).toLowerCase();
    if (realExt !== '.pvf') {
      return { valid: false, error: 'Resolved path is not a .pvf file.' };
    }
    const stat = fs.statSync(realPath);
    if (stat.isDirectory()) {
      return { valid: false, error: 'Path is a directory, not a file.' };
    }
    if (stat.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.` };
    }
    return { valid: true, realPath };
  } catch (err) {
    return { valid: false, error: 'Cannot access file: ' + err.message };
  }
}

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
      webSecurity: true,
      devTools: !app.isPackaged,
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

// Load a .pvf file into the viewer (async to avoid blocking main process)
async function loadPvfFile(filePath) {
  if (!mainWindow) return;

  try {
    // Validate path security
    const validation = validatePvfPath(filePath);
    if (!validation.valid) {
      mainWindow.webContents.send('pvf-error', validation.error);
      return;
    }

    const safePath = validation.realPath;
    const content = await fs.promises.readFile(safePath, 'utf-8');
    const fileName = path.basename(safePath);

    // Validate it looks like a PVF file
    if (!content.includes('Vertifile') || !content.includes('var HASH=') || !content.includes('var SIG=')) {
      mainWindow.webContents.send('pvf-error', 'Invalid PVF file — missing verification data.');
      return;
    }

    mainWindow.webContents.send('pvf-loaded', {
      content,
      fileName
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
    await loadPvfFile(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// IPC: Read file (for drag & drop) — with path validation
ipcMain.handle('read-pvf-file', async (event, filePath) => {
  if (typeof filePath !== 'string') return;
  await loadPvfFile(filePath);
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
            // Trigger open dialog via renderer
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
    pendingFile = filePath;
  }
});

// ===== Auto-update =====
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  // Don't auto-download — ask user first
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATE] New version available:', info.version);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `PVF Viewer ${info.version} is available.`,
      detail: 'Would you like to download it now?',
      buttons: ['Download', 'Later']
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[UPDATE] Downloaded:', info.version);
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

  // Check for file path from CLI args
  const filePath = process.argv.find(arg =>
    arg.endsWith('.pvf') && !arg.startsWith('-') && process.argv.indexOf(arg) > 0
  );

  const startFile = pendingFile || filePath;
  createWindow(startFile);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
