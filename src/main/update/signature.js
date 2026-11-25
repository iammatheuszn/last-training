'use strict';

const crypto = require('node:crypto');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function signedPayload(manifest) {
  return JSON.stringify(canonicalize({
    version: manifest?.version,
    publishedAt: manifest?.publishedAt,
    files: manifest?.files
  }));
}

function publicKeyFrom(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Chave pública de atualização ausente');

  if (text.includes('BEGIN PUBLIC KEY')) return crypto.createPublicKey(text);

  let raw;
  if (/^[a-f0-9]{64}$/i.test(text)) raw = Buffer.from(text, 'hex');
  else raw = Buffer.from(text.replace(/\s+/g, ''), 'base64');

  if (raw.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki'
    });
  }
  return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifesto de atualização inválido');
  if (!/^\d+\.\d+\.\d+/.test(String(manifest.version || ''))) throw new Error('Versão do manifesto inválida');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Manifesto sem arquivos');
  }
  for (const file of manifest.files) {
    if (!/^https:\/\//i.test(String(file.url || ''))) throw new Error('Arquivo de atualização precisa de URL HTTPS');
    if (!/^[a-f0-9]{128}$/i.test(String(file.sha512 || ''))) throw new Error('Hash SHA-512 do arquivo inválido');
    if (!Number.isInteger(file.size) || file.size <= 0) throw new Error('Tamanho do arquivo inválido');
  }
  return true;
}

function verifySignedManifest(manifest, publicKey) {
  validateManifest(manifest);
  const signature = manifest.signature;
  if (!signature || signature.algorithm !== 'ed25519') {
    throw new Error('Assinatura de atualização ausente ou não suportada');
  }
  const bytes = Buffer.from(String(signature.signature || ''), 'base64');
  const key = publicKeyFrom(publicKey);
  const valid = crypto.verify(
    null,
    Buffer.from(signedPayload(manifest), 'utf8'),
    key,
    bytes
  );
  if (!valid) throw new Error('Assinatura de atualização inválida');
  return true;
}

async function fetchSignedManifest(baseUrl, publicKey, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponível no processo principal');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/latest.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-store' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Feed de atualização respondeu ${response.status}`);
    const manifest = await response.json();
    verifySignedManifest(manifest, publicKey);
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  canonicalize,
  signedPayload,
  publicKeyFrom,
  validateManifest,
  verifySignedManifest,
  fetchSignedManifest
};
