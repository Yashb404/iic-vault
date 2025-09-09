const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cryptoEngine = require('../src/main/services/crypto-engine');

describe('crypto-engine', () => {
  const password = 'correct horse battery staple';

  test('buffer round-trip', () => {
    const data = Buffer.from('hello secure world');
    const enc = cryptoEngine.encryptBuffer(password, data);
    const dec = cryptoEngine.decryptBuffer(password, enc);
    expect(dec.equals(data)).toBe(true);
  });

  test('name round-trip', () => {
    const name = 'report.pdf';
    const token = cryptoEngine.encryptName(password, name);
    const plain = cryptoEngine.decryptName(password, token);
    expect(plain).toBe(name);
  });

  test('file round-trip', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iic-'));
    const inputPath = path.join(tmpDir, 'plain.txt');
    const encPath = path.join(tmpDir, 'plain.txt.enc');
    const outPath = path.join(tmpDir, 'plain.out.txt');

    fs.writeFileSync(inputPath, Buffer.from('file content 12345'));

    // Correct parameter order: (password, inputPath, outputPath)
    cryptoEngine.encryptFile(password, inputPath, encPath);
    cryptoEngine.decryptFile(password, encPath, outPath);

    const original = fs.readFileSync(inputPath);
    const restored = fs.readFileSync(outPath);

    expect(restored.equals(original)).toBe(true);
  });
});