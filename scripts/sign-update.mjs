import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signedPayload } = require('../src/main/update/signature.js');

function parse(argv) {
  const options = { dir: 'release', files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
    } else {
      options.files.push(token);
    }
  }
  return options;
}

function privateKeyFrom(options) {
  if (options.key) return crypto.createPrivateKey(options.key);
  const file = options['key-path'] || process.env.LT_UPDATE_PRIVATE_KEY_PATH;
  if (file) return crypto.createPrivateKey(fs.readFileSync(path.resolve(file)));
  const rawText = String(process.env.LT_UPDATE_PRIVATE_KEY || '').trim();
  if (!rawText) throw new Error('Informe --key, --key-path ou LT_UPDATE_PRIVATE_KEY');
  if (rawText.includes('BEGIN PRIVATE KEY')) return crypto.createPrivateKey(rawText);
  const raw = /^[a-f0-9]{64}$/i.test(rawText)
    ? Buffer.from(rawText, 'hex')
    : Buffer.from(rawText.replace(/\s+/g, ''), 'base64');
  if (raw.length !== 32) throw new Error('Chave privada Ed25519 deve ter 32 bytes');
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function publicKeyText(key) {
  return crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' });
}

function baseUrl(options) {
  const value = String(options.base || process.env.LT_UPDATE_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(value)) throw new Error('LT_UPDATE_URL precisa ser HTTPS');
  return value;
}

function main() {
  const options = parse(process.argv.slice(2));
  if (!options.version || options.version === true) throw new Error('--version é obrigatório');
  if (!options.files.length) throw new Error('Informe ao menos um arquivo para assinar');

  const key = privateKeyFrom(options);
  const directory = path.resolve(options.dir);
  const origin = baseUrl(options);
  const files = options.files.map(name => {
    const file = path.resolve(directory, name);
    const bytes = fs.readFileSync(file);
    return {
      url: `${origin}/${path.basename(name).replace(/ /g, '%20')}`,
      sha512: crypto.createHash('sha512').update(bytes).digest('hex'),
      size: bytes.length,
      name: path.basename(name)
    };
  });

  const publishedAt = new Date().toISOString();
  const manifest = {
    version: String(options.version),
    publishedAt,
    files,
    signature: {
      algorithm: 'ed25519',
      keyId: String(options['key-id'] || 'last-training-update-1'),
      signature: ''
    }
  };
  manifest.signature.signature = crypto.sign(
    null,
    Buffer.from(signedPayload(manifest), 'utf8'),
    key
  ).toString('base64');

  const out = path.resolve(options.out || path.join(directory, 'latest.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

  const latestYml = [
    `version: ${manifest.version}`,
    `releaseDate: ${publishedAt}`,
    'files:',
    ...files.flatMap(file => [
      `  - url: ${file.url}`,
      `    sha512: ${crypto.createHash('sha512').update(fs.readFileSync(path.resolve(directory, file.name))).digest('base64')}`,
      `    size: ${file.size}`
    ]),
    `path: ${files[0].url}`,
    `sha512: ${crypto.createHash('sha512').update(fs.readFileSync(path.resolve(directory, files[0].name))).digest('base64')}`
  ].join('\n');
  fs.writeFileSync(path.join(directory, 'latest.yml'), `${latestYml}\n`, { mode: 0o644 });

  if (options['emit-public']) {
    fs.writeFileSync(path.resolve(options['emit-public']), publicKeyText(key), { mode: 0o644 });
  }

  console.log(`update: ${manifest.version} assinado em ${out}`);
  if (options['show-public']) process.stdout.write(publicKeyText(key));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
