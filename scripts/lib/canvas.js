import { courseDirectory, downloadDirectory, positiveId, saveWebStream } from './files.js';

export const CANVAS_ORIGIN = 'https://oc.sjtu.edu.cn';
const API_ROOT = `${CANVAS_ORIGIN}/api/v1/`;
const TOKEN_GUIDE = '请先在 Canvas「账号 → 设置 → 新访问令牌」创建 Token，再由用户本人在终端运行 node scripts/jiaoxiaoai.mjs setup；不要把 Token 发到聊天中。';

function apiUrl(path) {
  const url = new URL(path, API_ROOT);
  const allowed = url.origin === CANVAS_ORIGIN &&
    (url.pathname.startsWith('/api/v1/') || url.pathname === '/login/session_token');
  if (!allowed) throw new Error('Canvas 地址无效');
  return url;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function canvasNextPage(header) {
  const next = header
    ?.split(',')
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/)?.[1];
  return next ? apiUrl(next).href : null;
}

export function isPresentation(file) {
  const name = String(file.display_name || file.filename || '').toLowerCase();
  return name.endsWith('.ppt') || name.endsWith('.pptx');
}

export function createCanvasClient({ token, timeoutMs = 30000 } = {}) {
  const accessToken = String(token ?? '').trim();

  async function request(path, signal) {
    if (!accessToken) throw new Error(`尚未连接 Canvas。${TOKEN_GUIDE}`);
    let response;
    try {
      response = await fetch(apiUrl(path), {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        redirect: 'error',
        signal: requestSignal(signal, timeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('无法连接 Canvas，请检查网络后重试');
    }
    if (!response.ok) {
      const detail = response.status === 401
        ? '：Token 失效或当前账号无权访问此内容'
        : response.status === 404
          ? '：内容不存在或课程未开放此功能'
          : '';
      throw new Error(`Canvas 返回 HTTP ${response.status}${detail}`);
    }
    return response;
  }

  async function json(path, signal) {
    const response = await request(path, signal);
    try {
      return await response.json();
    } catch {
      throw new Error('Canvas 返回了非 JSON 响应');
    }
  }

  async function list(path, signal) {
    const rows = [];
    const visited = new Set();
    let next = apiUrl(path).href;
    while (next) {
      if (visited.has(next) || visited.size >= 100) throw new Error('Canvas 分页异常，已停止读取');
      visited.add(next);
      const response = await request(next, signal);
      let page;
      try {
        page = await response.json();
      } catch {
        throw new Error('Canvas 列表返回了非 JSON 响应');
      }
      if (!Array.isArray(page)) throw new Error('Canvas 列表数据格式已变化');
      rows.push(...page);
      next = canvasNextPage(response.headers.get('link'));
    }
    return rows;
  }

  async function listCourses({ includeHistory = false } = {}, signal) {
    const query = new URLSearchParams({ 'include[]': 'term', per_page: '50' });
    if (!includeHistory) query.set('enrollment_state', 'active');
    const rows = await list(`courses?${query}`, signal);
    return rows
      .filter((course) => Number(course.id) > 0)
      .map((course) => ({
        id: Number(course.id),
        name: String(course.name || course.course_code || `课程 ${course.id}`),
        code: String(course.course_code || ''),
        term: String(course.term?.name || '未标注学期'),
      }));
  }

  async function listFiles(courseId, signal) {
    const id = positiveId(courseId, 'courseId');
    const rows = await list(`courses/${id}/files?per_page=50`, signal);
    return rows
      .filter((file) => Number(file.id) > 0)
      .map((file) => ({
        id: Number(file.id),
        courseId: id,
        name: String(file.display_name || file.filename || `文件 ${file.id}`),
        mime: String(file['content-type'] || 'application/octet-stream'),
        size: Number(file.size) || 0,
        updatedAt: String(file.updated_at || ''),
        presentation: isPresentation(file),
      }));
  }

  async function classroomLoginUrl(signal) {
    const courses = await listCourses({}, signal);
    for (const course of courses) {
      const tabs = await list(`courses/${course.id}/tabs?per_page=50`, signal);
      const tab = tabs.find((item) => String(item.label).includes('课堂视频') && !String(item.label).includes('旧版'));
      if (!tab) continue;
      const returnTo = new URL(String(tab.html_url || ''), CANVAS_ORIGIN);
      if (returnTo.origin !== CANVAS_ORIGIN) continue;
      const payload = await json(`/login/session_token?${new URLSearchParams({ return_to: returnTo.href })}`, signal);
      const loginUrl = new URL(String(payload.session_url || ''));
      if (loginUrl.origin !== CANVAS_ORIGIN) throw new Error('Canvas 登录地址无效');
      return loginUrl.href;
    }
    throw new Error('当前 Canvas 课程中没有找到「课堂视频」入口');
  }

  async function downloadFile(fileId, course, directory, signal) {
    const id = positiveId(fileId, 'fileId');
    const metadata = await json(`files/${id}`, signal);
    const initial = new URL(String(metadata.url || ''), CANVAS_ORIGIN);
    if (initial.origin !== CANVAS_ORIGIN) throw new Error('Canvas 下载地址无效');

    let first;
    try {
      first = await fetch(initial, {
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: 'manual',
        signal: requestSignal(signal, timeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('Canvas 文件下载请求失败，请检查网络后重试');
    }

    let response = first;
    if (first.status >= 300 && first.status < 400) {
      const target = new URL(first.headers.get('location') || '', CANVAS_ORIGIN);
      const storageAllowed = target.hostname === 's3.jcloud.sjtu.edu.cn' || target.hostname.endsWith('.s3.jcloud.sjtu.edu.cn');
      if (target.protocol !== 'https:' || (target.hostname !== new URL(CANVAS_ORIGIN).hostname && !storageAllowed)) {
        throw new Error('Canvas 下载重定向地址不受信任');
      }
      response = await fetch(target, {
        redirect: 'error',
        signal: requestSignal(signal, Math.max(timeoutMs, 120000)),
      });
    }
    if (!response.ok) throw new Error(`文件下载失败（HTTP ${response.status}）`);

    const targetDirectory = courseDirectory(downloadDirectory(directory), course);
    return saveWebStream({
      body: response.body,
      directory: targetDirectory,
      name: String(metadata.display_name || metadata.filename || `文件 ${id}`),
      expectedSize: Number(metadata.size) || 0,
      signal,
    });
  }

  async function checkConnection(signal) {
    await json('users/self/profile', signal);
    return true;
  }

  return {
    configured: Boolean(accessToken),
    checkConnection,
    listCourses,
    listFiles,
    classroomLoginUrl,
    downloadFile,
  };
}
