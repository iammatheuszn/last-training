'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = String(process.env.LT_SERVER_PORT || '8787');
const base = String(process.env.LT_BASE_URL || `https://127.0.0.1:${port}`).replace(/\/+$/, '');
const dir = path.join(root, 'config');
const file = path.join(dir, 'runtime.json');

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, `${JSON.stringify({ authApiBaseUrl: base }, null, 2)}\n`, { mode: 0o600 });
console.log(`endpoint do cliente registrado em ${path.relative(root, file)}: ${base}`);
