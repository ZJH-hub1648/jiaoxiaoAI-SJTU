import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import {
  configPath,
  defaultCanvasTokenPath,
  loadConfig,
  removeCanvasToken,
  resolveTokenFilePath,
  saveCanvasToken,
} from '../scripts/lib/config.js';

const exec = promisify(execFile);
const skillRoot = resolve('.');
const tokenEnvironmentNames = [
  'SJTU_CANVAS_TOKEN',
  'CANVAS_API_TOKEN',
  'CANVAS_ACCESS_TOKEN',
];

async function withEnvironment(changes, run) {
  const names = [
    ...tokenEnvironmentNames,
    'SJTU_CANVAS_TOKEN_FILE',
    'JIAOXIAOAI_CONFIG',
    'CHROME_PATH',
    'HOME',
    'USERPROFILE',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      if (Object.hasOwn(changes, name)) {
        if (changes[name] === undefined) delete process.env[name];
        else process.env[name] = changes[name];
      }
    }
    return await run();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function isolatedEnv({ home, config, tokenFile = '', tokens = {} }) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    JIAOXIAOAI_CONFIG: config,
    SJTU_CANVAS_TOKEN_FILE: tokenFile,
    SJTU_CANVAS_TOKEN: '',
    CANVAS_API_TOKEN: '',
    CANVAS_ACCESS_TOKEN: '',
    CHROME_PATH: '',
    ...tokens,
  };
}

test('Token 文件按当前用户权限保存并可由兼容配置路径定位', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-config-'));
  const tokenPath = join(directory, 'nested', 'token');
  const legacyPath = join(directory, 'legacy.json');
  try {
    await withEnvironment(
      {
        JIAOXIAOAI_CONFIG: legacyPath,
        SJTU_CANVAS_TOKEN: undefined,
        CANVAS_API_TOKEN: undefined,
        CANVAS_ACCESS_TOKEN: undefined,
        SJTU_CANVAS_TOKEN_FILE: undefined,
      },
      async () => {
        await saveCanvasToken('test-secret', { tokenFile: tokenPath });
        if (process.platform !== 'win32') {
          assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
        }
        assert.equal(await readFile(tokenPath, 'utf8'), 'test-secret\n');
        const config = await loadConfig({ tokenFile: tokenPath });
        assert.equal(config.canvasToken, 'test-secret');
        assert.equal(config.source, 'explicit-token-file');
        assert.equal(config.tokenPath, tokenPath);
        assert.equal(config.configPath, legacyPath);
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('显式 Token 文件优先于所有环境变量', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-precedence-'));
  const tokenPath = join(directory, 'token');
  try {
    await writeFile(tokenPath, 'file-token\n', { mode: 0o600 });
    await withEnvironment(
      {
        JIAOXIAOAI_CONFIG: join(directory, 'missing.json'),
        SJTU_CANVAS_TOKEN_FILE: '',
        SJTU_CANVAS_TOKEN: 'sjtu-token',
        CANVAS_API_TOKEN: 'api-token',
        CANVAS_ACCESS_TOKEN: 'legacy-token',
      },
      async () => {
        const config = await loadConfig({ tokenFile: tokenPath });
        assert.equal(config.canvasToken, 'file-token');
        assert.equal(config.source, 'explicit-token-file');
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('环境变量按 SJTU、CANVAS_API、CANVAS_ACCESS 顺序读取', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-environment-'));
  try {
    await withEnvironment(
      {
        JIAOXIAOAI_CONFIG: join(directory, 'missing.json'),
        SJTU_CANVAS_TOKEN_FILE: '',
        SJTU_CANVAS_TOKEN: 'sjtu-token',
        CANVAS_API_TOKEN: 'api-token',
        CANVAS_ACCESS_TOKEN: 'legacy-token',
      },
      async () => {
        const preferred = await loadConfig();
        assert.equal(preferred.canvasToken, 'sjtu-token');
        assert.equal(preferred.source, 'environment:SJTU_CANVAS_TOKEN');
        assert.equal(preferred.tokenPath, null);

        process.env.SJTU_CANVAS_TOKEN = '';
        const api = await loadConfig();
        assert.equal(api.canvasToken, 'api-token');
        assert.equal(api.source, 'environment:CANVAS_API_TOKEN');

        process.env.CANVAS_API_TOKEN = '';
        const legacy = await loadConfig();
        assert.equal(legacy.canvasToken, 'legacy-token');
        assert.equal(legacy.source, 'environment:CANVAS_ACCESS_TOKEN');
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('损坏的兼容配置不会阻断统一环境变量 Token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-bad-legacy-'));
  const legacyPath = join(directory, 'config.json');
  try {
    await writeFile(legacyPath, '{not-json');
    await withEnvironment(
      {
        JIAOXIAOAI_CONFIG: legacyPath,
        SJTU_CANVAS_TOKEN_FILE: '',
        SJTU_CANVAS_TOKEN: 'new-token',
        CANVAS_API_TOKEN: '',
        CANVAS_ACCESS_TOKEN: '',
      },
      async () => {
        const config = await loadConfig();
        assert.equal(config.canvasToken, 'new-token');
        assert.equal(config.source, 'environment:SJTU_CANVAS_TOKEN');
        assert.match(config.legacyConfigError, /格式异常/);
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('默认 Token 文件可被独立 CLI 读取且不回显内容', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-default-'));
  const home = join(directory, 'home');
  const tokenPath = join(home, '.config', 'sjtu-canvas', 'token');
  try {
    await mkdir(join(home, '.config', 'sjtu-canvas'), { recursive: true });
    await writeFile(tokenPath, 'default-secret\n', { mode: 0o600 });
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'status'], {
      cwd: skillRoot,
      env: isolatedEnv({
        home,
        config: join(home, '.jiaoxiaoai', 'config.json'),
      }),
    });
    const result = JSON.parse(stdout);
    assert.equal(result.connected, true);
    assert.equal(result.credentialSource, 'default-token-file');
    assert.equal(result.tokenPath, tokenPath);
    assert.doesNotMatch(stdout, /default-secret|canvasToken/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('status 命令支持显式 Token 文件参数', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-status-file-'));
  const home = join(directory, 'home');
  const tokenPath = join(directory, 'explicit-token');
  try {
    await writeFile(tokenPath, 'explicit-secret\n', { mode: 0o600 });
    const { stdout } = await exec(
      process.execPath,
      ['scripts/jiaoxiaoai.mjs', 'status', '--token-file', tokenPath],
      {
        cwd: skillRoot,
        env: isolatedEnv({
          home,
          config: join(home, '.jiaoxiaoai', 'config.json'),
        }),
      },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.connected, true);
    assert.equal(result.credentialSource, 'explicit-token-file');
    assert.equal(result.tokenPath, tokenPath);
    assert.doesNotMatch(stdout, /explicit-secret/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('独立 CLI 无配置时返回 setup 指引且不泄露配置内容', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-status-'));
  const home = join(directory, 'home');
  try {
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'status'], {
      cwd: skillRoot,
      env: isolatedEnv({
        home,
        config: join(home, '.jiaoxiaoai', 'config.json'),
      }),
    });
    const result = JSON.parse(stdout);
    assert.equal(result.connected, false);
    assert.equal(result.dependencyReady, true);
    assert.equal(result.nodeSupported, true);
    assert.equal(result.runtimeReady, true);
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
  assert.ok(result.usage.some((line) => line.includes('classroom search')));
  assert.ok(result.usage.some((line) => line.includes('logout')));
  assert.ok(result.usage.some((line) => line.includes('--token-file')));
});

test('help 参数正常显示命令入口并以成功状态退出', async () => {
  const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', '--help'], {
    cwd: skillRoot,
  });
  const result = JSON.parse(stdout);
  assert.ok(result.usage.some((line) => line.includes('status')));
  assert.ok(result.usage.some((line) => line.includes('classroom read')));
  assert.ok(result.usage.some((line) => line.includes('classroom search')));
});

test('classroom search 在连接前拒绝空关键词和越界分页', async () => {
  await assert.rejects(
    exec(process.execPath, [
      'scripts/jiaoxiaoai.mjs',
      'classroom',
      'search',
      '--video',
      '55',
      '--query',
      '   ',
    ], { cwd: skillRoot }),
    /query 去除首尾空白后不能为空/,
  );
  await assert.rejects(
    exec(process.execPath, [
      'scripts/jiaoxiaoai.mjs',
      'classroom',
      'search',
      '--video',
      '55',
      '--query',
      '梯度',
      '--limit',
      '51',
    ], { cwd: skillRoot }),
    /limit/,
  );
});

test('logout 默认只删除技能 Token 文件与兼容配置，不删除下载目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-logout-'));
  const home = join(directory, 'home');
  const legacyPath = join(home, '.jiaoxiaoai', 'config.json');
  const tokenPath = join(home, '.config', 'sjtu-canvas', 'token');
  const downloadPath = join(directory, 'downloads', 'keep.txt');
  try {
    await mkdir(join(home, '.config', 'sjtu-canvas'), { recursive: true });
    await mkdir(join(home, '.jiaoxiaoai'), { recursive: true });
    await mkdir(join(directory, 'downloads'), { recursive: true });
    await writeFile(tokenPath, 'test-secret\n', { mode: 0o600 });
    await writeFile(legacyPath, '{"canvasToken":"old-secret"}\n', { mode: 0o600 });
    await writeFile(downloadPath, 'keep');

    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'logout'], {
      cwd: skillRoot,
      env: isolatedEnv({ home, config: legacyPath }),
    });
    const result = JSON.parse(stdout);
    assert.equal(result.localConfigCleared, true);
    assert.equal(result.tokenFileRemoved, true);
    assert.equal(result.legacyConfigRemoved, true);
    assert.deepEqual(result.environmentTokenRemaining, []);
    assert.match(result.revokeUrl, /^https:\/\/oc\.sjtu\.edu\.cn\//);
    assert.doesNotMatch(stdout, /test-secret|old-secret|canvasToken/);
    await assert.rejects(readFile(tokenPath, 'utf8'), (error) => error.code === 'ENOENT');
    await assert.rejects(readFile(legacyPath, 'utf8'), (error) => error.code === 'ENOENT');
    assert.equal(await readFile(downloadPath, 'utf8'), 'keep');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('显式共享 Token 文件必须确认后才可删除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-shared-'));
  const home = join(directory, 'home');
  const tokenPath = join(directory, 'shared-token');
  try {
    await writeFile(tokenPath, 'shared-secret\n', { mode: 0o600 });
    const env = isolatedEnv({
      home,
      config: join(home, '.jiaoxiaoai', 'config.json'),
      tokenFile: tokenPath,
    });
    await assert.rejects(
      exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'logout'], { cwd: skillRoot, env }),
      /confirm-token-file/,
    );
    assert.equal(await readFile(tokenPath, 'utf8'), 'shared-secret\n');

    const { stdout } = await exec(
      process.execPath,
      ['scripts/jiaoxiaoai.mjs', 'logout', '--confirm-token-file'],
      { cwd: skillRoot, env },
    );
    assert.doesNotMatch(stdout, /shared-secret/);
    await assert.rejects(readFile(tokenPath, 'utf8'), (error) => error.code === 'ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('logout 明确报告仍有效的环境变量 Token 名称', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-logout-env-'));
  const home = join(directory, 'home');
  try {
    const env = isolatedEnv({
      home,
      config: join(home, '.jiaoxiaoai', 'config.json'),
      tokens: { SJTU_CANVAS_TOKEN: 'env-secret' },
    });
    const { stdout } = await exec(process.execPath, ['scripts/jiaoxiaoai.mjs', 'logout'], {
      cwd: skillRoot,
      env,
    });
    const result = JSON.parse(stdout);
    assert.deepEqual(result.environmentTokenRemaining, ['SJTU_CANVAS_TOKEN']);
    assert.match(stdout, /SJTU_CANVAS_TOKEN/);
    assert.doesNotMatch(stdout, /env-secret|canvasToken/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Token 路径支持主目录简写且默认路径保持一致', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-home-'));
  try {
    await withEnvironment({ HOME: directory, USERPROFILE: directory }, async () => {
      assert.equal(defaultCanvasTokenPath(), join(directory, '.config', 'sjtu-canvas', 'token'));
      assert.equal(resolveTokenFilePath('~/private/token'), join(directory, 'private', 'token'));
      assert.equal(configPath(), join(directory, '.jiaoxiaoai', 'config.json'));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('removeCanvasToken 可报告默认文件不存在', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-skill-missing-token-'));
  try {
    await withEnvironment(
      {
        HOME: directory,
        USERPROFILE: directory,
        SJTU_CANVAS_TOKEN_FILE: undefined,
      },
      async () => {
        const result = await removeCanvasToken();
        assert.equal(result.path, join(directory, '.config', 'sjtu-canvas', 'token'));
        assert.equal(result.existed, false);
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
