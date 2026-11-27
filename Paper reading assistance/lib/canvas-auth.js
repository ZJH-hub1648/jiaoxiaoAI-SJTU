import { mkdir, readFile, stat, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const CANVAS_SETTINGS = 'https://oc.sjtu.edu.cn/profile/settings';
export const defaultCanvasFile = () => join(homedir(), '.config', 'sjtu-canvas', 'token');
const ENV_KEYS = ['SJTU_CANVAS_TOKEN', 'CANVAS_API_TOKEN', 'CANVAS_ACCESS_TOKEN'];
function expanded(path) { return path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path; }
function tokenValue(value) { const token = String(value || '').replace(/^\uFEFF/, '').trim(); if (!token || /\s/.test(token) || token.length > 4096) throw new Error('Canvas Token 不能为空、不能含空白且长度不得超过 4096 字符'); return token; }
async function tokenFile(path) {
  if ((await stat(path)).size > 4096) throw new Error('Token 文件过大，只能保存令牌本身');
  const text = await readFile(path, 'utf8'); return tokenValue(text.split(/\r?\n/).find((line) => line.trim()) || '');
}
export async function loadCanvasAuth({ tokenFile: explicit = '' } = {}) {
  const custom = explicit || String(process.env.SJTU_CANVAS_TOKEN_FILE || '').trim();
  if (custom) {
    const path = resolve(expanded(custom)); const source = explicit ? 'explicit-token-file' : 'environment:SJTU_CANVAS_TOKEN_FILE';
    try { return { token: await tokenFile(path), source, tokenPath: path }; }
    catch (err) { if (err.code !== 'ENOENT') throw err; return { token: '', source, tokenPath: path }; }
  }
  for (const name of ENV_KEYS) if (String(process.env[name] || '').trim()) return { token: tokenValue(process.env[name]), source: `environment:${name}`, tokenPath: null };
  try { const path = defaultCanvasFile(); return { token: await tokenFile(path), source: 'default-token-file', tokenPath: path }; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const legacy = process.env.JIAOXIAOAI_CONFIG || join(homedir(), '.jiaoxiaoai', 'config.json');
  try { const data = JSON.parse(await readFile(legacy, 'utf8')); if (data.canvasToken) return { token: tokenValue(data.canvasToken), source: 'legacy-config', tokenPath: legacy }; }
  catch (err) { if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err; }
  return { token: '', source: 'missing', tokenPath: defaultCanvasFile() };
}
export async function canvasStatus(options = {}) {
  const auth = await loadCanvasAuth(options);
  return { configured: Boolean(auth.token), source: auth.source, tokenPath: auth.tokenPath, settingsUrl: CANVAS_SETTINGS,
    purpose: 'Canvas 共享凭据配置；论文 Skill 的本机阅读与宿主模型不需要此 Token', environmentTokenNames: ENV_KEYS.filter((name) => process.env[name]?.trim()) };
}
export async function verifyCanvas(token, { fetchImpl = fetch } = {}) {
  let response;
  try { response = await fetchImpl('https://oc.sjtu.edu.cn/api/v1/users/self/profile', { method: 'GET', redirect: 'error',
    headers: { authorization: `Bearer ${tokenValue(token)}`, accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('无法连接 Canvas，请检查网络、代理或学校 VPN；Token 不会被转发到登录页'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 401 ? 'Canvas Token 无效或已过期（401），请重新生成' : response.status === 403 ? 'Canvas 拒绝访问（403），请确认账号与令牌权限' : `Canvas 返回 HTTP ${response.status}，请稍后重试或检查权限`);
  }
  let profile; try { profile = await response.json(); } catch { throw new Error('Canvas 返回了非预期响应，未保存令牌'); }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !profile.id) throw new Error('未确认当前用户身份，未保存令牌');
  return { connected: true, user: { id: String(profile.id), name: String(profile.name || profile.short_name || '') } };
}
export async function checkCanvas(options = {}) {
  const auth = await loadCanvasAuth(options); if (!auth.token) throw new Error('未配置 Canvas Token。请在本机运行 node scripts/configure-canvas.mjs setup，或使用阅读器设置中的 Canvas 引导；不要把 Token 发到聊天中。');
  return { ...await verifyCanvas(auth.token, options), ...await canvasStatus(options) };
}
export async function saveCanvas(token, { tokenFile: explicit = '', fetchImpl = fetch } = {}) {
  const value = tokenValue(token); const checked = await verifyCanvas(value, { fetchImpl });
  const path = resolve(expanded(explicit || process.env.SJTU_CANVAS_TOKEN_FILE || defaultCanvasFile()));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600).catch(() => {}); }
  finally { await rm(temporary, { force: true }); }
  let active;
  try { active = await loadCanvasAuth({ tokenFile: explicit }); }
  catch { return { ...checked, saved: true, tokenPath: path, effectiveSource: 'configuration-error', savedTokenIsActive: false, message: '令牌已验证并保存，但已有环境变量或其他配置格式异常；请修正后运行 check。' }; }
  return { ...checked, saved: true, tokenPath: path, effectiveSource: active.source, savedTokenIsActive: active.token === value,
    message: active.token === value ? '验证成功并保存。Canvas 技能与本配置共用此令牌文件。' : '新令牌已保存，但当前进程更高优先级的环境变量覆盖了它；请检查凭据来源并运行 check。' };
}
