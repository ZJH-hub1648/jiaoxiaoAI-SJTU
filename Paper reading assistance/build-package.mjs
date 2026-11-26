#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReleaseFiles, buildZip, sha256 } from '../scripts/lib/release.js';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleRoot, '..');
const metadata = JSON.parse(await readFile(join(moduleRoot, 'package.json'), 'utf8'));
const prefix = `paper-reading-assistance-v${metadata.version}`;
const entries = [];
for (const file of await collectReleaseFiles(root)) entries.push({ path: `${prefix}/${file.path}`, data: await readFile(file.source) });
entries.push({ path: `${prefix}/PAPER-RELEASE.json`, data: Buffer.from(JSON.stringify({ name: metadata.name, version: metadata.version, node: metadata.engines.node,
  installation: ['npm ci', 'npm --prefix "Paper reading assistance" ci'], start: 'npm run reader', source: 'Paper reading assistance',
  features: ['local-ocr', 'visual-formula-figure-table', 'ollama-and-compatible-models', 'multi-paper-comparison'],
}, null, 2) + '\n') });
entries.sort((a, b) => a.path.localeCompare(b.path));
const bytes = buildZip(entries); const output = join(moduleRoot, 'release'); await mkdir(output, { recursive: true });
const path = join(output, `${prefix}.zip`); const digest = sha256(bytes);
await writeFile(path, bytes); await writeFile(path + '.sha256', `${digest}  ${prefix}.zip\n`);
console.log(JSON.stringify({ path, sha256: digest, bytes: bytes.length, files: entries.length, version: metadata.version }, null, 2));
