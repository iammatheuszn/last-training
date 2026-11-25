'use strict';

const fs = require('node:fs');
const path = require('node:path');
const selfsigned = require('selfsigned');

const dir = path.join(__dirname, '..', 'certs');
const keyPath = path.join(dir, 'dev.key');
const certPath = path.join(dir, 'dev.crt');
const force = process.argv.includes('--force');

if (!force && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('certificado de desenvolvimento já existe');
  process.exit(0);
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });

  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: 'localhost' },
      { name: 'organizationName', value: 'Last Training Development' }
    ],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, value: '127.0.0.1' }
          ]
        },
        { name: 'basicConstraints', cA: true, critical: true },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true,
          keyCertSign: true
        }
      ]
    }
  );

  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert, { mode: 0o644 });
  console.log(`certificado de desenvolvimento criado em ${path.relative(process.cwd(), certPath)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
