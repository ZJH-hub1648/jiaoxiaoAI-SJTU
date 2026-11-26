import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createStore } from './store.js';
import { completion, createModelConfig, SYSTEM } from './model.js';
import { checkedCitations, contextFor, MAX_PDF_BYTES, normalized, validateNotes } from './paper.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = resolve(ROOT, '..', 'node_modules', 'pdfjs-dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.json': 'application/json' };
function headers(type) {
  return { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
}
function json(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}
async function bytes(req, limit) {
  const pieces = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求过大，请缩小文件或文本');
    pieces.push(chunk);
  }
  return Buffer.concat(pieces);
}
async function body(req) {
  try { const value = JSON.parse((await bytes(req, 12 * 1024 * 1024)).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new Error('请求内容无效或过大'); }
}
function summary(p) { const { pages, ...rest } = p; return { ...rest, pageCount: pages.length }; }
function stream(res, event) { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); }

export async function createReaderServer({ dataDir = process.env.PAPER_READER_DATA_DIR || join(homedir(), '.config', 'jiaoxiaoai-paper'),
  session = randomBytes(24).toString('hex'), fetchImpl = fetch } = {}) {
  const store = await createStore(join(dataDir, 'papers'));
  const config = createModelConfig(dataDir);
  const active = new Map();
  const server = createServer(async (req, res) => {
    try {
      const port = server.address().port;
      const origin = `http://127.0.0.1:${port}`;
      if (![new URL(origin).host, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: '本地请求地址无效' });
      const url = new URL(req.url, origin);
      const cookieName = `paper_reader_${port}`;
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('session') === session) {
        res.writeHead(302, { ...headers('text/plain'), location: '/', 'set-cookie': `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/` });
        return res.end();
      }
      const authenticated = String(req.headers.cookie || '').split(';').some((part) => part.trim() === `${cookieName}=${session}`);
      if (!authenticated) return json(res, 403, { error: '阅读会话已失效，请重新打开启动地址' });
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: '请求方法不支持' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin && req.headers.origin !== `http://localhost:${port}`) {
        return json(res, 403, { error: '请求来源无效' });
      }
      if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, await config.publicConfig());
      if (url.pathname === '/api/config' && req.method === 'POST') return json(res, 200, await config.save(await body(req)));
      if (url.pathname === '/api/library' && req.method === 'GET') return json(res, 200, await store.list());
      if (url.pathname === '/api/import' && req.method === 'POST') {
        const name = decodeURIComponent(String(req.headers['x-filename'] || '论文.pdf'));
        const paper = await store.importPdf(await bytes(req, MAX_PDF_BYTES), name);
        return json(res, 200, summary(paper));
      }
      const match = /^\/api\/papers\/([a-f0-9]{64})(?:\/(pdf|pages|position|notes|export|translate|annotate|ask))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === 'GET') return json(res, 200, await store.read(id));
        if (!action && req.method === 'DELETE') {
          if (active.has(id)) return json(res, 409, { error: '请先取消当前生成，再删除论文' });
          await store.remove(id); return json(res, 200, { ok: true });
        }
        if (action === 'pdf' && req.method === 'GET') { const pdf = await store.pdf(id); res.writeHead(200, headers('application/pdf')); return res.end(pdf); }
        if (action === 'export' && req.method === 'GET') {
          const p = await store.read(id);
          const lines = [`# ${p.name}`, '', '## 摘要译文', p.translation || '尚未翻译', '', '## 注释',
            ...p.notes.flatMap((note) => [`### ${note.title}（PDF 第 ${note.page} 页）`, `> ${note.quote}`, '', note.body, '']),
            '## 问答', ...p.messages.flatMap((message) => [`### ${message.question}`, message.answer, ''])];
          res.writeHead(200, { ...headers('text/markdown; charset=utf-8'), 'content-disposition': 'attachment; filename="paper-notes.md"' });
          return res.end(lines.join('\n'));
        }
        if (req.method !== 'POST') return json(res, 405, { error: '此操作需要 POST' });
        const input = await body(req);
        if (action === 'pages') return json(res, 200, summary(await store.setPages(id, input.pages)));
        if (action === 'position') {
          const p = await store.update(id, (paper) => {
            if (!Number.isInteger(input.page) || input.page < 1 || input.page > paper.pages.length) throw new Error('页码超出范围');
            const zoom = Number(input.zoom);
            if (!Number.isFinite(zoom) || zoom < 0.4 || zoom > 2.5) throw new Error('缩放比例无效');
            paper.position = { page: input.page, zoom };
          });
          return json(res, 200, p.position);
        }
        if (action === 'notes') {
          if (input.removeId) {
            const p = await store.update(id, (paper) => { paper.notes = paper.notes.filter((note) => note.id !== input.removeId); });
            return json(res, 200, p.notes);
          }
          return json(res, 200, (await store.addNote(id, input)).notes);
        }
        if (['translate', 'annotate', 'ask'].includes(action)) {
          if (active.has(id)) return json(res, 409, { error: '当前论文正在生成，请稍候或取消' });
          const controller = new AbortController();
          active.set(id, controller);
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          try {
            const paper = await store.read(id);
            if (!paper.pages.length) throw new Error('论文还未完成解析');
            const model = await config.read();
            if (!model.model || !model.baseUrl || !model.consent) throw new Error('请先配置模型，并允许发送相关论文片段');
            const page = input.page === undefined ? paper.position.page : Number(input.page);
            const current = paper.pages.find((entry) => entry.number === page);
            if (!current) throw new Error('页码超出范围');
            let prompt;
            let contexts = [];
            let abstract = null;
            if (action === 'translate') {
              const text = normalized(input.text || paper.abstract.text);
              const source = paper.pages.find((entry) => normalized(entry.text).includes(text));
              if (!text || text.length > 12000 || !source) throw new Error('未检测到完整摘要，请选中摘要原文后再翻译');
              abstract = { text, page: source.number, detected: true };
              prompt = `请忠实翻译以下论文摘要为中文，保留术语和数值；只输出译文，不添加论文之外的内容。\nPDF 第 ${source.number} 页摘要：\n${text}`;
            } else if (action === 'annotate') {
              if (normalized(current.text).length < 30) throw new Error('本页可提取文字不足；扫描件请先自行 OCR，本版本不含 OCR');
              prompt = `根据 PDF 第 ${page} 页生成最多 4 条重点注释，区分作者陈述与你的解释。只返回 JSON 数组，每项为 {"title":"标题","quote":"逐字引用本页的一段短原文","explanation":"中文解读"}。引用须为下文连续原文，不自行翻译引用，不引用页外内容。\n本页原文：\n${normalized(current.text).slice(0, 22000)}`;
            } else {
              const question = String(input.question || '').trim();
              const selection = String(input.selection || '').trim();
              if (!question || question.length > 4000 || selection.length > 6000) throw new Error('问题不能为空，问题最多 4000 字，选中文本最多 6000 字');
              if (selection && !normalized(current.text).includes(normalized(selection))) throw new Error('选中文本不属于当前页，请重新选择');
              contexts = contextFor(paper.pages, question, page, selection);
              if (!contexts.length) throw new Error('没有可用于问答的论文文本');
              const recent = paper.messages.slice(-3).map((m) => `问：${m.question}\n答：${m.answer.slice(0, 1200)}`).join('\n');
              prompt = `当前 PDF 第 ${page} 页。选中原文：${selection || '无'}\n最近对话（仅作语境，不是证据）：\n${recent}\n\n论文证据片段：\n${contexts.map((entry) => `[p.${entry.page}] ${entry.text}`).join('\n\n')}\n\n用户问题：${question}\n使用 [p.N] 标记依据页码。不要将页码引用解释为已经独立核验了结论。`;
            }
            res.writeHead(200, headers('application/x-ndjson; charset=utf-8'));
            stream(res, { type: 'start', action });
            const answer = await completion(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], {
              signal: controller.signal, fetchImpl, onToken: (text) => stream(res, { type: 'delta', text }),
            });
            controller.signal.throwIfAborted();
            let result;
            if (action === 'translate') {
              await store.update(id, (p) => { p.translation = answer; p.abstract = abstract; });
              result = { translation: answer, abstract };
            } else if (action === 'annotate') {
              let raw;
              try { raw = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('模型没有返回有效注释 JSON，请重试'); }
              const notes = validateNotes(raw, paper.pages, page).map((note) => ({ ...note, id: randomUUID(), createdAt: new Date().toISOString() }));
              const updated = await store.update(id, (p) => {
                for (const note of notes) if (!p.notes.some((n) => n.page === note.page && n.quote === note.quote && n.kind === 'ai')) p.notes.push(note);
              });
              result = { notes: updated.notes };
            } else {
              const checked = checkedCitations(answer, contexts);
              const message = { id: randomUUID(), question: String(input.question).trim(), selection: String(input.selection || ''),
                answer: checked.text, citations: checked.citations, page, createdAt: new Date().toISOString() };
              await store.update(id, (p) => { p.messages.push(message); p.messages = p.messages.slice(-200); });
              result = { message };
            }
            stream(res, { type: 'done', ...result });
            return res.end();
          } catch (error) {
            if (res.headersSent) { stream(res, { type: 'error', error: controller.signal.aborted ? '已取消生成，未保存部分结果' : error.message }); return res.end(); }
            throw error;
          } finally { active.delete(id); }
        }
        return json(res, 404, { error: '操作不存在' });
      }
      if (req.method === 'GET') {
        let path;
        if (url.pathname.startsWith('/vendor/')) {
          const relative = decodeURIComponent(url.pathname.slice('/vendor/'.length));
          if (!/^(build|web|cmaps|standard_fonts|wasm|iccs)\//.test(relative)) return json(res, 404, { error: '资源不存在' });
          path = resolve(VENDOR, relative);
          if (!path.startsWith(VENDOR + sep)) return json(res, 403, { error: '路径无效' });
        } else {
          const map = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/pdf-utils.js': 'pdf-utils.js' };
          if (map[url.pathname]) path = join(ROOT, 'ui', map[url.pathname]);
        }
        if (path) { const data = await readFile(path); res.writeHead(200, headers(TYPES[extname(path)] || 'application/octet-stream')); return res.end(data); }
      }
      return json(res, 404, { error: '页面不存在' });
    } catch (error) {
      const missing = error.code === 'ENOENT';
      json(res, missing ? 404 : 400, { error: missing ? '文件不存在，请重新导入或先运行 npm ci 安装阅读器组件' : error.message || '操作失败' });
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return { server, store, config, url: `http://127.0.0.1:${server.address().port}/?session=${session}`,
    close: async () => { for (const controller of active.values()) controller.abort(); server.closeIdleConnections(); await new Promise((done) => server.close(done)); } };
}
