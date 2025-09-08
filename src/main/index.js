const { app, BrowserWindow, ipcMain, dialog } = require('electron');

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
    properties: ['openFile'],
  });
  if (!canceled && filePaths && filePaths.length > 0) {
    console.log('Selected file:', filePaths[0]);
    return filePaths[0];
  }
  return undefined;
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('dialog:openFile', handleFileOpen);

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


