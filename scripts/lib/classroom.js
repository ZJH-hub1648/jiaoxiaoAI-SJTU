import { clampInt, positiveId } from './files.js';

export const CLASSROOM_ORIGIN = 'https://v.sjtu.edu.cn';
export const VIDEO_HOME = `${CLASSROOM_ORIGIN}/jy-application-resourcemanage-ui/`;
export const CLASSROOM_ME = `${CLASSROOM_ORIGIN}/jy-application-resourcemanage/authority/me`;
const BASE = `${CLASSROOM_ORIGIN}/jy-application-resourcemanage/v1`;

function endpoint(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('交大视频响应数据格式已变化');
  }
  if (payload.status === 401 || payload.status === 403 || String(payload.code) === '-1') {
    throw new Error('校园会话已失效，请重新登录交大视频');
  }
  if (payload.ok === false || payload.dataOk === false ||
      (typeof payload.status === 'number' && payload.status !== 200)) {
    throw new Error('交大视频接口请求失败');
  }
  return payload.result ?? payload.data;
}

async function allPages(requestJson, path, params, signal) {
  const records = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await requestJson(endpoint(path, {
      ...params,
      'page.pageIndex': page,
      'page.pageSize': 1000,
    }), signal);
    const data = unwrap(response);
    if (page === 1 && data?.records === null && data?.rowCount === 0) return [];
    if (!data || !Array.isArray(data.records)) throw new Error('交大视频列表数据格式已变化');
    records.push(...data.records);
    const pageCount = Number(data.pageCount);
    if (Number.isInteger(pageCount) && pageCount >= 0 ? page >= pageCount : data.records.length < 1000) {
      return records;
    }
  }
  throw new Error('交大视频分页过多，已停止读取');
}

export function parseTranscript(data, videoId) {
  if (data === null || data === undefined) return null;
  if (!data || !Array.isArray(data.afterAssemblyList)) throw new Error('交大视频文稿数据格式已变化');
  const segments = data.afterAssemblyList.map((segment) => {
    const startMs = Number(segment?.bg);
    const endMs = Number(segment?.ed);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs || typeof segment?.res !== 'string') {
      throw new Error('交大视频文稿段落格式已变化');
    }
    return { startMs, endMs, text: segment.res.trim() };
  }).filter((segment) => segment.text).sort((a, b) => a.startMs - b.startMs);
  return segments.length ? { videoId, segments } : null;
}

export function timestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  return `${time}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

export function formatSegments(segments) {
  return `${segments.map((segment) => `[${timestamp(segment.startMs)}–${timestamp(segment.endMs)}] ${segment.text}`).join('\n\n')}\n`;
}

export function formatTranscript(transcript, title) {
  return `${title}\n录像 ID：${transcript.videoId}\n\n${formatSegments(transcript.segments)}`;
}

function searchInteger(value, fallback, label, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 之间的整数`);
  }
  return parsed;
}

export function searchTranscript(transcript, options = {}) {
  const query = String(options.query ?? '').trim();
  if (!query) throw new Error('query 去除首尾空白后不能为空');
  const offset = searchInteger(options.offset, 0, 'offset', 0, 1000000);
  const limit = searchInteger(options.limit, 20, 'limit', 1, 50);
  const needle = query.toLocaleLowerCase();
  const matches = transcript.segments
    .filter((segment) => segment.text.toLocaleLowerCase().includes(needle))
    .map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      startTime: timestamp(segment.startMs),
      endTime: timestamp(segment.endMs),
      text: segment.text,
    }));
  return {
    query,
    total: matches.length,
    offset,
    limit,
    results: matches.slice(offset, offset + limit),
    nextOffset: offset + limit < matches.length ? offset + limit : null,
  };
}

export function readTranscriptRange(transcript, options = {}) {
  const startSeconds = Math.max(0, Number(options.startSeconds) || 0);
  const endSeconds = options.endSeconds === undefined
    ? startSeconds + 300
    : Number(options.endSeconds);
  if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds - startSeconds > 900) {
    throw new Error('文稿时间范围必须大于 0 且不超过 15 分钟');
  }
  const maxChars = clampInt(options.maxChars, 6000, 200, 12000);
  const offset = clampInt(options.offset, 0, 0, 1000000);
  const startMs = startSeconds * 1000;
  const endMs = endSeconds * 1000;
  const segments = transcript.segments.filter((segment) => segment.startMs < endMs && segment.endMs > startMs);
  const blocks = segments.map((segment) => formatSegments([segment]).trimEnd());
  if (offset > blocks.length) throw new Error('offset 超出本次文稿范围');
  let text = '';
  let index = offset;
  while (index < blocks.length) {
    const candidate = text ? `${text}\n\n${blocks[index]}` : blocks[index];
    if (text && candidate.length > maxChars) break;
    text = candidate;
    index += 1;
    if (text.length >= maxChars) break;
  }
  const nextOffset = index < blocks.length ? index : null;
  const hasLater = transcript.segments.some((segment) => segment.startMs >= endMs);
  const nextStartSeconds = !nextOffset && hasLater
    ? segments.length
      ? Math.ceil(segments.at(-1).endMs / 1000)
      : endSeconds
    : null;
  return {
    text,
    offset,
    nextOffset,
    nextStartSeconds,
    startSeconds,
    endSeconds,
    matched: segments.length,
    returned: index - offset,
  };
}

export function createClassroomApi({ requestJson }) {
  async function listCourses(signal) {
    const termResponse = await requestJson(endpoint('list/termYear'), signal);
    const terms = Array.isArray(termResponse) ? termResponse : unwrap(termResponse);
    if (!Array.isArray(terms)) throw new Error('交大视频学期数据格式已变化');
    const term = terms.find((item) => item.currentTerm) ?? terms.at(-1);
    if (!term || !(Number(term.id) > 0)) return [];
    const records = await allPages(requestJson, 'myself/curriculum', {
      acteId: term.id,
      courBeginTime: '',
      courEndTime: '',
    }, signal);
    const vodRecords = await allPages(requestJson, 'group_subject_vod_list/t-1', {
      'page.orders[0].asc': 'false',
      'page.orders[0].field': 'courBeginTime',
    }, signal);
    records.push(...vodRecords.filter((course) => Number(course.acteId) === Number(term.id)));
    const courses = new Map();
    for (const raw of records) {
      const id = Number(raw.teclId);
      if (!(id > 0) || typeof raw.subjName !== 'string') continue;
      courses.set(id, { id, code: String(raw.subjCode || ''), name: raw.subjName });
    }
    return [...courses.values()];
  }

  async function listVideos(courseId, signal) {
    const id = positiveId(courseId, 'courseId');
    const records = await allPages(requestJson, 'subject_vod_list_new', {
      teclIds: id,
      'page.orders[0].asc': 'false',
      'page.orders[0].field': 'courBeginTime',
    }, signal);
    return records.map((raw) => {
      const id = positiveId(raw.id, '录像 ID');
      if (typeof raw.courBeginTime !== 'string' || typeof raw.courEndTime !== 'string') {
        throw new Error('交大视频录像数据格式已变化');
      }
      return {
        id,
        start: raw.courBeginTime,
        end: raw.courEndTime,
        room: String(raw.clroName || ''),
        period: String(raw.letiNumber ?? ''),
      };
    });
  }

  async function getTranscript(videoId, signal) {
    const id = positiveId(videoId, 'videoId');
    const response = await requestJson(endpoint(`course/ai/translate/${id}`, { useOriginal: 'true' }), signal);
    return parseTranscript(unwrap(response), id);
  }

  return { listCourses, listVideos, getTranscript };
}
