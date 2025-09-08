const { ipcMain, dialog, app } = require('electron');
const { encryptFile, decryptFile } = require('./services/crypto-engine');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');
const fs = require('node:fs');

let currentUser = null;

function registerIpcHandlers(dbManager, mainWindow) {
  ipcMain.handle('user:login', async (event, { username, password }) => {
    const user = await dbManager.getUserByUsername(username);
    if (!user) return null;

    const isValid = await dbManager.verifyPassword(username, password);
    if (isValid) {
      currentUser = user;
      console.log(`User logged in: ${currentUser.username}, Role: ${currentUser.role}`);
      await dbManager.logAction(currentUser.id, 'USER_LOGIN');
      return currentUser;
    }

    await dbManager.logAction('system', 'LOGIN_FAILED', `Attempt for user: ${username}`);
    return null;
  });

  ipcMain.handle('files:get', () => {
    if (!currentUser) return [];
    return dbManager.getFiles();
  });

  ipcMain.handle('file:add', async (event, { password }) => {
    if (!currentUser) throw new Error('Authentication required.');

    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return { success: false, message: 'File selection canceled.' };

    const inputPath = filePaths[0];
    const originalName = path.basename(inputPath);
    const fileId = uuidv4();

    const vaultDir = path.join(app.getPath('userData'), 'vault');
    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true });
    }
    const outputPath = path.join(vaultDir, `${fileId}.enc`);

    try {
      await encryptFile(inputPath, outputPath, password);
      await dbManager.addFile({
        id: fileId,
        originalName,
        encryptedName: `${fileId}.enc`,
        ownerId: currentUser.id,
      });
      await dbManager.logAction(currentUser.id, 'FILE_ENCRYPT', `File: ${originalName}`);
      return { success: true, files: await dbManager.getFiles() };
    } catch (error) {
      console.error('Failed to add and encrypt file:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { registerIpcHandlers };


