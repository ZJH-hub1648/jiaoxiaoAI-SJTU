import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  installSkill,
  resolveInstallTarget,
  detectPlatforms,
} from '../installer/lib/operations.js';
import { createInstallerServer } from '../installer/lib/server.js';

const sourceRoot = resolve('.');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('安装向导识别 Codex、DSH、WorkBuddy 和自定义目录', async () => {
  const home = join(tmpdir(), 'jx-installer-home');
  const platforms = await detectPlatforms(home);
  assert.deepEqual(platforms.map((platform) => platform.id), ['codex', 'dsh', 'workbuddy']);
  assert.equal(
    resolveInstallTarget({ platformId: 'codex' }, home),
    join(home, '.agents', 'skills', 'sjtu-canvas'),
  );
  assert.equal(
    resolveInstallTarget({ platformId: 'custom', customPath: join(home, 'custom') }, home),
    join(home, 'custom'),
  );
  assert.throws(
    () => resolveInstallTarget({ platformId: 'custom', customPath: 'relative/path' }, home),
    /绝对安装目录/,
  );
});
test('安装复制完整技能、生成管理标记且不包含依赖目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-installer-copy-'));
  const target = join(directory, 'skills', 'sjtu-canvas');
  try {
    const result = await installSkill({ sourceRoot, target });
    assert.equal(result.changed, true);
    assert.equal(result.backupPath, null);
    assert.equal(await exists(join(target, 'SKILL.md')), true);
    assert.equal(await exists(join(target, 'installer', 'ui', 'index.html')), true);
    assert.equal(await exists(join(target, 'start-installer.cmd')), true);
    assert.equal(await exists(join(target, 'node_modules')), false);
    const marker = JSON.parse(await readFile(join(target, '.jiaoxiaoai-managed.json'), 'utf8'));
    assert.equal(marker.managed, true);

    const updated = await installSkill({ sourceRoot, target });
    assert.equal(updated.changed, true);
    assert.ok(updated.backupPath);
    assert.equal(await exists(updated.backupPath), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('安装向导拒绝覆盖非受管目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-installer-unmanaged-'));
  const target = join(directory, 'occupied');
  try {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'keep.txt'), 'keep');
    await assert.rejects(
      installSkill({ sourceRoot, target }),
      /目标目录已存在其他内容/,
    );
    assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('本地服务要求安装会话，并拒绝跨来源写请求', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-installer-server-'));
  const instance = await createInstallerServer({
    sourceRoot,
    home: directory,
    session: 'test-session',
  });
  try {
    const first = await fetch(instance.url, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const cookie = first.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie, /^jiaoxiao_installer=test-session$/);

    const unauthorized = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/state`);
    assert.equal(unauthorized.status, 403);

    const stateResponse = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/state`, {
      headers: { cookie },
    });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.ok, true);
    assert.equal(state.environment.node.supported, true);

    const crossOrigin = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/install`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});
