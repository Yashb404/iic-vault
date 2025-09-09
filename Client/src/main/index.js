const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const DatabaseManager = require('./services/database-manager');
const { registerIpcHandlers } = require('./ipc-handlers');

try { require('dotenv').config(); } catch (_) {}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Note: Using system fonts to avoid CSP issues

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.webContents.openDevTools();

  // Register IPC handlers after window is created
  registerIpcHandlers(dbManager, mainWindow);
};

// File dialog is now handled in ipc-handlers.js

const dbPath = path.join(app.getPath('userData'), 'vault.db');
const dbManager = new DatabaseManager(dbPath);

app.whenReady().then(async () => {
  try {
    await dbManager.initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    app.quit();
    return;
  }

  // IPC handlers are registered in registerIpcHandlers function

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
