const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

let apiBase = process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001';

function setApiBase(base) {
  if (base && typeof base === 'string') {
    apiBase = base;
  }
}

async function login(username, password) {
  const res = await fetch(`${apiBase}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`API login failed (${res.status})`);
  return res.json(); // { token, user }
}

async function getSignedUploadUrl(fileName, token) {
  const res = await fetch(`${apiBase}/files/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ fileName }),
  });
  if (!res.ok) throw new Error(`Failed to get signed URL (${res.status})`);
  return res.json(); // { signedUrl, path }
}

async function persistMetadata(metadata, token) {
  const res = await fetch(`${apiBase}/files/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(`Metadata persist failed (${res.status})`);
  return res.json(); // { ok: true }
}

// List user's files for sync
async function syncFiles(token) {
  const res = await fetch(`${apiBase}/files`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sync list failed (${res.status})`);
  return res.json();
}

// Request signed download URL by storagePath
async function getDownloadUrl(storagePath, token) {
  const res = await fetch(`${apiBase}/files/download-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ storagePath }),
  });
  if (!res.ok) throw new Error(`Download URL failed (${res.status})`);
  return res.json(); // { signedUrl }
}

module.exports = {
  login,
  getSignedUploadUrl,
  persistMetadata,
  setApiBase,
  syncFiles,
  getDownloadUrl,
};