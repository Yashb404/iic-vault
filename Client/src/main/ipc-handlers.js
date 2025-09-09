const { ipcMain, dialog, app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const { encryptFile } = require('./services/crypto-engine');
const api = require('./services/api-services');

let currentUser = null;

function registerIpcHandlers(dbManager, mainWindow) {
  ipcMain.handle('user:login', async (event, { username, password }) => {
    try {
      // First try local database login
      const user = await dbManager.getUserByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }
      
      const isValidPassword = await dbManager.verifyPassword(username, password);
      if (!isValidPassword) {
        throw new Error('Invalid password');
      }
      
      currentUser = user;
      console.log(`User logged in locally: ${currentUser.username}, Role: ${currentUser.role}`);
      await dbManager.logAction(currentUser.id, 'USER_LOGIN', 'Local login successful');
      
      return { 
        id: currentUser.id, 
        username: currentUser.username, 
        role: currentUser.role, 
        token: 'local-token' // Local token for local database
      };
    } catch (err) {
      console.error('Local login failed:', err);
      return null;
    }
  });

  ipcMain.handle('files:get', async () => {
    if (!currentUser) return [];
    return await dbManager.getFiles();
  });

  // Handle file dialog requests from renderer
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'] },
        { name: 'Spreadsheets', extensions: ['xls', 'xlsx', 'csv'] },
      ]
    });
    
    if (canceled || !filePaths || filePaths.length === 0) {
      return null;
    }
    
    return filePaths[0]; // Return the first selected file path
  });

  ipcMain.handle('file:add', async (event, { password }) => {
    if (!currentUser) throw new Error('Authentication required.');

    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return { success: false, message: 'File selection canceled.' };

    return ipcMain.handle('file:addPath')._listener(event, { password, filePath: filePaths[0] });
  });

  // New: upload a specific file path (from drag & drop or file picker in renderer)
  ipcMain.handle('file:addPath', async (event, { password, filePath }) => {
    if (!currentUser) throw new Error('Authentication required.');
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, message: 'Invalid file path.' };
    }

    const inputPath = filePath;
    const originalName = path.basename(inputPath);
    const fileId = `file-${Date.now()}`;
    const encryptedName = `${fileId}.enc`;

    // Create encrypted files directory in user data
    const encryptedDir = path.join(app.getPath('userData'), 'encrypted');
    if (!fs.existsSync(encryptedDir)) fs.mkdirSync(encryptedDir, { recursive: true });
    const encryptedPath = path.join(encryptedDir, encryptedName);

    try {
      // 1) Encrypt file to local encrypted directory
      await encryptFile(password, inputPath, encryptedPath);

      // 2) Save local metadata
      await dbManager.addFile({
        id: fileId,
        originalName,
        encryptedName: encryptedPath, // Store full path for local access
        ownerId: currentUser.id,
      });
      
      await dbManager.logAction(currentUser.id, 'FILE_ENCRYPT', `Uploaded: ${originalName} -> ${encryptedName}`);
      
      return { 
        success: true, 
        fileId,
        originalName,
        encryptedPath,
        files: await dbManager.getFiles() 
      };
    } catch (error) {
      console.error('Failed to add/encrypt file:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { registerIpcHandlers };


