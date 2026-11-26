import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  dependencyReady,
  detectEnvironment,
  detectPlatforms,
  installSkill,
  resolveInstallTarget,
  targetSummary,
} from './operations.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_ROOT = resolve(MODULE_DIR, '..', '..');
const UI_ROOT = resolve(MODULE_DIR, '..', 'ui');
const MAX_BODY_BYTES = 16 * 1024;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value !== undefined),
  );
}

function parseSession(url) {
  return url.searchParams.get('session') || '';
}

function json(res, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Content-Length': body.length,
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求数据格式无效');
  }
}

async function loadSkillModules(sourceRoot) {
  const config = await import(pathToFileURL(join(sourceRoot, 'scripts', 'lib', 'config.js')).href);
  const canvas = await import(pathToFileURL(join(sourceRoot, 'scripts', 'lib', 'canvas.js')).href);
  return { config, canvas };
}

function npmCommand() {
  return process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm']]
    : ['npm', []];
}

function createDependencyJob(target) {
  const job = {
    status: 'running',
    phase: '正在安装 PPT 与课堂模块依赖',
    output: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
  };
  const [command, prefixArgs] = npmCommand();
  const child = spawn(command, [...prefixArgs, 'ci', '--no-audit', '--no-fund'], {
    cwd: target,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => {
    job.output = `${job.output}${chunk.toString('utf8')}`.slice(-12000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (error) => {
    job.status = 'failed';
    job.phase = `依赖安装失败：${error.message}`;
    job.finishedAt = new Date().toISOString();
  });
  child.on('close', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'succeeded' : 'failed';
    job.phase = code === 0 ? 'PPT 与课堂模块已就绪' : '依赖安装未完成，可重试';
    job.finishedAt = new Date().toISOString();
  });
  return { job, child };
}

export function openExternal(url) {
  if (process.env.JIAOXIAOAI_INSTALLER_NO_OPEN === '1') return false;
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return true;
}

export function openBrowserWindow(url) {
  if (process.env.JIAOXIAOAI_INSTALLER_NO_OPEN === '1') return 'disabled';
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter(Boolean);
    const candidates = roots.flatMap((root) => [
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
    const executable = candidates.find((candidate) => existsSync(candidate));
    if (executable) {
      const child = spawn(executable, [
        `--app=${url}`,
        '--window-size=1120,800',
        '--no-first-run',
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return executable;
    }
  }
  openExternal(url);
  return 'default-browser';
}

export async function createInstallerServer({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  home = homedir(),
  session = randomBytes(24).toString('hex'),
  startDependencyJob = createDependencyJob,
} = {}) {
  const root = resolve(sourceRoot);
  const { config, canvas } = await loadSkillModules(root);
  const packageData = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  let selectedTarget = null;
  let dependencyJob = null;
  let dependencyChild = null;
  let targetBusy = false;
  let closing = false;

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '127.0.0.1';
      const origin = `http://${host}`;
      const url = new URL(req.url || '/', origin);
      const cookies = parseCookies(req.headers.cookie);
      const authenticated = cookies.jiaoxiao_installer === session;

      if (req.method === 'GET' && url.pathname === '/' && parseSession(url) === session) {
        res.writeHead(302, {
          ...securityHeaders('text/plain; charset=utf-8'),
          Location: '/',
          'Set-Cookie': `jiaoxiao_installer=${session}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end('正在打开安装向导');
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        if (!authenticated) return json(res, 403, { ok: false, error: '安装会话已失效，请重新打开向导。' });
        if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: '不支持的请求方式。' });
        if (req.method === 'POST' && req.headers.origin && req.headers.origin !== origin) {
          return json(res, 403, { ok: false, error: '请求来源无效。' });
        }

        if (req.method === 'GET' && url.pathname === '/api/state') {
          const [platforms, environment, credential, selected] = await Promise.all([
            detectPlatforms(home),
            detectEnvironment(),
            config.loadConfig(),
            targetSummary(selectedTarget),
          ]);
          return json(res, 200, {
            ok: true,
            version: packageData.version,
            sourceRoot: root,
            platforms,
            environment,
            credential: {
              configured: credential.configured,
              source: credential.source,
              tokenPath: credential.tokenPath,
            },
            selectedTarget: selected,
            job: dependencyJob
              ? {
                  status: dependencyJob.status,
                  phase: dependencyJob.phase,
                  finishedAt: dependencyJob.finishedAt,
                  exitCode: dependencyJob.exitCode,
                }
              : null,
          });
        }

        if (req.method === 'POST' && url.pathname === '/api/install') {
          if (targetBusy || dependencyJob?.status === 'running') {
            return json(res, 409, { ok: false, error: '技能或依赖正在安装，请完成后再切换安装目录。' });
          }
          targetBusy = true;
          try {
            const body = await readJson(req);
            const target = resolveInstallTarget(body, home);
            const result = await installSkill({ sourceRoot: root, target });
            selectedTarget = target;
            dependencyJob = null;
            return json(res, 200, { ok: true, ...result, target: await targetSummary(target) });
          } finally {
            targetBusy = false;
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/token') {
          const body = await readJson(req);
          const token = String(body.token || '').trim();
          if (!token) return json(res, 400, { ok: false, error: 'Canvas Token 不能为空。' });
          const client = canvas.createCanvasClient({ token });
          await client.checkConnection();
          const tokenPath = await config.saveCanvasToken(token);
          return json(res, 200, {
            ok: true,
            connected: true,
            tokenPath,
            message: 'Canvas 已验证并保存。',
          });
        }

        if (req.method === 'POST' && url.pathname === '/api/open-canvas') {
          openExternal('https://oc.sjtu.edu.cn/profile/settings');
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/api/dependencies') {
          if (targetBusy || dependencyJob?.status === 'running') {
            return json(res, 409, { ok: false, error: '依赖正在安装，请稍候。' });
          }
          targetBusy = true;
          try {
            const target = selectedTarget || root;
            if (await dependencyReady(target)) {
              dependencyJob = {
                status: 'succeeded',
                phase: 'PPT 与课堂模块已就绪',
                output: '',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                exitCode: 0,
              };
            } else {
              const started = startDependencyJob(target);
              dependencyJob = started.job;
              dependencyChild = started.child;
            }
            return json(res, 200, {
              ok: true,
              job: { status: dependencyJob.status, phase: dependencyJob.phase },
            });
          } finally {
            targetBusy = false;
          }
        }

        if (req.method === 'GET' && url.pathname === '/api/job') {
          return json(res, 200, {
            ok: true,
            job: dependencyJob
              ? {
                  status: dependencyJob.status,
                  phase: dependencyJob.phase,
                  output: dependencyJob.output,
                  exitCode: dependencyJob.exitCode,
                  finishedAt: dependencyJob.finishedAt,
                }
              : null,
          });
        }

        if (req.method === 'POST' && url.pathname === '/api/verify') {
          const current = await config.loadConfig();
          if (!current.canvasToken) throw new Error('还没有配置 Canvas Token。');
          const client = canvas.createCanvasClient({ token: current.canvasToken });
          await client.checkConnection();
          const courses = await client.listCourses({ includeHistory: false });
          const target = selectedTarget || root;
          return json(res, 200, {
            ok: true,
            canvasReady: true,
            courseCount: courses.length,
            credentialSource: current.source,
            target: await targetSummary(target),
          });
        }

        if (req.method === 'POST' && url.pathname === '/api/close') {
          closing = true;
          if (dependencyChild && dependencyJob?.status === 'running') dependencyChild.kill();
          json(res, 200, { ok: true });
          setTimeout(() => server.close(), 50).unref();
          return;
        }

        return json(res, 404, { ok: false, error: '接口不存在。' });
      }

      if (!authenticated) {
        return json(res, 403, { ok: false, error: '安装会话已失效，请重新运行安装程序。' });
      }
      const staticFile = STATIC_FILES.get(url.pathname);
      if (!staticFile) return json(res, 404, { ok: false, error: '页面不存在。' });
      const [name, contentType] = staticFile;
      const body = await readFile(join(UI_ROOT, name));
      res.writeHead(200, {
        ...securityHeaders(contentType),
        'Content-Length': body.length,
      });
      res.end(body);
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地安装向导服务');
  const url = `http://127.0.0.1:${address.port}/?session=${encodeURIComponent(session)}`;
  return {
    server,
    session,
    url,
    sourceRoot: root,
    selected: () => selectedTarget,
    close: () => new Promise((resolveClose) => {
      if (closing) return resolveClose();
      closing = true;
      if (dependencyChild && dependencyJob?.status === 'running') dependencyChild.kill();
      server.close(resolveClose);
    }),
  };
}
