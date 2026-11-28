import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

export const RELEASE_INCLUDE = [
  '.gitignore',
  '.github',
  'SKILL.md',
  'README.md',
  'INSTALL.md',
  'PRIVACY.md',
  'start-installer.cmd',
  'start-installer.sh',
  'package.json',
  'package-lock.json',
  'installer',
  'Paper reading assistance',
  'project-interview',
  'scripts',
  'references',
  'docs',
  'agents',
  'tests',
];

const EXCLUDED_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.env',
  'node_modules',
  'dist',
  '__pycache__',
  '.pytest_cache',
  'release',
  'papers',
  'model.json',
  'paper.json',
  'source.pdf',
  'snapshots',
  'sessions',
  'jobs',
  'locks',
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipPath(path) {
  return path.split(sep).join('/');
}

async function collectDirectory(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name) || /\.py[cod]$/i.test(entry.name)) continue;
    const source = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`发行包不允许符号链接：${source}`);
    if (entry.isDirectory()) {
      await collectDirectory(root, source, files);
    } else if (entry.isFile()) {
      files.push({ source, path: zipPath(relative(root, source)) });
    }
  }
}

export async function collectReleaseFiles(root) {
  const files = [];
  for (const entry of RELEASE_INCLUDE) {
    const source = join(root, entry);
    let info;
    try {
      info = await lstat(source);
    } catch (error) {
      if (error?.code === 'ENOENT' && entry === '.gitignore') continue;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`发行包不允许符号链接：${source}`);
    if (info.isDirectory()) await collectDirectory(root, source, files);
    else if (info.isFile()) files.push({ source, path: zipPath(entry) });
  }
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('发行包根目录必须包含 SKILL.md');
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function writeLocalHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.uncompressed.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function writeCentralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.uncompressed.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const sourceEntry of entries) {
    const uncompressed = sourceEntry.data;
    const deflated = deflateRawSync(uncompressed, { level: 9 });
    const method = deflated.length < uncompressed.length ? 8 : 0;
    const compressed = method === 8 ? deflated : uncompressed;
    const entry = {
      name: Buffer.from(sourceEntry.path, 'utf8'),
      crc: crc32(uncompressed),
      method,
      compressed,
      uncompressed,
      offset,
    };
    const local = writeLocalHeader(entry);
    const central = writeCentralHeader(entry);
    localParts.push(local, entry.name, compressed);
    centralParts.push(central, entry.name);
    offset += local.length + entry.name.length + compressed.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function createReleaseArchive({ root = resolve('.'), outputDirectory = join(root, 'dist', 'releases') } = {}) {
  const projectRoot = resolve(root);
  const packageData = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const version = String(packageData.version || '').trim();
  if (!version) throw new Error('package.json 缺少 version');
  const files = await collectReleaseFiles(projectRoot);
  const prefix = `sjtu-canvas-v${version}`;
  const manifest = Buffer.from(`${JSON.stringify({
    name: 'sjtu-canvas',
    version,
    python: '>=3.9',
    node: packageData.engines?.node || '>=22.13.0',
    installation: 'INSTALL.md',
    privacy: 'PRIVACY.md',
  }, null, 2)}\n`, 'utf8');
  const entries = [];
  for (const file of files) {
    entries.push({ path: `${prefix}/${file.path}`, data: await readFile(file.source) });
  }
  entries.push({ path: `${prefix}/RELEASE.json`, data: manifest });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const archive = buildZip(entries);
  const targetDirectory = resolve(outputDirectory);
  await mkdir(targetDirectory, { recursive: true });
  const archivePath = join(targetDirectory, `${prefix}.zip`);
  const checksumPath = `${archivePath}.sha256`;
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });
  const digest = sha256(archive);
  await writeFile(archivePath, archive, { mode: 0o600 });
  await writeFile(checksumPath, `${digest}  ${basename(archivePath)}\n`, { encoding: 'utf8', mode: 0o600 });
  return {
    archivePath,
    checksumPath,
    bytes: archive.length,
    sha256: digest,
    fileCount: entries.length,
    version,
  };
}
