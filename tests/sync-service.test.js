const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const DatabaseManager = require('../src/main/services/database-manager');
const SyncService = require('../src/main/services/sync-service');

describe('SyncService', () => {
  let db;
  let tmpA, tmpB;
  let sync;
  let fileId;

  beforeAll(async () => {
    db = new DatabaseManager(':memory:');
    await new Promise((r) => db.db.on('open', r));
    await db.initializeDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'syncA-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'syncB-'));
    sync = new SyncService(db, { directories: [tmpA, tmpB] });
    fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    await db.addFile({
      id: fileId,
      originalName: 'report.pdf',
      encryptedName: 'token.enc',
      ownerId: 'default-admin',
    });
  });

  test('one-way: copy from A to B when A is newer', async () => {
    const aFile = path.join(tmpA, 'token.enc');
    const bFile = path.join(tmpB, 'token.enc');
    fs.writeFileSync(aFile, Buffer.from('A newer content'));
    if (fs.existsSync(bFile)) fs.unlinkSync(bFile);

    const res = await sync.syncFileById(fileId);
    expect(res.updated).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(bFile)).toBe(true);
    const bBytes = fs.readFileSync(bFile).toString('utf8');
    expect(bBytes).toBe('A newer content');
  });

  test('two-way: whichever is newer wins and overwrites older', async () => {
    const aFile = path.join(tmpA, 'token.enc');
    const bFile = path.join(tmpB, 'token.enc');
    fs.writeFileSync(aFile, Buffer.from('old A'));
    // Ensure newer mtime on B
    fs.writeFileSync(bFile, Buffer.from('NEW B'));

    const res = await sync.syncFileById(fileId);
    expect(res.updated).toBeGreaterThanOrEqual(1);
    const aBytes = fs.readFileSync(aFile).toString('utf8');
    const bBytes = fs.readFileSync(bFile).toString('utf8');
    expect(aBytes).toBe('NEW B');
    expect(bBytes).toBe('NEW B');
  });
});


