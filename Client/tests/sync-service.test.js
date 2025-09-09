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

const fetchShim = async (url, opts = {}) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('encbytes'), json: async () => ({}) });

describe('SyncService runSync', () => {
  let db;
  let sync;
  let vaultUserDataDir;

  beforeEach(async () => {
    jest.resetAllMocks();
    global.fetch = fetchShim;
    // Fresh in-memory DB per test
    db = new DatabaseManager(':memory:');
    await new Promise((r) => db.db.on('open', r));
    await db.initializeDatabase();

    // Fresh vault userData dir per test
    vaultUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    require('electron').app.getPath.mockReturnValue(vaultUserDataDir);

    sync = new SyncService(db);
    sync.setCurrentUser({ id: 'u1', token: 't-1' });
  });

  afterEach(async () => {
    await db.close();
    try { fs.rmSync(vaultUserDataDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('downloads when remote is newer', async () => {
    const remote = [{ id: 'id1', originalName: 'a.txt', encryptedName: 'e.enc', ownerId: 'u1', version: 2, storagePath: 'u1/e.enc', lastModifiedUTC: '2025-01-02T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' }];
    await db.addOrUpdateFile({ id: 'id1', originalName: 'a.txt', encryptedName: 'e.enc', ownerId: 'u1', version: 1, lastModifiedUTC: '2025-01-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' });

    api.syncFiles.mockResolvedValue(remote);
    api.getDownloadUrl.mockResolvedValue({ signedUrl: 'https://signed/download' });

    await sync.runSync();

    const rec = await db.getFileByEncryptedName('e.enc');
    expect(rec.version).toBe(2);
    const encPath = path.join(vaultUserDataDir, 'vault', 'e.enc');
    expect(fs.existsSync(encPath)).toBe(true);
  });

  test('uploads when local is newer', async () => {
    const local = { id: 'id2', originalName: 'b.txt', encryptedName: 'b.enc', ownerId: 'u1', version: 3, lastModifiedUTC: '2025-01-03T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' };
    await db.addOrUpdateFile(local);

    const remote = [{ id: 'id2', originalName: 'b.txt', encryptedName: 'b.enc', ownerId: 'u1', version: 2, storagePath: 'u1/b.enc', lastModifiedUTC: '2025-01-02T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' }];

    api.syncFiles.mockResolvedValue(remote);
    api.getSignedUploadUrl.mockResolvedValue({ signedUrl: 'https://signed/upload', path: 'u1/b.enc' });
    api.persistMetadata.mockResolvedValue({ ok: true });

    // create fake encrypted file in vault to upload (respect subdir)
    const vaultDir = path.join(vaultUserDataDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });
    const encPath = path.join(vaultDir, 'b.enc');
    fs.writeFileSync(encPath, Buffer.from('encbytes'));

    await sync.runSync();

    const rec = await db.getFileByEncryptedName('b.enc');
    expect(rec.version).toBe(4);
  });
});


