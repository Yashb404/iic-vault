const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

jest.mock('../src/main/services/api-services', () => ({
  syncFiles: jest.fn(),
  getDownloadUrl: jest.fn(),
  getSignedUploadUrl: jest.fn(),
  persistMetadata: jest.fn(),
}));

// Neutral mock - no closures
jest.mock('electron', () => ({ app: { getPath: jest.fn() } }));

const api = require('../src/main/services/api-services');
const DatabaseManager = require('../src/main/services/database-manager');
const SyncService = require('../src/main/services/sync-service');

const fetchShim = async (url, opts = {}) => ({ 
  ok: true, 
  status: 200, 
  arrayBuffer: async () => Buffer.from('encrypted-file-content'),
  json: async () => ({})
});

describe('SyncService Comprehensive Tests', () => {
  let db;
  let sync;
  let vaultUserDataDir;
  let vaultDir;

  beforeEach(async () => {
    jest.resetAllMocks();
    global.fetch = fetchShim;
    
    // Fresh in-memory DB per test
    db = new DatabaseManager(':memory:');
    await new Promise((r) => db.db.on('open', r));
    await db.initializeDatabase();

    // Fresh vault userData dir per test
    vaultUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    vaultDir = path.join(vaultUserDataDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });
    require('electron').app.getPath.mockReturnValue(vaultUserDataDir);

    sync = new SyncService(db);
    sync.setCurrentUser({ id: 'user123', token: 'jwt-token-123' });
  });

  afterEach(async () => {
    await db.close();
    try { fs.rmSync(vaultUserDataDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('Complete Synchronization Scenarios', () => {
    test('handles mixed sync scenario - some files to upload, some to download', async () => {
      // Setup: Local has 2 files, remote has 3 files
      // File1: Remote newer (should download)
      // File2: Local newer (should upload)  
      // File3: Only exists remotely (should download)
      // File4: Only exists locally (should upload)

      const localFiles = [
        { id: 'file1', originalName: 'doc1.txt', encryptedName: 'file1.enc', ownerId: 'user123', version: 1, lastModifiedUTC: '2025-01-01T10:00:00.000Z', createdAt: '2025-01-01T09:00:00.000Z' },
        { id: 'file2', originalName: 'doc2.txt', encryptedName: 'file2.enc', ownerId: 'user123', version: 3, lastModifiedUTC: '2025-01-01T15:00:00.000Z', createdAt: '2025-01-01T09:00:00.000Z' },
        { id: 'file4', originalName: 'doc4.txt', encryptedName: 'file4.enc', ownerId: 'user123', version: 1, lastModifiedUTC: '2025-01-01T12:00:00.000Z', createdAt: '2025-01-01T12:00:00.000Z' }
      ];

      const remoteFiles = [
        { id: 'file1', originalName: 'doc1.txt', encryptedName: 'file1.enc', ownerId: 'user123', version: 2, storagePath: 'user123/file1.enc', lastModifiedUTC: '2025-01-01T14:00:00.000Z', createdAt: '2025-01-01T09:00:00.000Z' },
        { id: 'file2', originalName: 'doc2.txt', encryptedName: 'file2.enc', ownerId: 'user123', version: 2, storagePath: 'user123/file2.enc', lastModifiedUTC: '2025-01-01T11:00:00.000Z', createdAt: '2025-01-01T09:00:00.000Z' },
        { id: 'file3', originalName: 'doc3.txt', encryptedName: 'file3.enc', ownerId: 'user123', version: 1, storagePath: 'user123/file3.enc', lastModifiedUTC: '2025-01-01T13:00:00.000Z', createdAt: '2025-01-01T13:00:00.000Z' }
      ];

      // Add local files to DB
      for (const file of localFiles) {
        await db.addOrUpdateFile(file);
      }

      // Create local encrypted files for upload
      fs.writeFileSync(path.join(vaultDir, 'file2.enc'), Buffer.from('local-file2-content'));
      fs.writeFileSync(path.join(vaultDir, 'file4.enc'), Buffer.from('local-file4-content'));

      // Mock API responses
      api.syncFiles.mockResolvedValue(remoteFiles);
      api.getDownloadUrl.mockImplementation((storagePath) => 
        Promise.resolve({ signedUrl: `https://download/${storagePath}` })
      );
      api.getSignedUploadUrl.mockImplementation((fileName) => 
        Promise.resolve({ signedUrl: `https://upload/${fileName}`, path: `user123/${fileName}` })
      );
      api.persistMetadata.mockResolvedValue({ ok: true });

      // Run sync
      await sync.runSync();

      // Verify downloads (file1 and file3)
      expect(api.getDownloadUrl).toHaveBeenCalledWith('user123/file1.enc', 'jwt-token-123');
      expect(api.getDownloadUrl).toHaveBeenCalledWith('user123/file3.enc', 'jwt-token-123');
      expect(fs.existsSync(path.join(vaultDir, 'file1.enc'))).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'file3.enc'))).toBe(true);

      // Verify uploads (file2 and file4)
      expect(api.getSignedUploadUrl).toHaveBeenCalledWith('file2.enc', 'jwt-token-123');
      expect(api.getSignedUploadUrl).toHaveBeenCalledWith('file4.enc', 'jwt-token-123');
      expect(api.persistMetadata).toHaveBeenCalledTimes(2);

      // Verify local database updates
      const updatedFile1 = await db.getFileByEncryptedName('file1.enc');
      expect(updatedFile1.version).toBe(2);
      
      const updatedFile2 = await db.getFileByEncryptedName('file2.enc');
      expect(updatedFile2.version).toBe(4); // Incremented from 3 to 4

      const newFile3 = await db.getFileByEncryptedName('file3.enc');
      expect(newFile3).toBeTruthy();
      expect(newFile3.version).toBe(1);
    });

    test('handles empty remote and local states', async () => {
      api.syncFiles.mockResolvedValue([]);

      await sync.runSync();

      expect(api.getDownloadUrl).not.toHaveBeenCalled();
      expect(api.getSignedUploadUrl).not.toHaveBeenCalled();
      expect(api.persistMetadata).not.toHaveBeenCalled();
    });

    test('handles sync when no user is set', async () => {
      sync.setCurrentUser(null);
      
      await sync.runSync();

      expect(api.syncFiles).not.toHaveBeenCalled();
    });

    test('handles sync already in progress', async () => {
      // Start first sync
      sync.isSyncing = true;
      
      await sync.runSync();

      expect(api.syncFiles).not.toHaveBeenCalled();
    });

    test('handles API failures gracefully', async () => {
      const localFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 2, 
        lastModifiedUTC: '2025-01-01T15:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };
      
      await db.addOrUpdateFile(localFile);
      fs.writeFileSync(path.join(vaultDir, 'file1.enc'), Buffer.from('content'));

      const remoteFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 1, 
        storagePath: 'user123/file1.enc', 
        lastModifiedUTC: '2025-01-01T10:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };

      api.syncFiles.mockResolvedValue([remoteFile]);
      api.getSignedUploadUrl.mockRejectedValue(new Error('Upload URL failed'));

      // Should not throw, should handle error gracefully
      await expect(sync.runSync()).resolves.not.toThrow();
      
      // Verify sync completed despite errors
      expect(sync.isSyncing).toBe(false);
    });

    test('handles file download failure gracefully', async () => {
      const remoteFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 2, 
        storagePath: 'user123/file1.enc', 
        lastModifiedUTC: '2025-01-01T15:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };

      api.syncFiles.mockResolvedValue([remoteFile]);
      api.getDownloadUrl.mockRejectedValue(new Error('Download failed'));

      await expect(sync.runSync()).resolves.not.toThrow();
      
      // File should not exist locally since download failed
      expect(fs.existsSync(path.join(vaultDir, 'file1.enc'))).toBe(false);
    });

    test('correctly compares timestamps for sync decisions', async () => {
      const baseTime = '2025-01-01T12:00:00.000Z';
      const newerTime = '2025-01-01T13:00:00.000Z';
      const olderTime = '2025-01-01T11:00:00.000Z';

      // Local file with base time
      await db.addOrUpdateFile({
        id: 'file1',
        originalName: 'doc1.txt',
        encryptedName: 'file1.enc',
        ownerId: 'user123',
        version: 1,
        lastModifiedUTC: baseTime,
        createdAt: baseTime
      });

      // Remote file with newer time - should trigger download
      const remoteFiles = [{
        id: 'file1',
        originalName: 'doc1.txt',
        encryptedName: 'file1.enc',
        ownerId: 'user123',
        version: 1,
        storagePath: 'user123/file1.enc',
        lastModifiedUTC: newerTime,
        createdAt: baseTime
      }];

      api.syncFiles.mockResolvedValue(remoteFiles);
      api.getDownloadUrl.mockResolvedValue({ signedUrl: 'https://download/file1.enc' });

      await sync.runSync();

      expect(api.getDownloadUrl).toHaveBeenCalledWith('user123/file1.enc', 'jwt-token-123');
      expect(fs.existsSync(path.join(vaultDir, 'file1.enc'))).toBe(true);
    });

    test('handles version increments correctly during upload', async () => {
      const localFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 5, 
        lastModifiedUTC: '2025-01-01T15:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };
      
      await db.addOrUpdateFile(localFile);
      fs.writeFileSync(path.join(vaultDir, 'file1.enc'), Buffer.from('updated-content'));

      const remoteFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 3, 
        storagePath: 'user123/file1.enc', 
        lastModifiedUTC: '2025-01-01T10:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };

      api.syncFiles.mockResolvedValue([remoteFile]);
      api.getSignedUploadUrl.mockResolvedValue({ 
        signedUrl: 'https://upload/file1.enc', 
        path: 'user123/file1.enc' 
      });
      api.persistMetadata.mockResolvedValue({ ok: true });

      await sync.runSync();

      // Verify version was incremented to 6 (5 + 1)
      expect(api.persistMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'file1',
          version: 6,
          storagePath: 'user123/file1.enc'
        }),
        'jwt-token-123'
      );

      const updatedLocal = await db.getFileByEncryptedName('file1.enc');
      expect(updatedLocal.version).toBe(6);
    });

    test('creates vault directory if it does not exist', async () => {
      // Remove vault directory
      fs.rmSync(vaultDir, { recursive: true, force: true });
      expect(fs.existsSync(vaultDir)).toBe(false);

      const remoteFile = { 
        id: 'file1', 
        originalName: 'doc1.txt', 
        encryptedName: 'file1.enc', 
        ownerId: 'user123', 
        version: 1, 
        storagePath: 'user123/file1.enc', 
        lastModifiedUTC: '2025-01-01T15:00:00.000Z', 
        createdAt: '2025-01-01T10:00:00.000Z' 
      };

      api.syncFiles.mockResolvedValue([remoteFile]);
      api.getDownloadUrl.mockResolvedValue({ signedUrl: 'https://download/file1.enc' });

      await sync.runSync();

      // Verify vault directory was created and file was downloaded
      expect(fs.existsSync(vaultDir)).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'file1.enc'))).toBe(true);
    });
  });

  describe('Sync Decision Logic', () => {
    test('_getFilesToDownload identifies correct files', () => {
      const remoteFiles = [
        { id: 'file1', lastModifiedUTC: '2025-01-01T15:00:00.000Z' },
        { id: 'file2', lastModifiedUTC: '2025-01-01T10:00:00.000Z' },
        { id: 'file3', lastModifiedUTC: '2025-01-01T12:00:00.000Z' }
      ];

      const localFileMap = new Map([
        ['file1', { id: 'file1', lastModifiedUTC: '2025-01-01T10:00:00.000Z' }], // Remote newer
        ['file2', { id: 'file2', lastModifiedUTC: '2025-01-01T15:00:00.000Z' }], // Local newer
        // file3 doesn't exist locally
      ]);

      const filesToDownload = sync._getFilesToDownload(remoteFiles, localFileMap);
      
      expect(filesToDownload).toHaveLength(2);
      expect(filesToDownload.map(f => f.id)).toEqual(['file1', 'file3']);
    });

    test('_getFilesToUpload identifies correct files', () => {
      const localFiles = [
        { id: 'file1', lastModifiedUTC: '2025-01-01T15:00:00.000Z' },
        { id: 'file2', lastModifiedUTC: '2025-01-01T10:00:00.000Z' },
        { id: 'file4', lastModifiedUTC: '2025-01-01T12:00:00.000Z' }
      ];

      const remoteFileMap = new Map([
        ['file1', { id: 'file1', lastModifiedUTC: '2025-01-01T10:00:00.000Z' }], // Local newer
        ['file2', { id: 'file2', lastModifiedUTC: '2025-01-01T15:00:00.000Z' }], // Remote newer
        // file4 doesn't exist remotely
      ]);

      const filesToUpload = sync._getFilesToUpload(localFiles, remoteFileMap);
      
      expect(filesToUpload).toHaveLength(2);
      expect(filesToUpload.map(f => f.id)).toEqual(['file1', 'file4']);
    });
  });
});