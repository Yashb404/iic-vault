const { ipcMain, dialog, app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const { encryptFile } = require('./services/crypto-engine');

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
    const encryptedName = `${fileId}.enc`;

    const tmpDir = path.join(app.getPath('userData'), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tempEncryptedPath = path.join(tmpDir, encryptedName);

    try {
      // 1) Encrypt to temp (placeholder: copy)
      await encryptFile(inputPath, tempEncryptedPath, password);

      // 2) Read encrypted file to memory buffer
      const encryptedBuffer = await fsp.readFile(tempEncryptedPath);

      // 3) Request signed upload URL from your server
      const apiBase = process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001';
      const signedRes = await fetch(`${apiBase}/files/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: encryptedName }),
      });
      if (!signedRes.ok) throw new Error(`Failed to get signed URL (${signedRes.status})`);
      const { signedUrl, path: remotePath } = await signedRes.json();

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

      // 6) Optionally notify server to persist central metadata
      // await fetch(`${apiBase}/files/metadata`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ... }) })

      try { await fsp.unlink(tempEncryptedPath); } catch (_) {}
      return { success: true, files: await dbManager.getFiles() };
    } catch (error) {
      console.error('Failed to add/encrypt/upload file:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { registerIpcHandlers };


