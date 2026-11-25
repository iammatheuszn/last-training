'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function verify(distDirectory) {
  const manifestPath = path.join(distDirectory, 'integrity.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: 'MANIFEST_MISSING', checked: 0 };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'MANIFEST_INVALID', checked: 0 };
  }
  if (manifest?.version !== 1 || !manifest.files || typeof manifest.files !== 'object') {
    return { ok: false, reason: 'MANIFEST_INVALID', checked: 0 };
  }

  const names = Object.keys(manifest.files);
  for (const name of names) {
    const expected = manifest.files[name];
    if (!/^[\w./-]+$/.test(name) || name.includes('..')) {
      return { ok: false, reason: 'ENTRY_INVALID', checked: 0 };
    }
    if (!/^[a-f0-9]{64}$/.test(expected?.sha256 || '')) {
      return { ok: false, reason: 'ENTRY_INVALID', checked: 0 };
    }
    const file = path.join(distDirectory, name);
    if (!fs.existsSync(file)) return { ok: false, reason: 'FILE_MISSING', checked: 0 };
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (digest !== expected.sha256) return { ok: false, reason: 'HASH_MISMATCH', checked: 0 };
  }

  return { ok: true, reason: 'OK', checked: names.length };
}

module.exports = { verify };
