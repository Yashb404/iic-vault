const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app } = require('electron');
const api = require('./api-services');

const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

class SyncService extends EventEmitter {
  constructor(dbManager) {
    super();
    this.dbManager = dbManager;
    this.isSyncing = false;
    this.currentUser = null;
  }

  setCurrentUser(user) { this.currentUser = user; }

  async runSync() {
    if (this.isSyncing || !this.currentUser) {
      console.log('Sync skipped (already in progress or no user).');
      return;
    }
    console.log('🚀 Starting sync process...');
    this.isSyncing = true;
    try {
      const remoteFiles = await api.syncFiles(this.currentUser.token);
      const localFiles = await this.dbManager.getFiles();

      const remoteFileMap = new Map(remoteFiles.map(f => [f.id, f]));
      const localFileMap = new Map(localFiles.map(f => [f.id, f]));

      const filesToDownload = this._getFilesToDownload(remoteFiles, localFileMap);
      const filesToUpload = this._getFilesToUpload(localFiles, remoteFileMap);

      console.log(`Sync Tasks: ${filesToDownload.length} to download, ${filesToUpload.length} to upload.`);

      for (const fileMeta of filesToDownload) {
        await this._downloadFile(fileMeta);
      }
      for (const fileMeta of filesToUpload) {
        await this._uploadFile(fileMeta);
      }
    } catch (error) {
      console.error('Sync process failed:', error);
    } finally {
      this.isSyncing = false;
      console.log('✅ Sync process finished.');
    }
  }

  _getFilesToDownload(remoteFiles, localFileMap) {
    const toDownload = [];
    for (const remoteFile of remoteFiles) {
      const localFile = localFileMap.get(remoteFile.id);
      if (!localFile || new Date(remoteFile.lastModifiedUTC) > new Date(localFile.lastModifiedUTC)) {
        toDownload.push(remoteFile);
      }
    }
    return toDownload;
  }

  _getFilesToUpload(localFiles, remoteFileMap) {
    const toUpload = [];
    for (const localFile of localFiles) {
      const remoteFile = remoteFileMap.get(localFile.id);
      if (!remoteFile || new Date(localFile.lastModifiedUTC) > new Date(remoteFile.lastModifiedUTC)) {
        toUpload.push(localFile);
      }
    }
    return toUpload;
  }

  async _downloadFile(remoteFileMeta) {
    console.log(`Downloading: ${remoteFileMeta.originalName}`);
    try {
      // Expect server to accept storagePath (userId/encryptedName)
      const { signedUrl } = await api.getDownloadUrl(remoteFileMeta.storagePath, this.currentUser.token);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

      const encryptedBuffer = Buffer.from(await response.arrayBuffer());
      const vaultDir = path.join(app.getPath('userData'), 'vault');
      const encryptedPath = path.join(vaultDir, remoteFileMeta.encryptedName);

      await fsp.mkdir(vaultDir, { recursive: true });
      await fsp.writeFile(encryptedPath, encryptedBuffer);

      // Update local DB with remote metadata
      await this.dbManager.addOrUpdateFile(remoteFileMeta);
      console.log(`✅ Successfully downloaded ${remoteFileMeta.originalName}`);
    } catch (error) {
      console.error(`❌ Failed to download ${remoteFileMeta.originalName}:`, error);
    }
  }

  async _uploadFile(localFileMeta) {
    console.log(`Uploading: ${localFileMeta.originalName}`);
    try {
      const vaultDir = path.join(app.getPath('userData'), 'vault');
      const encryptedPath = path.join(vaultDir, localFileMeta.encryptedName);
      const fileBuffer = await fsp.readFile(encryptedPath);

      const { signedUrl, path: storagePath } = await api.getSignedUploadUrl(localFileMeta.encryptedName, this.currentUser.token);

      const putRes = await fetch(signedUrl, { method: 'PUT', body: fileBuffer });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      const newVersion = (localFileMeta.version || 1) + 1;
      const updatedMeta = {
        ...localFileMeta,
        version: newVersion,
        lastModifiedUTC: new Date().toISOString(),
        storagePath,
      };

      await api.persistMetadata(updatedMeta, this.currentUser.token);
      await this.dbManager.addOrUpdateFile(updatedMeta);
      console.log(`✅ Successfully uploaded ${localFileMeta.originalName}`);
    } catch (error) {
      console.error(`❌ Failed to upload ${localFileMeta.originalName}:`, error);
    }
  }
}

module.exports = SyncService;


