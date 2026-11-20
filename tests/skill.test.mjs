import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { configPath, loadConfig, saveConfig } from '../scripts/lib/config.js';

const exec = promisify(execFile);
const skillRoot = resolve('.');

function isolatedEnv(config) {
  return { ...process.env, JIAOXIAOAI_CONFIG: config, CANVAS_ACCESS_TOKEN: '', CHROME_PATH: '' };
}

test('独立 skill 的本地配置仅当前用户可读写', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-config-'));
  const path = join(directory, 'nested', 'config.json');
  const previous = process.env.JIAOXIAOAI_CONFIG;
  process.env.JIAOXIAOAI_CONFIG = path;
  try {
    assert.equal(configPath(), path);
    await saveConfig({ canvasToken: 'test-secret', chromePath: '/Applications/Google Chrome.app' });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(stored.canvasToken, 'test-secret');
    const config = await loadConfig();
    assert.equal(config.canvasToken, 'test-secret');
    assert.equal(config.source, 'local-config');
    assert.equal(config.chromePath, '/Applications/Google Chrome.app');
  } finally {
    if (previous === undefined) delete process.env.JIAOXIAOAI_CONFIG;
    else process.env.JIAOXIAOAI_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('独立 CLI 无配置时返回 setup 指引且不泄露配置内容', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-status-'));
  try {
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'status'], {
      cwd: skillRoot,
      env: isolatedEnv(join(directory, 'missing.json')),
    });
    const result = JSON.parse(stdout);
    assert.equal(result.connected, false);
    assert.equal(result.dependencyReady, true);
    assert.match(result.next, /setup/);
    assert.doesNotMatch(stdout, /canvasToken|test-secret/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('独立 CLI 不依赖 DSH 插件即可输出命令入口', async () => {
  const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs'], { cwd: skillRoot });
  const result = JSON.parse(stdout);
  assert.ok(result.usage.some((line) => line.includes('canvas download')));
  assert.ok(result.usage.some((line) => line.includes('classroom download')));
  assert.ok(result.usage.some((line) => line.includes('logout')));
});

test('logout 删除本地 Token 配置且不回显秘密', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-logout-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, '{"canvasToken":"test-secret"}\n', { mode: 0o600 });
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'logout'], {
      cwd: skillRoot,
      env: isolatedEnv(path),
    });
    const result = JSON.parse(stdout);
    assert.equal(result.localConfigCleared, true);
    assert.equal(result.environmentTokenRemaining, false);
    assert.match(result.revokeUrl, /^https:\/\/oc\.sjtu\.edu\.cn\//);
    assert.doesNotMatch(stdout, /test-secret|canvasToken/);
    await assert.rejects(readFile(path, 'utf8'), (error) => error.code === 'ENOENT');
    const status = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'status'], {
      cwd: skillRoot,
      env: isolatedEnv(path),
    });
    assert.equal(JSON.parse(status.stdout).connected, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('logout 明确提示环境变量 Token 仍需清除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-logout-env-'));
  try {
    const env = { ...isolatedEnv(join(directory, 'missing.json')), CANVAS_ACCESS_TOKEN: 'test-secret' };
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'logout'], { cwd: skillRoot, env });
    assert.equal(JSON.parse(stdout).environmentTokenRemaining, true);
    assert.match(stdout, /环境变量/);
    assert.doesNotMatch(stdout, /test-secret|canvasToken/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
