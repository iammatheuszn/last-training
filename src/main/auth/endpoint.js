'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENV_KEY = 'LT_AUTH_API_BASE_URL';

function runtimeFiles() {
  const files = [path.join(__dirname, '..', '..', 'config', 'runtime.json')];
  if (process.resourcesPath) files.push(path.join(process.resourcesPath, 'runtime.json'));
  if (process.env.APPDATA) files.push(path.join(process.env.APPDATA, 'Last Training', 'runtime.json'));
  return files;
}

function fromFile(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return typeof parsed?.authApiBaseUrl === 'string' ? parsed.authApiBaseUrl.trim() : '';
  } catch {
    return '';
  }
}

function resolveAuthBaseDetailed(env = process.env, files = runtimeFiles()) {
  const fromEnv = String(env[ENV_KEY] || '').trim();
  if (fromEnv) {
    return {
      base: fromEnv.replace(/\/+$/, ''),
      source: 'env',
      sourceLabel: ENV_KEY
    };
  }
  for (const filename of files) {
    const value = fromFile(filename);
    if (value) {
      return {
        base: value.replace(/\/+$/, ''),
        source: 'runtime',
        sourceLabel: path.relative(process.cwd(), filename) || filename
      };
    }
  }
  return { base: '', source: 'none', sourceLabel: '—' };
}

function resolveAuthBase(env = process.env, files = runtimeFiles()) {
  return resolveAuthBaseDetailed(env, files).base;
}

module.exports = {
  resolveAuthBase,
  resolveAuthBaseDetailed,
  runtimeFiles,
  ENV_KEY
};
