const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const apiBase = process.env.SECURE_VAULT_API_BASE || 'http://localhost:3001';

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

module.exports = {
  login,
  getSignedUploadUrl,
  persistMetadata,
};