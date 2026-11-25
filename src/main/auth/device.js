'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FILENAME = 'device.json';

const location = () => path.join(app.getPath('userData'), FILENAME);

function machineGuid() {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true, timeout: 2000 }
      );
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(output);
      if (match) return match[1].trim().slice(0, 128);
    } catch {
    }
  }
  return createHash('sha256')
    .update(`${os.hostname()}|${os.userInfo().username}|${process.platform}|${os.arch()}`)
    .digest('hex');
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(location(), 'utf8'));
    if (!UUID_PATTERN.test(data?.id || '')) return null;
    return {
      id: data.id,
      name: String(data.name || '').slice(0, 80),
      hwid: String(data.hwid || '').slice(0, 128)
    };
  } catch {
    return null;
  }
}

function save(device) {
  try {
    fs.writeFileSync(location(), JSON.stringify(device), { mode: 0o600 });
  } catch {
  }
}

function ensure() {
  const existing = load();
  if (existing) {
    if (!existing.hwid) {
      existing.hwid = machineGuid();
      save(existing);
    }
    return existing;
  }
  const device = {
    id: randomUUID(),
    name: `${process.env.COMPUTERNAME || process.env.HOSTNAME || 'windows'}-${app.getVersion()}`.slice(0, 80),
    hwid: machineGuid()
  };
  save(device);
  return device;
}

module.exports = { ensure, load, machineGuid };
