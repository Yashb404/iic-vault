const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class SyncService extends EventEmitter {
  constructor(databaseManager, options = {}) {
    super();
    this.db = databaseManager;
    this.directories = options.directories || [];
    this.watchers = [];
    this.debounceMs = options.debounceMs || 300;
    this._pending = new Map(); // map encryptedName -> timeout
  }

  setDirectories(directories) {
    this.directories = Array.from(new Set(directories));
  }

  // Determine source of truth by latest mtime among existing copies
  findLatestCopy(encryptedName) {
    let latest = null;
    for (const dir of this.directories) {
      const candidate = path.join(dir, encryptedName);
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (!latest || stat.mtimeMs > latest.mtimeMs) {
          latest = { fullPath: candidate, mtimeMs: stat.mtimeMs };
        }
      }
    }
    return latest;
  }

  copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Mirror latest copy to all directories; update DB version and audit log
  async syncFileById(fileId) {
    const rec = await this.db.getFileById(fileId);
    if (!rec) throw new Error('File not found');
    const latest = this.findLatestCopy(rec.encryptedName);
    if (!latest) return { updated: 0 };

    let updated = 0;
    for (const dir of this.directories) {
      const target = path.join(dir, rec.encryptedName);
      if (!fs.existsSync(target)) {
        this.copyFile(latest.fullPath, target);
        updated++;
      } else {
        const stat = fs.statSync(target);
        if (stat.mtimeMs < latest.mtimeMs) {
          this.copyFile(latest.fullPath, target);
          updated++;
        }
      }
    }

    if (updated > 0) {
      await this.db.updateFileModifiedAndVersion(fileId);
      await this.db.logAction(rec.ownerId, 'SYNC', `fileId=${fileId}; copies=${updated}`);
    }
    return { updated };
  }

  async syncByEncryptedName(encryptedName) {
    const rec = await this.db.getFileByEncryptedName(encryptedName);
    if (!rec) return { updated: 0 };
    return this.syncFileById(rec.id);
  }

  // Start watching directories and auto-sync on changes
  startWatching() {
    this.stopWatching();
    for (const dir of this.directories) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (!filename) return;
        // Only react to our encrypted files
        const encryptedName = filename.toString();
        // Debounce per encryptedName
        clearTimeout(this._pending.get(encryptedName));
        const to = setTimeout(() => {
          this.syncByEncryptedName(encryptedName).then((res) => {
            this.emit('synced', { encryptedName, res });
          }).catch((err) => {
            this.emit('error', err);
          });
        }, this.debounceMs);
        this._pending.set(encryptedName, to);
      });
      this.watchers.push(watcher);
    }
  }

  stopWatching() {
    for (const w of this.watchers) {
      try { w.close(); } catch (_) {}
    }
    this.watchers = [];
    for (const [, to] of this._pending) clearTimeout(to);
    this._pending.clear();
  }
}

module.exports = SyncService;


