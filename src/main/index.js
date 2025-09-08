const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

  // IPC: User login
  ipcMain.handle('user:login', async (_event, payload) => {
    const { username, password } = payload || {};
    if (!username || !password) return null;
    const isValid = await dbManager.verifyPassword(username, password);
    if (!isValid) return null;
    const user = await dbManager.getUserByUsername(username);
    return user ? { id: user.id, username: user.username, role: user.role } : null;
  });

  // IPC: Get files
  ipcMain.handle('files:get', async () => {
    try {
      return await dbManager.getFiles();
    } catch (error) {
      console.error('files:get failed:', error);
      return [];
    }
  });

  // IPC: Add file(s)
  ipcMain.handle('file:add', async () => {
    const filePaths = await handleFileOpen();
    if (!filePaths?.length) {
      return { success: false, files: [], message: 'User canceled file selection.' };
    }
    const added = [];
    for (let i = 0; i < filePaths.length; i++) {
      const fullPath = filePaths[i];
      const originalName = path.basename(fullPath);
      const id = `file-${Date.now()}-${i}`;
      const encryptedName = `${originalName}.enc`;
      await dbManager.addFile({ id, originalName, encryptedName, ownerId: 'default-admin' });
      added.push({ id, originalName, encryptedName });
    }
    return { success: true, files: added, message: '' };
  });

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
