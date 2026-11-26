import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { saveText, saveWebStream } from '../scripts/lib/files.js';

test('并发同名文稿与下载自动编号并保留每份内容', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-files-concurrent-'));
  try {
    await writeFile(join(directory, 'slides.txt'), 'original');
    const results = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const content = `payload-${index}`;
      const path = index % 2
        ? await saveText({ directory, name: 'slides.txt', text: content })
        : (await saveWebStream({ directory, name: 'slides.txt', body: new Response(content).body, expectedSize: Buffer.byteLength(content) })).path;
      return { path, content };
    }));
    assert.equal(new Set(results.map((result) => result.path)).size, 12);
    for (const result of results) assert.equal(await readFile(result.path, 'utf8'), result.content);
    assert.equal(await readFile(join(directory, 'slides.txt'), 'utf8'), 'original');
    assert.equal((await readdir(directory)).length, 13);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('不完整下载清理临时文件并保留原文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-files-incomplete-'));
  try {
    await writeFile(join(directory, 'keep.ppt'), 'original');
    await assert.rejects(saveWebStream({ directory, name: 'keep.ppt', body: new Response('short').body, expectedSize: 100 }), /下载不完整/);
    assert.deepEqual(await readdir(directory), ['keep.ppt']);
    assert.equal(await readFile(join(directory, 'keep.ppt'), 'utf8'), 'original');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
