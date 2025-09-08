const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const DatabaseManager = require('./services/database-manager');
const { registerIpcHandlers } = require('./ipc-handlers');

try { require('dotenv').config(); } catch (_) {}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.webContents.openDevTools();

  registerIpcHandlers(dbManager, mainWindow);
};

const handleFileOpen = async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
  });
  if (!canceled && filePaths?.length > 0) {
    return filePaths;
  }
  return undefined;
};

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

  ipcMain.handle('dialog:openFile', handleFileOpen);

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
