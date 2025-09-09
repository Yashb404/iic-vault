#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const DatabaseManager = require('../main/services/database-manager');
const cryptoEngine = require('../main/services/crypto-engine');
const SyncService = require('../main/services/sync-service');
const { login: apiLogin, getSignedUploadUrl, persistMetadata, setApiBase } = require('../main/services/api-services');

const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

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
  const invalidChars = /[<>:"/\\|?*]/g; // Windows-invalid chars, also safe cross-platform
  const safeToken = String(encryptedNameToken).replace(invalidChars, '_');
  return path.join(dir, `${safeToken}.enc`);
}

// Remote auth token store (~/.iic-vault/token.json)
function tokenFilePath() {
  const base = path.join(os.homedir(), '.iic-vault');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'token.json');
}

function saveToken(data) {
  fs.writeFileSync(tokenFilePath(), JSON.stringify(data, null, 2));
}

function loadToken() {
  try {
    const raw = fs.readFileSync(tokenFilePath(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && obj.token ? obj : null;
  } catch {
    return null;
  }
}

function clearToken() {
  try { fs.unlinkSync(tokenFilePath()); } catch {}
}

// CLI definitions
yargs(hideBin(process.argv))
  .scriptName('vaultx')
  .usage('$0 <cmd> [args]')
  // Remote auth & API integration
  .command('remote', 'Remote API operations', (y) => y
    .command('login', 'Login to remote dashboard API', (yy) => yy
      .option('username', { type: 'string', demandOption: true })
      .option('password', { type: 'string', demandOption: true })
      .option('api', { type: 'string', desc: 'API base URL (e.g., http://localhost:3001)' })
    , async (argv) => {
      if (argv.api) setApiBase(argv.api);
      const res = await apiLogin(argv.username, argv.password); // { token, user }
      saveToken({ token: res.token, user: res.user, api: argv.api || process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001' });
      console.log('Remote login successful for', res.user && res.user.username ? res.user.username : argv.username);
    })
    .command('logout', 'Clear remote session', (yy) => yy, async () => {
      clearToken();
      console.log('Remote session cleared');
    })
    .command('status', 'Show remote session status', (yy) => yy, async () => {
      const t = loadToken();
      if (!t) {
        console.log('Not logged in to remote API');
      } else {
        console.log(JSON.stringify({ loggedIn: true, user: t.user, api: t.api }, null, 2));
      }
    })
    .demandCommand(1)
    .strict()
    .showHelpOnFail(true)
  )
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
        .option('remote', { type: 'boolean', default: false, desc: 'also upload to remote dashboard' })
        .option('api', { type: 'string', desc: 'API base URL override for this run' })
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

          let remoteInfo = null;
          if (argv.remote) {
            const session = loadToken();
            if (!session || !session.token) {
              console.error('Remote upload requested but not logged in. Run: vaultx remote login --username <u> --password <p> [--api <url>]');
              process.exitCode = 1;
              return;
            }
            if (argv.api) setApiBase(argv.api);

            // 1) Request signed URL
            const { signedUrl, path: storagePath } = await getSignedUploadUrl(path.basename(absOutputPath), session.token);

            // 2) PUT encrypted bytes to signed URL
            const fileBuffer = fs.readFileSync(absOutputPath);
            const putRes = await fetch(signedUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/octet-stream',
              },
              body: fileBuffer,
            });
            if (!putRes.ok) {
              console.error(`Remote upload failed (${putRes.status})`);
              process.exitCode = 1;
              return;
            }

            // 3) Persist metadata to server
            await persistMetadata({
              id,
              originalName,
              encryptedName: absOutputPath,
              storagePath,
              version: 1,
              lastModifiedUTC: new Date().toISOString(),
            }, session.token);

            remoteInfo = { storagePath };
          }

          console.log(JSON.stringify({ fileId: id, originalName, encryptedPath: absOutputPath, remote: remoteInfo }, null, 2));
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


