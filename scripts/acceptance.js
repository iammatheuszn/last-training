'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

const stages = [
  { name: 'test:all', args: ['run', 'test:all'], json: false },
  { name: 'build', args: ['run', 'build'], json: false },
  { name: 'preflight --json', args: ['run', 'preflight', '--', '--json'], json: true },
  { name: 'smoke:production', args: ['run', 'smoke:production'], json: true },
  { name: 'smoke:release', args: ['run', 'smoke:release'], json: true },
  { name: 'smoke:installer', args: ['run', 'smoke:installer'], json: true },
  { name: 'smoke:dr', args: ['run', 'smoke:dr'], json: true },
  { name: 'smoke:abuse', args: ['run', 'smoke:abuse'], json: true },
  { name: 'smoke:bundle', args: ['run', 'smoke:bundle'], json: true }
];

function parseReport(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function summarize(report) {
  if (!report) return 'sem relatório JSON';
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const passed = checks.filter(item => item.status === 'ok').length;
  return `${report.status || (report.ok ? 'ok' : 'fail')} / ${passed}${checks.length ? `/${checks.length}` : ''} checks`;
}

async function runStage(stage) {
  const started = Date.now();
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [npmCli, ...stage.args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024
    }));
  } catch (error) {
    const tail = [error.stderr, error.stdout, stderr, stdout].filter(Boolean).join('\n').trim();
    return {
      name: stage.name,
      status: 'fail',
      durationMs: Date.now() - started,
      detail: `${error.message}${tail ? `\n${tail.slice(-8000)}` : ''}`
    };
  }

  const durationMs = Date.now() - started;
  if (stage.json) {
    const report = parseReport(stdout);
    if (!report) {
      return { name: stage.name, status: 'fail', durationMs, detail: 'relatório JSON ausente' };
    }
    if (report.ok === false || report.status === 'fail') {
      return { name: stage.name, status: 'fail', durationMs, detail: summarize(report) };
    }
    return { name: stage.name, status: 'ok', durationMs, detail: summarize(report) };
  }

  const lines = stdout.split('\n');
  const counts = lines.filter(line => /^ℹ (tests|pass|fail)\b/.test(line)).map(line => line.trim()).join(' | ');
  const build = lines.filter(line => /built in|build complete/i.test(line)).slice(-2).map(line => line.trim()).join(' | ');
  return { name: stage.name, status: 'ok', durationMs, detail: counts || build || 'exit 0' };
}

async function acceptance() {
  const checks = [];
  for (const stage of stages) {
    const result = await runStage(stage);
    checks.push(result);
    if (result.status === 'fail') break;
  }
  const failed = checks.filter(item => item.status === 'fail');
  return {
    ok: failed.length === 0,
    status: failed.length ? 'fail' : 'ok',
    checks
  };
}

if (require.main === module) {
  acceptance()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { acceptance, runStage, parseReport, stages };
