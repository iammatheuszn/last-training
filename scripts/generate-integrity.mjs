import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const exclude = new Set(['integrity.json']);
const manifest = { version: 1, generatedAt: new Date().toISOString(), files: {} };

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const relative = path.relative(dist, full).replaceAll('\\', '/');
    const bytes = fs.readFileSync(full);
    manifest.files[relative] = {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    };
  }
}

walk(dist);
fs.writeFileSync(path.join(dist, 'integrity.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`integrity: ${Object.keys(manifest.files).length} arquivos`);
