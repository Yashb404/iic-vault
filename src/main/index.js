const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const DatabaseManager = require('./services/database-manager');
const { registerIpcHandlers } = require('./ipc-handlers');

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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});