import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildZip, createReleaseArchive, sha256 } from '../scripts/lib/release.js';

test('ZIP 构建器写入 UTF-8 文件名、内容和 SHA-256', () => {
  const archive = buildZip([
    { path: 'skill/SKILL.md', data: Buffer.from('---\nname: test\n---\n') },
    { path: 'skill/中文.txt', data: Buffer.from('测试内容') },
  ]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.match(archive.toString('utf8'), /skill\/SKILL\.md/);
  assert.match(archive.toString('utf8'), /skill\/中文\.txt/);
  assert.match(sha256(archive), /^[a-f0-9]{64}$/);
});

test('发行包包含技能源码和校验文件并排除开发依赖目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-release-'));
  const root = join(directory, 'skill');
  const output = join(directory, 'output');
  try {
    await mkdir(root, { recursive: true });
    for (const name of ['scripts', 'references', 'docs', 'agents', 'tests', '.github']) {
      await mkdir(join(root, name), { recursive: true });
    }
    await writeFile(join(root, 'SKILL.md'), '---\nname: sjtu-canvas\ndescription: test\n---\n');
    await writeFile(join(root, 'README.md'), '# test\n');
    await writeFile(join(root, 'INSTALL.md'), '# install\n');
    await writeFile(join(root, 'PRIVACY.md'), '# privacy\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test', version: '1.3.0-rc.1' }));
    await writeFile(join(root, 'package-lock.json'), '{}');
    const result = await createReleaseArchive({ root, outputDirectory: output });
    const archive = await readFile(result.archivePath);
    assert.equal(result.version, '1.3.0-rc.1');
    assert.equal(result.bytes, (await stat(result.archivePath)).size);
    assert.equal(result.sha256, sha256(archive));
    assert.match(archive.toString('utf8'), /sjtu-canvas-v1\.3\.0-rc\.1\/README\.md/);
    assert.match(archive.toString('utf8'), /sjtu-canvas-v1\.3\.0-rc\.1\/RELEASE\.json/);
    assert.doesNotMatch(archive.toString('utf8'), /node_modules/);
    assert.match(await readFile(result.checksumPath, 'utf8'), new RegExp(`^${result.sha256}  `));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
