const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

class DatabaseManager {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database', err.message);
      } else {
        console.log(`Connected to the SQLite database at ${dbPath}`);
      }
    });
  }

  initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db.serialize(async () => {
        try {
          await this.runQuery(`
            CREATE TABLE IF NOT EXISTS files (
              id TEXT PRIMARY KEY,
              originalName TEXT NOT NULL,
              encryptedName TEXT NOT NULL,
              createdAt TEXT NOT NULL,
              lastModifiedUTC TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              ownerId TEXT NOT NULL
            )
          `);

          await this.runQuery(`
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT UNIQUE NOT NULL,
              passwordHash TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('admin', 'user'))
            )
          `);

          await this.runQuery(`
            CREATE TABLE IF NOT EXISTS audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              userId TEXT NOT NULL,
              action TEXT NOT NULL,
              details TEXT
            )
          `);

          const adminExists = await this.get('SELECT id FROM users WHERE username = ?', ['admin']);
          if (!adminExists) {
            const hashedPassword = await bcrypt.hash('password', SALT_ROUNDS);
            await this.runQuery(
              'INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, ?)',
              ['default-admin', 'admin', hashedPassword, 'admin']
            );
          }

          console.log('Database initialized successfully.');
          resolve();
        } catch (err) {
          console.error('Database initialization failed:', err);
          reject(err);
        }
      });
    });
  }

  // --- User Management ---
  async addUser(username, password, role) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return this.runQuery(
      'INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, ?)',
      [`user-${Date.now()}`, username, passwordHash, role]
    );
  }

  async verifyPassword(username, password) {
    const user = await this.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  getUserByUsername(username) {
    return this.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  // --- File Management ---
  addFile(fileData) {
    const { id, originalName, encryptedName, ownerId } = fileData;
    const now = new Date().toISOString();
    return this.runQuery(
      'INSERT INTO files (id, originalName, encryptedName, createdAt, lastModifiedUTC, ownerId) VALUES (?, ?, ?, ?, ?, ?)',
      [id, originalName, encryptedName, now, now, ownerId]
    );
  }

  getFiles() {
    return this.all('SELECT * FROM files ORDER BY originalName ASC');
  }

  deleteFile(fileId) {
    return this.runQuery('DELETE FROM files WHERE id = ?', [fileId]);
  }

  // --- Audit Log ---
  logAction(userId, action, details = '') {
    const timestamp = new Date().toISOString();
    return this.runQuery(
      'INSERT INTO audit_log (timestamp, userId, action, details) VALUES (?, ?, ?, ?)',
      [timestamp, userId, action, details]
    );
  }

  getAuditLogs() {
    return this.all('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100');
  }

  // --- DB Helper Methods (Promisified) ---
  runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) return reject(err);
        console.log('Database connection closed.');
        resolve();
      });
    });
  }
}

module.exports = DatabaseManager;