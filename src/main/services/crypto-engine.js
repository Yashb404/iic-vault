
const crypto = require('node:crypto');
const fs = require('node:fs');

const MAGIC = Buffer.from('IIC1');
const DEFAULT_ITERATIONS = 150000; // ~OWASP 2025 PBKDF2 guidance (adjust per device)
const DEFAULT_SALT_LEN = 16;
const DEFAULT_IV_LEN = 12; // GCM recommended 12 bytes
const AUTH_TAG_LEN = 16; // AES-GCM tag length in bytes

function deriveKeyFromPassword(password, salt, iterations = DEFAULT_ITERATIONS) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  if (!Buffer.isBuffer(salt)) {
    throw new Error('Salt must be a Buffer');
  }
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256'); // 32 bytes for AES-256
}

function buildHeader(salt, iv, iterations) {
  const header = Buffer.alloc(4 + 1 + 1 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(salt.length, 4);
  header.writeUInt8(iv.length, 5);
  header.writeUInt32BE(iterations >>> 0, 6);
  return Buffer.concat([header, salt, iv]);
}

function parseHeader(buffer) {
  if (buffer.length < 4 + 1 + 1 + 4) {
    throw new Error('Ciphertext too short');
  }
  const magic = buffer.subarray(0, 4);
  if (!magic.equals(MAGIC)) {
    throw new Error('Invalid ciphertext header');
  }
  const saltLen = buffer.readUInt8(4);
  const ivLen = buffer.readUInt8(5);
  const iterations = buffer.readUInt32BE(6);
  const headerLen = 4 + 1 + 1 + 4 + saltLen + ivLen;
  if (buffer.length < headerLen + AUTH_TAG_LEN + 1) {
    throw new Error('Ciphertext malformed');
  }
  const salt = buffer.subarray(4 + 1 + 1 + 4, 4 + 1 + 1 + 4 + saltLen);
  const iv = buffer.subarray(4 + 1 + 1 + 4 + saltLen, headerLen);
  return { headerLen, salt, iv, iterations };
}

function encryptBuffer(password, plaintextBuffer, options = {}) {
  const iterations = options.iterations || DEFAULT_ITERATIONS;
  const salt = options.salt || crypto.randomBytes(DEFAULT_SALT_LEN);
  const iv = options.iv || crypto.randomBytes(DEFAULT_IV_LEN);

  const key = deriveKeyFromPassword(password, salt, iterations);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = buildHeader(salt, iv, iterations);
  return Buffer.concat([header, ciphertext, tag]);
}

function decryptBuffer(password, encryptedBuffer) {
  const { headerLen, salt, iv, iterations } = parseHeader(encryptedBuffer);
  const tag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LEN);
  const ciphertext = encryptedBuffer.subarray(headerLen, encryptedBuffer.length - AUTH_TAG_LEN);

  const key = deriveKeyFromPassword(password, salt, iterations);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}

function encryptFile(password, inputPath, outputPath, options = {}) {
  const plaintext = fs.readFileSync(inputPath);
  const encrypted = encryptBuffer(password, plaintext, options);
  fs.writeFileSync(outputPath, encrypted);
}

function decryptFile(password, inputPath, outputPath) {
  const encrypted = fs.readFileSync(inputPath);
  const plaintext = decryptBuffer(password, encrypted);
  fs.writeFileSync(outputPath, plaintext);
}

// Filename helpers using compact token format: v1:salt:iv:ct:tag (base64url)
function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function encryptName(password, name, options = {}) {
  const iterations = options.iterations || DEFAULT_ITERATIONS;
  const salt = options.salt || crypto.randomBytes(DEFAULT_SALT_LEN);
  const iv = options.iv || crypto.randomBytes(DEFAULT_IV_LEN);

  const key = deriveKeyFromPassword(password, salt, iterations);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(name, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();

  const token = [
    'v1',
    base64urlEncode(salt),
    base64urlEncode(iv),
    base64urlEncode(ciphertext),
    base64urlEncode(tag),
    String(iterations),
  ].join(':');
  return token;
}

function decryptName(password, token) {
  const parts = token.split(':');
  if (parts.length !== 6 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted name token');
  }
  const salt = base64urlDecode(parts[1]);
  const iv = base64urlDecode(parts[2]);
  const ciphertext = base64urlDecode(parts[3]);
  const tag = base64urlDecode(parts[4]);
  const iterations = Number(parts[5]);

  const key = deriveKeyFromPassword(password, salt, iterations);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = {
  // Key derivation
  deriveKeyFromPassword,
  // Buffer helpers
  encryptBuffer,
  decryptBuffer,
  // File helpers
  encryptFile,
  decryptFile,
  // Name helpers
  encryptName,
  decryptName,
  // Expose defaults for advanced callers
  constants: {
    DEFAULT_ITERATIONS,
    DEFAULT_SALT_LEN,
    DEFAULT_IV_LEN,
    AUTH_TAG_LEN,
    MAGIC,
  },
};


