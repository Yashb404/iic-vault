#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const DatabaseManager = require('../main/services/database-manager');
const cryptoEngine = require('../main/services/crypto-engine');
const SyncService = require('../main/services/sync-service');
const api = require('../main/services/api-services');

function getDbPath(customPath) {
  if (customPath) return customPath;
  const base = path.join(os.homedir(), '.iic-vault');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'vault.db');
}

function getConfigPath() {
  const base = path.join(os.homedir(), '.iic-vault');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'config.json');
}

function loadConfig() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function saveConfig(cfg) {
  const cfgPath = getConfigPath();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

async function putToSignedUrl(url, filePath) {
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  const res = await (global.fetch)(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(stat.size) },
    body: stream,
  });
  if (!res.ok) throw new Error(`Upload to signed URL failed (${res.status})`);
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
    .option('useServer', { type: 'boolean', default: false, desc: 'authenticate against remote server and store JWT' })
  , async (argv) => {
    if (argv.useServer) {
      // Remote login via API and persist token locally
      const { token, user } = await api.login(argv.username, argv.password);
      const cfg = loadConfig();
      cfg.token = token;
      cfg.user = user; // { id, username, role }
      // Preserve existing api base if set via env; allow override by SECURE_VAULT_API_BASE env
      cfg.apiBase = process.env.SECURE_VAULT_API_BASE || cfg.apiBase || 'http://localhost:3001';
      saveConfig(cfg);
      console.log('Remote login successful');
    } else {
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
    }
  })
  .command('file', 'File operations', (y) => {
    return y
      .command('upload', 'Encrypt and register a file', (yy) => yy
        .option('path', { type: 'string', demandOption: true })
        .option('owner', { type: 'string', desc: 'owner userId (defaults to remote user when using server)' })
        .option('password', { type: 'string', demandOption: true, desc: 'encryption password' })
        .option('out', { type: 'string', desc: 'output directory' })
        .option('db', { type: 'string' })
        .option('useServer', { type: 'boolean', default: false, desc: 'upload encrypted file to remote S3 via server' })
        .option('awsDirect', { type: 'boolean', default: false, desc: 'upload encrypted file directly to AWS S3 (no login)' })
        .option('s3Prefix', { type: 'string', desc: 'S3 key prefix (defaults to owner or anonymous)'} )
        .option('bucket', { type: 'string', desc: 'AWS S3 bucket name (overrides env)' })
        .option('region', { type: 'string', desc: 'AWS region (overrides env)' })
        .option('accessKeyId', { type: 'string', desc: 'AWS access key id (overrides env)' })
        .option('secretAccessKey', { type: 'string', desc: 'AWS secret access key (overrides env)' })
        .option('sessionToken', { type: 'string', desc: 'AWS session token (optional, overrides env)' })
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
          const ownerIdLocal = argv.owner || (loadConfig().user && loadConfig().user.id) || 'default-admin';

          if (argv.useServer) {
            const cfg = loadConfig();
            if (!cfg.token) {
              console.error('Missing JWT. Run: vaultx login --useServer --username <u> --password <p>');
              process.exitCode = 1;
              return;
            }
            const fileName = path.basename(absOutputPath); // e.g., <token>.enc
            const { signedUrl, path: remotePath } = await api.getSignedUploadUrl(fileName, cfg.token);
            await putToSignedUrl(signedUrl, absOutputPath);
            await api.persistMetadata({
              id,
              originalName,
              encryptedName: fileName,
              storagePath: remotePath,
              version: 1,
              lastModifiedUTC: new Date().toISOString(),
            }, cfg.token);
          } else if (argv.awsDirect) {
            // Directly upload to S3 using AWS credentials from env
            const bucket = argv.bucket || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET || process.env.BUCKET;
            const region = argv.region || process.env.AWS_S3_REGION || process.env.AWS_REGION;
            if (!bucket || !region) {
              console.error('Missing AWS config. Set AWS_S3_BUCKET and AWS_S3_REGION (or AWS_REGION).');
              process.exitCode = 1;
              return;
            }
            let S3Client, PutObjectCommand;
            try {
              ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
            } catch (e) {
              console.error('Missing dependency @aws-sdk/client-s3. Run: npm i @aws-sdk/client-s3');
              process.exitCode = 1;
              return;
            }
            const creds = (argv.accessKeyId && argv.secretAccessKey)
              ? { accessKeyId: argv.accessKeyId, secretAccessKey: argv.secretAccessKey, sessionToken: argv.sessionToken }
              : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
                ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, sessionToken: process.env.AWS_SESSION_TOKEN }
                : undefined;
            const client = new S3Client({ region, credentials: creds });
            const fileStream = fs.createReadStream(absOutputPath);
            const fileName = path.basename(absOutputPath);
            const prefix = argv.s3Prefix || ownerIdLocal || 'anonymous';
            const key = `${prefix}/${fileName}`;
            try {
              await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fileStream, ContentType: 'application/octet-stream' }));
              console.log(JSON.stringify({ uploaded: true, bucket, key }, null, 2));
            } catch (err) {
              console.error('S3 upload failed:', err.message || err);
              process.exitCode = 1;
              return;
            }
          }

          // Keep local DB metadata for backward-compatibility and sync features
          await db.addFile({ id, originalName, encryptedName: absOutputPath, ownerId: ownerIdLocal });
          await db.logAction(ownerIdLocal, 'UPLOAD', `fileId=${id}; name=${originalName}`);
          console.log(JSON.stringify({ fileId: id, originalName, encryptedPath: absOutputPath }, null, 2));
        });
      })
      .command('download', 'Decrypt a file', (yy) => yy
        .option('fileId', { type: 'string', demandOption: true })
        .option('password', { type: 'string', demandOption: true })
        .option('dest', { type: 'string', demandOption: true })
        .option('src', { type: 'string', desc: 'optional absolute path to encrypted .enc file' })
        .option('db', { type: 'string' })
        .option('fromS3', { type: 'boolean', default: false, desc: 'download encrypted file from S3 first' })
        .option('bucket', { type: 'string', desc: 'AWS S3 bucket name (overrides env)' })
        .option('region', { type: 'string', desc: 'AWS region (overrides env)' })
        .option('accessKeyId', { type: 'string', desc: 'AWS access key id (overrides env)' })
        .option('secretAccessKey', { type: 'string', desc: 'AWS secret access key (overrides env)' })
        .option('sessionToken', { type: 'string', desc: 'AWS session token (optional, overrides env)' })
        .option('s3Key', { type: 'string', desc: 'S3 key path (defaults to owner/encryptedName from DB)' })
      , async (argv) => {
        await withDb(argv, async (db) => {
          const rec = await db.getFileById(argv.fileId);
          if (!rec) {
            console.error('File not found');
            process.exitCode = 1;
            return;
          }

          let encPath;
          if (argv.fromS3) {
            // Download from S3 first
            const bucket = argv.bucket || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET || process.env.BUCKET;
            const region = argv.region || process.env.AWS_S3_REGION || process.env.AWS_REGION;
            if (!bucket || !region) {
              console.error('Missing AWS config. Set bucket and region via flags or env vars.');
              process.exitCode = 1;
              return;
            }

            let S3Client, GetObjectCommand;
            try {
              ({ S3Client, GetObjectCommand } = require('@aws-sdk/client-s3'));
            } catch (e) {
              console.error('Missing dependency @aws-sdk/client-s3. Run: npm i @aws-sdk/client-s3');
              process.exitCode = 1;
              return;
            }

            const creds = (argv.accessKeyId && argv.secretAccessKey)
              ? { accessKeyId: argv.accessKeyId, secretAccessKey: argv.secretAccessKey, sessionToken: argv.sessionToken }
              : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
                ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, sessionToken: process.env.AWS_SESSION_TOKEN }
                : undefined;

            const client = new S3Client({ region, credentials: creds });
            
            // Determine S3 key
            const s3Key = argv.s3Key || `${rec.ownerId}/${path.basename(rec.encryptedName)}`;
            
            // Create temp file for downloaded encrypted content
            const tempEncPath = path.join(os.tmpdir(), `temp-${Date.now()}-${path.basename(rec.encryptedName)}`);
            
            try {
              const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
              const stream = response.Body;
              const chunks = [];
              for await (const chunk of stream) {
                chunks.push(chunk);
              }
              const buffer = Buffer.concat(chunks);
              fs.writeFileSync(tempEncPath, buffer);
              encPath = tempEncPath;
              console.log(`Downloaded from S3: s3://${bucket}/${s3Key}`);
            } catch (err) {
              console.error('S3 download failed:', err.message || err);
              process.exitCode = 1;
              return;
            }
          } else {
            // Use local file
            encPath = argv.src
              ? path.resolve(argv.src)
              : (path.isAbsolute(rec.encryptedName) ? rec.encryptedName : path.resolve(rec.encryptedName));
          }

          cryptoEngine.decryptFile(argv.password, encPath, argv.dest);
          await db.logAction(rec.ownerId, 'DOWNLOAD', `fileId=${rec.id}`);
          console.log('Saved to', argv.dest);

          // Clean up temp file if we downloaded from S3
          if (argv.fromS3 && encPath.startsWith(os.tmpdir())) {
            try {
              fs.unlinkSync(encPath);
            } catch (_) {}
          }
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


