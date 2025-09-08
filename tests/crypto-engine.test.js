const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');

const { encryptFile, decryptFile } = require('../src/main/services/crypto-engine');

describe('crypto-engine placeholder', () => {
  const tmpRoot = path.join(__dirname, 'tmp');
  const srcFile = path.join(tmpRoot, 'sample.txt');
  const encFile = path.join(tmpRoot, 'sample.enc');
  const decFile = path.join(tmpRoot, 'sample.dec.txt');

  beforeAll(async () => {
    if (!fs.existsSync(tmpRoot)) {
      fs.mkdirSync(tmpRoot, { recursive: true });
    }
    await fsp.writeFile(srcFile, 'Hello Secure Vault!\nThis is a test payload.', 'utf8');
  });

  afterAll(async () => {
    // Clean up files created during tests
    for (const p of [srcFile, encFile, decFile]) {
      try { await fsp.unlink(p); } catch (_) {}
    }
    try { await fsp.rmdir(tmpRoot); } catch (_) {}
  });

  test('encryptFile should create copied encrypted file with same contents', async () => {
    await encryptFile(srcFile, encFile, 'pass123');
    expect(fs.existsSync(encFile)).toBe(true);

    const [srcBuf, encBuf] = await Promise.all([
      fsp.readFile(srcFile),
      fsp.readFile(encFile),
    ]);
    expect(Buffer.compare(srcBuf, encBuf)).toBe(0);
  });

  test('decryptFile should create copied decrypted file with same contents', async () => {
    // Ensure encrypted file exists from previous test; if not, create it again
    if (!fs.existsSync(encFile)) {
      await encryptFile(srcFile, encFile, 'pass123');
    }

    await decryptFile(encFile, decFile, 'pass123');
    expect(fs.existsSync(decFile)).toBe(true);

    const [encBuf, decBuf] = await Promise.all([
      fsp.readFile(encFile),
      fsp.readFile(decFile),
    ]);
    expect(Buffer.compare(encBuf, decBuf)).toBe(0);
  });
});


