# iic-vault

Secure local vault built with Electron, SQLite, and strong encryption. Includes a companion CLI (`vaultx`) for automating common workflows: user management, file upload/download, permissions, and audit logs.

## Overview
- **Main app**: Electron (main/renderer) with a SQLite database stored per user.
- **Crypto**: AES-256-GCM with PBKDF2-SHA256 key derivation (salted, iterated). Filenames are encrypted to tokens; file bytes include a self-describing header (magic + salt + IV + iterations + auth tag).
- **DB**: Tables for `users`, `files`, `permissions`, `audit_log` with helpers in `DatabaseManager`.
- **CLI**: `vaultx` provides end-to-end ops without launching the GUI.

## Project structure
```
src/
  main/
    index.js                 # Electron app boot, DB init, IPC
    preload.js               # (placeholder)
    services/
      database-manager.js    # SQLite schema and methods
      crypto-engine.js       # AES-256-GCM + PBKDF2 for files/names
  renderer/
    index.html, renderer.js  # Minimal demo UI
  shared/
    constants.js             # (placeholder)
src/cli/
  vaultx.js                  # CLI entry
tests/
  *.test.js                  # Jest tests for DB and crypto
```

## Prerequisites
- Node.js 18+ (tested with Electron 38 toolchain)
- npm

## Install & develop
```bash
# install Node deps
npm ci

# start Electron app (development)
npm start

# run tests
npx jest
```

## CLI (vaultx)
You can run the CLI directly or install it globally.

### Quick use (from repo)
```bash
node src/cli/vaultx.js --help
```

### Global install
```bash
npm link    # or: npm i -g .
vaultx --help
```

### Default database path
- CLI: `~/.iic-vault/vault.db` (override with `--db /abs/path/to/db.sqlite`).
- Electron app: `app.getPath('userData')/vault.db`.

### Common commands
```bash
# create a user
vaultx user add --username alice --password s3cr3t --role user

# login (verifies password and logs a LOGIN event)
vaultx login --username alice --password s3cr3t

# upload (encrypts file bytes with your passphrase, stores metadata in DB)
vaultx file upload --path ./docs/report.pdf --owner default-admin --password "masterpass" --out ./encrypted

# list files accessible by a user (owner or via permissions)
vaultx file ls --user default-admin

# grant/revoke permissions
vaultx perm grant  --fileId file-123 --userId user-456 --perm read
vaultx perm revoke --fileId file-123 --userId user-456 --perm read

# download (decrypt with the same passphrase used on upload)
vaultx file download --fileId file-123 --password "masterpass" --dest ./out/report.pdf

# audit logs
vaultx logs
```

### Remote dashboard integration
- Login stores a bearer token at `~/.iic-vault/token.json`.
- You can override the API base via `--api` or by setting `SECURE_VAULT_API_BASE`.

```bash
# login to remote API (defaults to http://localhost:3001)
vaultx remote login --username alice --password s3cr3t --api http://localhost:3001

# show remote session status
vaultx remote status

# logout (clears stored token)
vaultx remote logout

# upload a file locally and also push encrypted bytes + metadata to server
vaultx file upload \
  --path ./docs/report.pdf \
  --owner default-admin \
  --password "masterpass" \
  --out ./encrypted \
  --remote \
  --api http://localhost:3001
```

<!-- Direct Supabase upload via CLI was removed to avoid exposing keys. Use the server-signed URL flow (`vaultx file upload --remote`) which relies on server-held credentials. -->

## Encryption design
- **KDF**: PBKDF2-SHA256, 32-byte key (AES-256), default 150,000 iterations, 16-byte random salt.
- **Cipher**: AES-256-GCM, 12-byte IV, 16-byte auth tag.
- **File format**: `[MAGIC(4) | saltLen(1) | ivLen(1) | iterations(4) | salt | iv | ciphertext | tag]`.
- **Name format**: `v1:<salt_b64url>:<iv_b64url>:<ct_b64url>:<tag_b64url>:<iterations>`.

Key APIs (`src/main/services/crypto-engine.js`):
- `encryptFile(password, inPath, outPath)` / `decryptFile(password, inPath, outPath)`
- `encryptBuffer(password, buffer)` / `decryptBuffer(password, encrypted)`
- `encryptName(password, name)` / `decryptName(password, token)`

## Database schema (high-level)
- `users(id, username UNIQUE, passwordHash, role CHECK in ['admin','user'])`
- `files(id, originalName, encryptedName, createdAt, lastModifiedUTC, version, ownerId)`
- `audit_log(id, timestamp, userId, action, details)`
- `permissions(fileId, userId, perm CHECK in ['read','write'], PRIMARY KEY(fileId,userId,perm))`

## Tests
```bash
npx jest

# includes
# - DatabaseManager: schema init, default admin seed, password verify, file CRUD, audit log
# - Crypto engine: buffer/name/file round-trips
```

## Progress log
- Added SQLite-backed `DatabaseManager` with tables: `users`, `files`, `audit_log`, later extended to `permissions`.
- Implemented `crypto-engine` with PBKDF2-SHA256 and AES-256-GCM for files and names.
- Wrote Jest tests for DB and crypto round-trips (all passing).
- Built `vaultx` CLI (users, login, upload/download, list files, permissions, logs) and wired as npm bin.
- Added audit logging for default admin seeding, user creation, successful login, upload/download, and permission changes.

## Roadmap
- Expose safe IPC APIs via `preload.js` and build a full renderer UI (login, file list, audit viewer).
- Optional KDF selection/flags (e.g., scrypt/argon2id) and configurable iterations in CLI.
- File storage strategy (configurable encrypted storage directory with absolute paths in DB).
- Role-based access checks in main process handlers.

