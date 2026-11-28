#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildZip, sha256 } from './lib/zip.mjs';
import { skillFiles, SKILL_ROOT } from './lib/deploy.mjs';

const metadata = JSON.parse(await readFile(join(SKILL_ROOT,'package.json'),'utf8'));
const entries = [];
for (const file of await skillFiles()) {
  const bytes = await readFile(file.source);
  // Every release source is UTF-8 text; normalize Git's Windows CRLF for reproducible archives.
  entries.push({ path: `project-interview/${file.path}`, data: Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')) });
}
const manifest = { name: metadata.name, version: metadata.version, node: metadata.engines.node, cli: 'node scripts/interview.mjs status', mcp: 'npm ci --omit=dev; node mcp.mjs', files: entries.map(file => ({ path: file.path, sha256: sha256(file.data) })) };
entries.push({ path: 'project-interview/RELEASE.json', data: Buffer.from(JSON.stringify(manifest,null,2) + '\n') });
const zip = buildZip(entries), directory = join(SKILL_ROOT,'release'), filename = `project-interview-v${metadata.version}.zip`;
await mkdir(directory,{ recursive: true }); await writeFile(join(directory,filename),zip); await writeFile(join(directory,filename + '.sha256'),`${sha256(zip)}  ${filename}\n`);
console.log(JSON.stringify({ path: join(directory,filename), sha256: sha256(zip), files: entries.length, bytes: zip.length, version: metadata.version },null,2));
