const DatabaseManager = require('../src/main/services/database-manager');
const sqlite3 = require('sqlite3');

// Mock electron.app.getPath
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => './tests/temp'),
  },
}));

describe('DatabaseManager', () => {
  let dbManager;

  beforeEach((done) => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.db.on('open', () => {
      dbManager.initializeDatabase().then(() => done());
    });
  });

  afterEach(async () => {
    await dbManager.close();
  });

  test('should initialize and create tables correctly', (done) => {
    const tablesQuery = "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('files', 'users', 'audit_log')";
    dbManager.db.all(tablesQuery, (err, rows) => {
      expect(err).toBeNull();
      expect(rows).toHaveLength(3);
      done();
    });
  });

  test('should seed the database with a default admin user', async () => {
    const adminUser = await dbManager.getUserByUsername('admin');
    expect(adminUser).not.toBeNull();
    expect(adminUser.username).toBe('admin');
    expect(adminUser.role).toBe('admin');
  });

  test('verifyPassword should succeed for admin default password and fail for wrong', async () => {
    const ok = await dbManager.verifyPassword('admin', 'password');
    const bad = await dbManager.verifyPassword('admin', 'wrong-password');
    const noUser = await dbManager.verifyPassword('nouser', 'password');
    expect(ok).toBe(true);
    expect(bad).toBe(false);
    expect(noUser).toBe(false);
  });

  test('addUser should create a new user with hashed password', async () => {
    await dbManager.addUser('alice', 's3cr3t', 'user');
    const user = await dbManager.getUserByUsername('alice');
    expect(user).not.toBeNull();
    expect(user.username).toBe('alice');
    expect(user.role).toBe('user');
    const ok = await dbManager.verifyPassword('alice', 's3cr3t');
    expect(ok).toBe(true);
  });

  test('file CRUD: addFile, getFiles, deleteFile', async () => {
    const fileId = `file-${Date.now()}`;
    await dbManager.addFile({
      id: fileId,
      originalName: 'report.pdf',
      encryptedName: 'abcd1234.enc',
      ownerId: 'default-admin',
    });

    const filesAfterAdd = await dbManager.getFiles();
    expect(Array.isArray(filesAfterAdd)).toBe(true);
    expect(filesAfterAdd.length).toBe(1);
    expect(filesAfterAdd[0].id).toBe(fileId);

    await dbManager.deleteFile(fileId);
    const filesAfterDelete = await dbManager.getFiles();
    expect(filesAfterDelete.length).toBe(0);
  });

  test('extended helpers: addOrUpdateFile, getFileByEncryptedName, updateFileModifiedAndVersion', async () => {
    const id = `f-${Date.now()}`;
    const base = {
      id,
      originalName: 'x.txt',
      encryptedName: 'x.enc',
      ownerId: 'default-admin',
      version: 1,
      lastModifiedUTC: new Date('2024-01-01').toISOString(),
      createdAt: new Date('2024-01-01').toISOString(),
    };

    await dbManager.addOrUpdateFile(base);
    let rec = await dbManager.getFileByEncryptedName('x.enc');
    expect(rec).not.toBeNull();
    expect(rec.version).toBe(1);

    // Update
    const updated = { ...base, originalName: 'x2.txt', version: 2, lastModifiedUTC: new Date('2024-02-01').toISOString() };
    await dbManager.addOrUpdateFile(updated);
    rec = await dbManager.getFileByEncryptedName('x.enc');
    expect(rec.originalName).toBe('x2.txt');
    expect(rec.version).toBe(2);

    // Bump version helper
    await dbManager.updateFileModifiedAndVersion(id);
    rec = await dbManager.getFileByEncryptedName('x.enc');
    expect(rec.version).toBe(3);
  });

  test('audit logging: logAction and getAuditLogs', async () => {
    await dbManager.logAction('default-admin', 'LOGIN', 'Admin signed in');
    await dbManager.logAction('default-admin', 'CREATE', 'Created file X');

    const logs = await dbManager.getAuditLogs();
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]).toHaveProperty('timestamp');
    expect(logs[0]).toHaveProperty('userId');
    expect(logs[0]).toHaveProperty('action');
  });
});