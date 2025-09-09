const { ipcMain, dialog, app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const { encryptFile, decryptFile } = require('./services/crypto-engine');
const api = require('./services/api-services');
const SyncService = require('./services/sync-service');

let currentUser = null;
let syncService = null;

function registerIpcHandlers(dbManager, mainWindow) {
  // Initialize sync service
  syncService = new SyncService(dbManager);
  ipcMain.handle('user:login', async (event, { username, password }) => {
    try {
      const { token, user } = await api.login(username, password);
      currentUser = { ...user, token };
      console.log(`User logged in: ${currentUser.username}, Role: ${currentUser.role}`);
      await dbManager.logAction(currentUser.id, 'USER_LOGIN');
      
      // Set current user in sync service
      syncService.setCurrentUser(currentUser);
      
      return { id: currentUser.id, username: currentUser.username, role: currentUser.role, token: currentUser.token };
    } catch (err) {
      console.error('Server login failed:', err);
      await dbManager.logAction('system', 'LOGIN_FAILED', `Server login failed for user: ${username}`);
      return null;
    }
  });

  ipcMain.handle('files:get', () => {
    if (!currentUser) return [];
    return dbManager.getFiles();
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
    const fileId = uuidv4();
    const encryptedName = `${fileId}.enc`;

    const tmpDir = path.join(app.getPath('userData'), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tempEncryptedPath = path.join(tmpDir, encryptedName);

    try {
      // 1) Encrypt to temp
      await encryptFile(password, inputPath, tempEncryptedPath);

      // 2) Read encrypted file to memory buffer
      const encryptedBuffer = await fsp.readFile(tempEncryptedPath);

      // 3) Request signed upload URL from your server
      const { signedUrl, path: remotePath } = await api.getSignedUploadUrl(encryptedName, currentUser.token);

      // 4) PUT the encrypted buffer to Supabase signed URL
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encryptedBuffer,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // 5) Save local metadata
      await dbManager.addFile({
        id: fileId,
        originalName,
        encryptedName,
        ownerId: currentUser.id,
      });
      await dbManager.logAction(currentUser.id, 'FILE_ENCRYPT', `Uploaded: ${originalName} -> ${remotePath}`);

      // 6) Persist central metadata on API server
      await api.persistMetadata({
        id: fileId,
        originalName,
        encryptedName,
        storagePath: remotePath,
        version: 1,
        lastModifiedUTC: new Date().toISOString(),
      }, currentUser.token);

      try { await fsp.unlink(tempEncryptedPath); } catch (_) {}
      return { success: true, files: await dbManager.getFiles() };
    } catch (error) {
      console.error('Failed to add/encrypt/upload file:', error);
      return { success: false, message: error.message };
    }
  });

  // User registration
  ipcMain.handle('user:register', async (event, { username, password, role = 'user' }) => {
    try {
      const apiBase = process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Registration failed (${res.status})`);
      }
      return { success: true, message: 'User registered successfully' };
    } catch (error) {
      console.error('Registration failed:', error);
      return { success: false, message: error.message };
    }
  });

  // User logout
  ipcMain.handle('user:logout', async () => {
    if (currentUser) {
      await dbManager.logAction(currentUser.id, 'USER_LOGOUT');
      currentUser = null;
      syncService.setCurrentUser(null);
    }
    return { success: true };
  });

  // File download and decryption
  ipcMain.handle('file:download', async (event, { fileId, password }) => {
    if (!currentUser) throw new Error('Authentication required.');

    try {
      const file = await dbManager.getFileById(fileId);
      if (!file) throw new Error('File not found');

      // Get signed download URL from server
      const { signedUrl } = await api.getDownloadUrl(file.storagePath, currentUser.token);

      // Download encrypted file
      const encryptedRes = await fetch(signedUrl);
      if (!encryptedRes.ok) throw new Error(`Download failed (${encryptedRes.status})`);
      const encryptedBuffer = await encryptedRes.arrayBuffer();

      // Create temporary file for decryption
      const tmpDir = path.join(app.getPath('userData'), 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tempEncryptedPath = path.join(tmpDir, file.encryptedName);
      const tempDecryptedPath = path.join(tmpDir, file.originalName);

      await fsp.writeFile(tempEncryptedPath, Buffer.from(encryptedBuffer));

      // Decrypt file
      await decryptFile(password, tempEncryptedPath, tempDecryptedPath);

      // Show save dialog
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: file.originalName,
        filters: [{ name: 'All Files', extensions: ['*'] }]
      });

      if (canceled) {
        await fsp.unlink(tempDecryptedPath).catch(() => {});
        return { success: false, message: 'Download canceled' };
      }

      // Move decrypted file to chosen location
      await fsp.rename(tempDecryptedPath, filePath);

      // Cleanup
      await fsp.unlink(tempEncryptedPath).catch(() => {});
      await dbManager.logAction(currentUser.id, 'FILE_DOWNLOAD', `Downloaded: ${file.originalName}`);

      return { success: true, message: 'File downloaded successfully' };
    } catch (error) {
      console.error('Download failed:', error);
      return { success: false, message: error.message };
    }
  });

  // File deletion
  ipcMain.handle('file:delete', async (event, { fileId }) => {
    if (!currentUser) throw new Error('Authentication required.');

    try {
      const file = await dbManager.getFileById(fileId);
      if (!file) throw new Error('File not found');

      // Remove from local database
      await dbManager.deleteFile(fileId);
      await dbManager.logAction(currentUser.id, 'FILE_DELETE', `Deleted: ${file.originalName}`);

      return { success: true, files: await dbManager.getFiles() };
    } catch (error) {
      console.error('Delete failed:', error);
      return { success: false, message: error.message };
    }
  });

  // File sharing
  ipcMain.handle('file:share', async (event, { fileId, userIds }) => {
    if (!currentUser) throw new Error('Authentication required.');

    try {
      const file = await dbManager.getFileById(fileId);
      if (!file) throw new Error('File not found');

      // Grant permissions to specified users
      for (const userId of userIds) {
        await dbManager.grantPermission(fileId, userId, 'read');
      }

      await dbManager.logAction(currentUser.id, 'FILE_SHARE', `Shared: ${file.originalName} with ${userIds.length} users`);

      return { success: true, message: 'File shared successfully' };
    } catch (error) {
      console.error('Share failed:', error);
      return { success: false, message: error.message };
    }
  });

  // Files sync with server
  ipcMain.handle('files:sync', async () => {
    if (!currentUser) return { success: false, message: 'Authentication required.' };

    try {
      await syncService.runSync();
      await dbManager.logAction(currentUser.id, 'FILES_SYNC', 'Synced with server');
      return { success: true, files: await dbManager.getFiles() };
    } catch (error) {
      console.error('Sync failed:', error);
      return { success: false, message: error.message };
    }
  });

  // Audit logs
  ipcMain.handle('audit:get', async (event, filters = {}) => {
    if (!currentUser) return [];

    try {
      const logs = await dbManager.getAuditLogs(filters);
      return logs;
    } catch (error) {
      console.error('Failed to get audit logs:', error);
      return [];
    }
  });

  // Get current user info
  ipcMain.handle('app:getUserInfo', () => {
    return currentUser ? {
      id: currentUser.id,
      username: currentUser.username,
      role: currentUser.role
    } : null;
  });

  // Get sync status
  ipcMain.handle('app:getSyncStatus', async () => {
    if (!currentUser) return { status: 'disconnected' };

    try {
      // Check server connectivity
      const apiBase = process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/health`);
      const isOnline = res.ok;
      
      return {
        status: isOnline ? 'synced' : 'offline',
        lastSync: new Date().toISOString(),
        filesCount: (await dbManager.getFiles()).length
      };
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  });

  // Save file dialog
  ipcMain.handle('dialog:saveFile', async (event, options = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog(options);
    return { canceled, filePath };
  });
}

module.exports = { registerIpcHandlers };


