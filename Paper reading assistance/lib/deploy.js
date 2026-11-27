import { lstat, readdir, readFile, mkdir, copyFile, rename, rmdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, join, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['.gitattributes', 'SKILL.md', 'README.md', 'STAGE3.md', 'DEPLOYMENT.md', 'CANVAS-SETUP.md', 'PLATFORMS.md', 'PRIVACY.md', 'package.json', 'package-lock.json', 'server.mjs', 'mcp.mjs', 'build-package.mjs', 'start-reader.cmd', 'start-reader.sh', 'lib', 'scripts', 'ui', 'tests', 'agents'];
const EXCLUDE = new Set(['node_modules', 'release', 'dist', '.env', '.git', '__pycache__', 'model.json', 'paper.json', 'papers', 'jobs', 'source.pdf']);
export async function skillFiles(root = SKILL_ROOT) {
  const result = [];
  async function visit(path) {
    const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('Skill 安装包不允许符号链接');
    if (info.isDirectory()) for (const entry of (await readdir(path)).sort()) { if (!EXCLUDE.has(entry) && !/\.py[cod]$/.test(entry)) await visit(join(path, entry)); }
    else if (info.isFile()) result.push({ source: path, path: relative(root, path).split('\\').join('/') });
  }
  for (const item of INCLUDE) { try { await visit(join(root, item)); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
  for (const required of ['SKILL.md', 'package.json', 'package-lock.json', 'scripts/paper.mjs', 'mcp.mjs']) if (!result.some((file) => file.path === required)) throw new Error(`Skill 缺少 ${required}`);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export async function installSkill({ agent = 'custom', target, home = homedir(), sourceRoot = SKILL_ROOT } = {}) {
  const paths = { codex: ['.agents', 'skills'], claude: ['.claude', 'skills'], dsh: ['.dsh', 'skills'], workbuddy: ['.workbuddy', 'skills'] };
  if (agent !== 'custom' && !paths[agent]) throw new Error('未知 Agent；请使用 custom 并明确提供目录');
  const destination = target || (paths[agent] ? join(home, ...paths[agent], 'paper-reading-assistance') : '');
  if (!isAbsolute(destination)) throw new Error('安装目录必须是绝对路径');
  async function canonical(path) { try { return await realpath(path); } catch (err) { if (err.code !== 'ENOENT') throw err; return join(await canonical(dirname(path)), basename(path)); } }
  const source = await canonical(resolve(sourceRoot)), output = await canonical(resolve(destination));
  for (const [a, b] of [[source, output], [output, source]]) { const r = relative(a, b); if (r === '' || (!r.startsWith('..') && !isAbsolute(r))) throw new Error('安装目录和源码不能重叠'); }
  try { const info = await lstat(output); if (!info.isDirectory() || (await readdir(output)).length) throw new Error('目标已有内容，请选新目录或先保留旧版本'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const files = await skillFiles(source);
  const staging = join(dirname(output), `.${basename(output)}.install-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  for (const file of files) { const path = join(staging, file.path); await mkdir(dirname(path), { recursive: true }); await copyFile(file.source, path); }
  try { await rmdir(output); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await rename(staging, output);
  return { path: output, skill: 'paper-reading-assistance', files: files.length, next: ['npm ci --omit=dev', 'node scripts/paper.mjs status'],
    mcp: { command: process.execPath, args: [join(output, 'mcp.mjs')] }, note: '目标 Agent 需允许执行本机命令；目录预设可被产品版本或用户配置覆盖，custom 可指定实际目录。' };
}
