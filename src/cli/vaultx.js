#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const DatabaseManager = require('../main/services/database-manager');
const cryptoEngine = require('../main/services/crypto-engine');
const SyncService = require('../main/services/sync-service');

function getDbPath(customPath) {
  if (customPath) return customPath;
  const base = path.join(os.homedir(), '.iic-vault');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'vault.db');
}

async function withDb(argv, fn) {
  const dbPath = getDbPath(argv.db);
  const db = new DatabaseManager(dbPath);
  await db.initializeDatabase();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

function requireArg(argv, name) {
  const v = argv[name];
  if (!v) {
    throw new Error(`Missing required --${name}`);
  }
  return v;
}

function resolveOutputPath(inputPath, encryptedNameToken, outDir) {
  const dir = outDir || path.dirname(inputPath);
  return path.join(dir, `${encryptedNameToken}.enc`);
}

// CLI definitions
yargs(hideBin(process.argv))
  .scriptName('vaultx')
  .usage('$0 <cmd> [args]')
  .command('user add', 'Create a user', (y) => y
    .option('username', { type: 'string', demandOption: true })
    .option('password', { type: 'string', demandOption: true })
    .option('role', { type: 'string', choices: ['admin','user'], default: 'user' })
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      await db.addUser(argv.username, argv.password, argv.role);
      const user = await db.getUserByUsername(argv.username);
      if (user) {
        await db.logAction(user.id, 'USER_ADD', `username=${argv.username}; role=${argv.role}`);
      }
      console.log('User created:', argv.username);
    });
  })
  .command('login', 'Verify credentials', (y) => y
    .option('username', { type: 'string', demandOption: true })
    .option('password', { type: 'string', demandOption: true })
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      const ok = await db.verifyPassword(argv.username, argv.password);
      if (!ok) {
        console.error('Invalid credentials');
        process.exitCode = 1;
        return;
      }
      const user = await db.getUserByUsername(argv.username);
      if (user) {
        await db.logAction(user.id, 'LOGIN', 'Successful login');
      }
      console.log('Login successful');
    });
  })
  .command('file', 'File operations', (y) => {
    return y
      .command('upload', 'Encrypt and register a file', (yy) => yy
        .option('path', { type: 'string', demandOption: true })
        .option('owner', { type: 'string', demandOption: true, desc: 'owner userId' })
        .option('password', { type: 'string', demandOption: true, desc: 'encryption password' })
        .option('out', { type: 'string', desc: 'output directory' })
        .option('db', { type: 'string' })
      , async (argv) => {
        await withDb(argv, async (db) => {
          const inputPath = argv.path;
          const originalName = path.basename(inputPath);
          const encryptedNameToken = cryptoEngine.encryptName(argv.password, originalName);
          const outputPath = resolveOutputPath(inputPath, encryptedNameToken, argv.out);
          const absOutputPath = path.resolve(outputPath);
          fs.mkdirSync(path.dirname(absOutputPath), { recursive: true });
          cryptoEngine.encryptFile(argv.password, inputPath, absOutputPath);

          const id = `file-${Date.now()}`;
          await db.addFile({ id, originalName, encryptedName: absOutputPath, ownerId: argv.owner });
          await db.logAction(argv.owner, 'UPLOAD', `fileId=${id}; name=${originalName}`);
          console.log(JSON.stringify({ fileId: id, originalName, encryptedPath: absOutputPath }, null, 2));
        });
      })
      .command('download', 'Decrypt a file', (yy) => yy
        .option('fileId', { type: 'string', demandOption: true })
        .option('password', { type: 'string', demandOption: true })
        .option('dest', { type: 'string', demandOption: true })
        .option('src', { type: 'string', desc: 'optional absolute path to encrypted .enc file' })
        .option('db', { type: 'string' })
      , async (argv) => {
        await withDb(argv, async (db) => {
          const rec = await db.getFileById(argv.fileId);
          if (!rec) {
            console.error('File not found');
            process.exitCode = 1;
            return;
          }
          const encPath = argv.src
            ? path.resolve(argv.src)
            : (path.isAbsolute(rec.encryptedName) ? rec.encryptedName : path.resolve(rec.encryptedName));
          cryptoEngine.decryptFile(argv.password, encPath, argv.dest);
          await db.logAction(rec.ownerId, 'DOWNLOAD', `fileId=${rec.id}`);
          console.log('Saved to', argv.dest);
        });
      })
      .command('ls', 'List files', (yy) => yy
        .option('user', { type: 'string', demandOption: true })
        .option('db', { type: 'string' })
      , async (argv) => {
        await withDb(argv, async (db) => {
          const list = await db.listFilesAccessibleByUser(argv.user);
          console.log(JSON.stringify(list, null, 2));
        });
      })
      .demandCommand(1)
      .strict()
      .showHelpOnFail(true);
  })
  .command('perm grant', 'Grant permission on a file', (y) => y
    .option('fileId', { type: 'string', demandOption: true })
    .option('userId', { type: 'string', demandOption: true })
    .option('perm', { type: 'string', choices: ['read','write'], demandOption: true })
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      await db.grantPermission(argv.fileId, argv.userId, argv.perm);
      await db.logAction(argv.userId, 'GRANT', `fileId=${argv.fileId}; perm=${argv.perm}`);
      console.log('Granted');
    });
  })
  .command('perm revoke', 'Revoke permission on a file', (y) => y
    .option('fileId', { type: 'string', demandOption: true })
    .option('userId', { type: 'string', demandOption: true })
    .option('perm', { type: 'string', choices: ['read','write'], demandOption: true })
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      await db.revokePermission(argv.fileId, argv.userId, argv.perm);
      await db.logAction(argv.userId, 'REVOKE', `fileId=${argv.fileId}; perm=${argv.perm}`);
      console.log('Revoked');
    });
  })
  .command('perm ls', 'List permissions for a file', (y) => y
    .option('fileId', { type: 'string', demandOption: true })
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      const rows = await db.listPermissionsForFile(argv.fileId);
      console.log(JSON.stringify(rows, null, 2));
    });
  })
  .command('logs', 'Show latest audit logs', (y) => y
    .option('db', { type: 'string' })
  , async (argv) => {
    await withDb(argv, async (db) => {
      const logs = await db.getAuditLogs();
      console.log(JSON.stringify(logs, null, 2));
    });
  })
  .command('sync run', 'Run on-demand sync for a file across directories', (y) => y
    .option('fileId', { type: 'string', demandOption: true })
    .option('dirs', { type: 'string', demandOption: true, desc: 'comma-separated list of directories' })
    .option('db', { type: 'string' })
  , async (argv) => {
    const dirs = argv.dirs.split(',').map((d) => d.trim()).filter(Boolean);
    await withDb(argv, async (db) => {
      const sync = new SyncService(db, { directories: dirs });
      const res = await sync.syncFileById(argv.fileId);
      console.log(JSON.stringify(res));
    });
  })
  .command('sync watch', 'Continuously watch directories and auto-sync on changes', (y) => y
    .option('dirs', { type: 'string', demandOption: true, desc: 'comma-separated list of directories' })
    .option('db', { type: 'string' })
  , async (argv) => {
    const dirs = argv.dirs.split(',').map((d) => d.trim()).filter(Boolean);
    await withDb(argv, async (db) => {
      const sync = new SyncService(db, { directories: dirs });
      sync.on('synced', ({ encryptedName, res }) => {
        console.log(`synced ${encryptedName}:`, JSON.stringify(res));
      });
      sync.on('error', (e) => {
        console.error('sync error:', e.message || e);
      });
      console.log('Watching for changes. Press Ctrl+C to exit.');
      sync.startWatching();
      // Keep process alive
      await new Promise(() => {});
    });
  })
  .demandCommand(1)
  .help()
  .strict()
  .parse();


