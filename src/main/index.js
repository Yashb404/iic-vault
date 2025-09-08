const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const DatabaseManager = require('./services/database-manager');

let dbManager;

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.webContents.openDevTools();
};

const handleFileOpen = async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
  });
  if (!canceled && filePaths && filePaths.length > 0) {
    return filePaths;
  }
  return undefined;
};

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'vault.db');
  dbManager = new DatabaseManager(dbPath);

  try {
    await dbManager.initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    app.quit();
    return;
  }

  ipcMain.handle('dialog:openFile', handleFileOpen);

  // IPC: User login
  ipcMain.handle('user:login', async (_event, payload) => {
    try {
      const { username, password } = payload || {};
      if (!username || !password) return null;
      const isValid = await dbManager.verifyPassword(username, password);
      if (!isValid) return null;
      const user = await dbManager.getUserByUsername(username);
      if (!user) return null;
      return { id: user.id, username: user.username, role: user.role };
    } catch (error) {
      console.error('user:login failed:', error);
      throw error;
    }
  });

  // IPC: Get files
  ipcMain.handle('files:get', async () => {
    try {
      const files = await dbManager.getFiles();
      return files;
    } catch (error) {
      console.error('files:get failed:', error);
      return [];
    }
  });

  // IPC: Add file(s)
  ipcMain.handle('file:add', async () => {
    try {
      const filePaths = await handleFileOpen();
      if (!filePaths || filePaths.length === 0) {
        return { success: false, files: [], message: 'User canceled file selection.' };
      }
      const added = [];
      for (let i = 0; i < filePaths.length; i += 1) {
        const fullPath = filePaths[i];
        const originalName = path.basename(fullPath);
        const id = `file-${Date.now()}-${i}`;
        const encryptedName = `${originalName}.enc`;
        // For now, assign to default admin; in real app, use current user
        await dbManager.addFile({ id, originalName, encryptedName, ownerId: 'default-admin' });
        added.push({ id, originalName, encryptedName });
      }
      return { success: true, files: added, message: '' };
    } catch (error) {
      console.error('file:add failed:', error);
      return { success: false, files: [], message: 'Failed to add file(s).' };
    }
  });

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