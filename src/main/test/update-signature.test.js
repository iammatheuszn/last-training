'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  canonicalize,
  signedPayload,
  publicKeyFrom,
  verifySignedManifest,
  fetchSignedManifest
} = require('../update/signature');

function signed(override = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const manifest = {
    version: '1.2.3',
    publishedAt: '2026-01-01T00:00:00.000Z',
    files: [{
      url: 'https://updates.example.com/Last%20Training%20Setup.exe',
      sha512: 'a'.repeat(128),
      size: 1024
    }],
    signature: { algorithm: 'ed25519', keyId: 'test-1', signature: '' },
    ...override
  };
  manifest.signature.signature = crypto.sign(null, Buffer.from(signedPayload(manifest), 'utf8'), privateKey).toString('base64');
  return { manifest, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
}

test('canonicalização ordena chaves recursivamente', () => {
  const result = canonicalize({ b: 1, a: { d: 2, c: 3 } });
  assert.deepEqual(Object.keys(result), ['a', 'b']);
  assert.deepEqual(Object.keys(result.a), ['c', 'd']);
});

test('manifesto assinado valida e rejeita alteração', () => {
  const { manifest, publicKey } = signed();
  assert.equal(verifySignedManifest(manifest, publicKey), true);

  const tampered = { ...manifest, version: '9.9.9' };
  assert.throws(() => verifySignedManifest(tampered, publicKey), /Assinatura/);
});

test('manifesto rejeita arquivo sem HTTPS e hash inválido', () => {
  const { manifest, publicKey } = signed();
  manifest.files[0].url = 'http://updates.example.com/app.exe';
  assert.throws(() => verifySignedManifest(manifest, publicKey), /HTTPS/);

  const fixed = signed();
  fixed.manifest.files[0].sha512 = 'curto';
  assert.throws(() => verifySignedManifest(fixed.manifest, fixed.publicKey), /SHA-512/);
});

test('chave pública aceita PEM, hexadecimal e base64', () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const raw = der.subarray(-32);

  assert.equal(publicKeyFrom(pem).asymmetricKeyType, 'ed25519');
  assert.equal(publicKeyFrom(raw.toString('hex')).asymmetricKeyType, 'ed25519');
  assert.equal(publicKeyFrom(der.toString('base64')).asymmetricKeyType, 'ed25519');
});

test('busca do feed usa latest.json e valida assinatura', async () => {
  const { manifest, publicKey } = signed();
  let requested = '';
  const fakeFetch = async (url, options) => {
    requested = String(url);
    assert.equal(options.method, 'GET');
    return { ok: true, status: 200, json: async () => manifest };
  };

  const result = await fetchSignedManifest('https://updates.example.com/feed/', publicKey, fakeFetch);
  assert.equal(result.version, '1.2.3');
  assert.equal(requested, 'https://updates.example.com/feed/latest.json');

  await assert.rejects(
    () => fetchSignedManifest('https://updates.example.com/feed/', 'chave-invalida', fakeFetch)
  );
});
