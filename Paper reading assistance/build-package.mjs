#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, sha256 } from './lib/zip.js';
import { skillFiles } from './lib/deploy.js';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(await readFile(join(moduleRoot, 'package.json'), 'utf8'));
const prefix = 'paper-reading-assistance';
const entries = [];
for (const file of await skillFiles(moduleRoot)) {
  const raw = await readFile(file.source);
  entries.push({ path: `${prefix}/${file.path}`, data: file.path.endsWith('.sh') ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n')) : raw });
}
entries.push({ path: `${prefix}/PAPER-RELEASE.json`, data: Buffer.from(JSON.stringify({ name: metadata.name, version: metadata.version, node: metadata.engines.node,
  installation: ['npm ci --omit=dev'], start: 'node scripts/paper.mjs status', browser: 'node server.mjs', mcp: 'node mcp.mjs',
  features: ['standalone-skill', 'headless-tools', 'host-agent-model', 'mcp', 'local-ocr', 'visual-formula-figure-table', 'multi-paper-comparison'],
}, null, 2) + '\n') });
entries.sort((a, b) => a.path.localeCompare(b.path));
const bytes = buildZip(entries); const output = join(moduleRoot, 'release'); await mkdir(output, { recursive: true });
const filename = `${prefix}-v${metadata.version}.zip`; const path = join(output, filename); const digest = sha256(bytes);
await writeFile(path, bytes); await writeFile(path + '.sha256', `${digest}  ${filename}\n`);
console.log(JSON.stringify({ path, sha256: digest, bytes: bytes.length, files: entries.length, version: metadata.version }, null, 2));
