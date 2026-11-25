import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const groups = [
  ['src', new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css'])],
  ['server', new Set(['.js', '.mjs'])],
  ['scripts', new Set(['.js', '.mjs'])],
  ['admin-web/src', new Set(['.ts', '.tsx', '.css'])],
  ['admin-web', new Set(['.ts', '.mjs'])]
];

function walk(dir, extensions, found) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['dist', 'node_modules', 'release'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, extensions, found);
    else if (extensions.has(path.extname(entry.name))) found.add(target);
  }
}

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function rangesForScript(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  if (source.parseDiagnostics.length) {
    const first = source.parseDiagnostics[0];
    const detail = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    throw new Error(`${path.relative(root, file)}: ${detail}`);
  }
  const ranges = [];
  const seen = new Set();

  function add(comment) {
    const start = comment.pos;
    const end = comment.end;
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push([start, end]);
  }

  function visit(node) {
    for (const comment of ts.getLeadingCommentRanges(text, node.getFullStart()) || []) add(comment);
    for (const comment of ts.getTrailingCommentRanges(text, node.getEnd()) || []) add(comment);
    ts.forEachChild(node, visit);
  }

  visit(source);
  return ranges;
}

function rangesForCss(text) {
  const ranges = [];
  const pattern = /\/\*[\s\S]*?\*\//g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function lineNumbers(text, ranges) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  const lines = new Set();
  for (const [start, end] of ranges) {
    for (let line = 0; line < starts.length; line += 1) {
      const next = line + 1 < starts.length ? starts[line + 1] : text.length + 1;
      if (start < next && end > starts[line]) lines.add(line + 1);
    }
  }
  return lines;
}

function strip(text, file) {
  const ranges = path.extname(file) === '.css' ? rangesForCss(text) : rangesForScript(text, file);
  if (!ranges.length) return text;
  const lines = lineNumbers(text, ranges);
  let output = text;
  for (const [start, end] of [...ranges].reverse()) output = output.slice(0, start) + output.slice(end);
  return output
    .split(/\r?\n/)
    .filter((value, index) => !(lines.has(index + 1) && !value.trim()))
    .join('\n');
}

const files = new Set();
for (const [target, extensions] of groups) walk(path.join(root, target), extensions, files);
files.add(path.join(root, 'vite.config.mjs'));

let changed = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const cleaned = strip(original, file);
  if (cleaned !== original) {
    fs.writeFileSync(file, cleaned);
    changed += 1;
  }
}

console.log(`${changed} arquivo(s) limpo(s)`);
