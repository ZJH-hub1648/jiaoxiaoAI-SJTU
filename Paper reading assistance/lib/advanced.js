import { randomUUID } from 'node:crypto';
import { access, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './store.js';
import { completion, SYSTEM, endpointUrl } from './model.js';
import { abstractOf, checkedCitations, contextFor, normalized, validPages } from './paper.js';

export function validateOcr(input, pageCount) {
  const page = Number(input.page);
  const text = String(input.text || '').trim();
  const confidence = Number(input.confidence);
  if (!Number.isInteger(page) || page < 1 || page > pageCount || !text || text.length > 100000) throw new Error('OCR 页码或文本无效');
  if (!['eng', 'eng+chi_sim'].includes(input.language) || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error('OCR 语言或置信度无效');
  if (!Array.isArray(input.words) || input.words.length > 15000) throw new Error('OCR 位置数据过多或无效');
  const words = input.words.map((word) => {
    const box = validRect(word);
    if (typeof word.text !== 'string' || !word.text.trim() || word.text.length > 300) throw new Error('OCR 单词格式无效');
    return { ...box, text: word.text, confidence: Math.max(0, Math.min(100, Number(word.confidence) || 0)) };
  });
  return { page, text, language: input.language, confidence, words, recognizedAt: new Date().toISOString(), corrected: input.corrected === true };
}
export function validRect(rect) {
  const { x, y, width, height } = rect || {};
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) throw new Error('框选区域必须位于 PDF 页内');
  return { x, y, width, height };
}
export function imageBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 5600000) throw new Error('请提供 4 MiB 以内的 PNG 框选图像');
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (bytes.length > 4 * 1024 * 1024 || bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('区域图像不是有效 PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 2048 || height > 2048 || width * height > 4000000) throw new Error('区域图像尺寸过大');
  return bytes;
}

export function comparisonContext(papers, question) {
  return papers.flatMap((paper, index) => contextFor(paper.pages, question, 1).slice(0, 4).map((chunk) => ({
    ...chunk, paperId: paper.id, paperName: paper.name, tag: `D${index + 1}`,
    ocr: Boolean(paper.pages.find((page) => page.number === chunk.page)?.ocr),
  })));
}
export function comparisonCitations(answer, contexts) {
  const cited = new Set();
  const text = answer.replace(/\[(D\d+):p\.(\d+)\]/g, (match, tag, number) => {
    const page = Number(number);
    if (!contexts.some((chunk) => chunk.tag === tag && chunk.page === page)) return '[未核验来源]';
    cited.add(`${tag}:${page}`); return match;
  }).replace(/\[p\.\d+\]/g, '[缺少论文标识]');
  return { text, citations: [...cited].map((key) => {
    const [tag, number] = key.split(':'); const page = Number(number);
    const source = contexts.find((chunk) => chunk.tag === tag && chunk.page === page);
    return { tag, page, paperId: source.paperId, paperName: source.paperName, excerpts: contexts.filter((chunk) => chunk.tag === tag && chunk.page === page).map((chunk) => chunk.text), ocr: source.ocr };
  }) };
}

export function createAdvanced({ store, config, active, dataDir, fetchImpl, body, json, headers, stream }) {
  const historyPath = join(dataDir, 'comparisons.json');
  let historyQueue = Promise.resolve();
  async function history() { try { return JSON.parse(await readFile(historyPath, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; } }
  async function saveComparison(result) {
    const next = historyQueue.catch(() => {}).then(async () => { const items = await history(); items.push(result); await atomicJson(historyPath, items.slice(-100)); });
    historyQueue = next; await next;
  }
  async function generated(req, res, ids, task) {
    if (ids.some((id) => active.has(id))) return json(res, 409, { error: '所选论文正在处理，请先完成或取消当前任务' });
    const controller = new AbortController();
    for (const id of ids) active.set(id, controller);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try { return await task(controller); }
    catch (err) {
      if (res.headersSent) { stream(res, { type: 'error', error: controller.signal.aborted ? '已取消，未保存部分结果' : err.message }); return res.end(); }
      throw err;
    } finally { for (const id of ids) if (active.get(id) === controller) active.delete(id); }
  }
  return async function handle(req, res, url) {
    if (url.pathname === '/api/ocr/status' && req.method === 'GET') {
      try {
        await Promise.all(['tesseract.js/dist/tesseract.min.js', 'tesseract.js-core/tesseract-core-lstm.wasm',
          '@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', '@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz'].map((file) => access(new URL('../node_modules/' + file, import.meta.url))));
        return json(res, 200, { ready: true });
      }
      catch { return json(res, 200, { ready: false, install: 'npm --prefix "Paper reading assistance" ci' }); }
    }
    if (url.pathname === '/api/models' && req.method === 'POST') {
      const input = await body(req);
      const protocol = input.protocol || 'openai';
      const target = new URL(endpointUrl(input.baseUrl, protocol));
      target.pathname = target.pathname.replace(protocol === 'ollama' ? /\/api\/chat$/ : /\/chat\/completions$/, protocol === 'ollama' ? '/api/tags' : '/models');
      const saved = await config.read();
      const same = saved.baseUrl && endpointUrl(saved.baseUrl, saved.protocol || 'openai') === endpointUrl(input.baseUrl, protocol);
      const key = input.clearKey ? '' : String(input.apiKey || (same ? saved.apiKey : '') || '');
      let response;
      try { response = await fetchImpl(target, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: key ? { authorization: `Bearer ${key}` } : {} }); }
      catch { throw new Error('无法连接模型服务，请先启动本地服务或检查地址'); }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`模型检测返回 HTTP ${response.status}`); }
      let data;
      try { data = await response.json(); } catch { throw new Error('模型列表格式无效'); }
      const entries = protocol === 'ollama' ? data.models : data.data;
      if (!Array.isArray(entries)) throw new Error('服务没有返回预期模型列表');
      return json(res, 200, { models: entries.slice(0, 200).map((m) => String(m.name || m.id || '')).filter(Boolean) });
    }
    if (url.pathname === '/api/comparisons' && req.method === 'GET') return json(res, 200, await history());
    if (url.pathname === '/api/compare' && req.method === 'POST') {
      const input = await body(req);
      const ids = [...new Set(Array.isArray(input.paperIds) ? input.paperIds : [])];
      if (ids.length < 2 || ids.length > 4 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw new Error('请选择 2–4 篇不同论文');
      const question = String(input.question || '对照研究问题、方法、数据与实验条件、主要结果和局限，说明哪些结果不可直接比较。').trim();
      if (!question || question.length > 4000) throw new Error('对照问题须为 1–4000 字');
      return generated(req, res, ids, async (controller) => {
        const papers = await Promise.all(ids.map((id) => store.read(id)));
        if (papers.some((paper) => !paper.pages.some((p) => p.text.trim()))) throw new Error('所选论文尚无可检索文字，请先打开并解析或 OCR');
        const contexts = comparisonContext(papers, question);
        const prompt = `请对照所选论文，用中文按研究问题、方法、数据与实验条件、结果、局限整理，再回答用户问题。不要将实验条件不同的数字直接排名；片段未提供则写未知。每个论断使用 [D1:p.1] 这种带论文标识的引用。OCR 文本可能误识别。\n论文目录：\n${papers.map((p, i) => `D${i + 1}: ${p.name}`).join('\n')}\n证据：\n${contexts.map((c) => `[${c.tag}:p.${c.page}]${c.ocr ? ' [OCR 待核验]' : ''} ${c.text}`).join('\n\n')}\n用户问题：${question}`;
        res.writeHead(200, headers('application/x-ndjson; charset=utf-8')); stream(res, { type: 'start' });
        const answer = await completion(await config.read(), [{ role: 'system', content: SYSTEM.replace('[p.N]', '[Dk:p.N]') }, { role: 'user', content: prompt }], { fetchImpl, signal: controller.signal, onToken: (text) => stream(res, { type: 'delta', text }) });
        controller.signal.throwIfAborted();
        const checked = comparisonCitations(answer, contexts);
        const result = { id: randomUUID(), question, answer: checked.text, citations: checked.citations, papers: papers.map((p, i) => ({ id: p.id, name: p.name, tag: `D${i + 1}` })), createdAt: new Date().toISOString() };
        await saveComparison(result); stream(res, { type: 'done', comparison: result }); return res.end();
      });
    }
    const match = /^\/api\/papers\/([a-f0-9]{64})\/(ocr|visual)(?:\/([a-f0-9-]{36})\.png)?$/.exec(url.pathname);
    if (!match) return false;
    const [, id, action, imageId] = match;
    if (action === 'visual' && imageId && req.method === 'GET') {
      const paper = await store.read(id);
      if (!paper.visuals?.some((visual) => visual.id === imageId)) throw new Error('图像记录不存在');
      const data = await readFile(join(store.directory(id), `visual-${imageId}.png`)); res.writeHead(200, headers('image/png')); return res.end(data);
    }
    if (req.method !== 'POST' || imageId) return json(res, 405, { error: '不支持的操作' });
    const input = await body(req);
    if (active.has(id)) return json(res, 409, { error: '此论文正在生成，请先结束当前任务' });
    if (action === 'ocr') {
      const paper = await store.read(id); const ocr = validateOcr(input, paper.pages.length);
      const result = await store.update(id, (p) => {
        const page = p.pages[ocr.page - 1];
        if (page.text.trim().length > 20 && !page.ocr && input.overwrite !== true) throw new Error('本页已有原生文字，需明确确认替换为 OCR');
        page.text = ocr.text; page.ocr = ocr;
        validPages(p.pages);
        const abstract = abstractOf(p.pages);
        if (p.abstract.text !== abstract.text) p.translation = '';
        p.abstract = abstract;
        for (const note of p.notes) if (note.page === ocr.page) note.sourceChanged = !normalized(ocr.text).includes(normalized(note.quote));
      });
      return json(res, 200, result);
    }
    return generated(req, res, [id], async (controller) => {
      const model = await config.read();
      if (!model.vision || !model.imageConsent) throw new Error('请先在模型设置启用视觉能力并同意发送框选图像');
      if (input.confirmImage !== true) throw new Error('请确认发送预览中的框选图像');
      const paper = await store.read(id); const page = Number(input.page);
      if (!paper.pages.some((p) => p.number === page) || !['formula', 'figure', 'table'].includes(input.kind)) throw new Error('页码或图像类型无效');
      const rect = validRect(input.rect); const image = imageBytes(input.image);
      const question = String(input.question || '请解释框选内容。').trim();
      if (!question || question.length > 4000) throw new Error('解读问题过长或为空');
      const context = normalized(paper.pages[page - 1].text).slice(0, 12000);
      const prompt = `你收到用户框选的论文${input.kind === 'formula' ? '公式' : input.kind === 'table' ? '表格' : '图表'}，位于 PDF 第 ${page} 页。先说明可辨认内容；公式解释符号、假设与适用条件，必要时给 LaTeX；图表说明坐标、图例、趋势与不确定性；表格说明比较条件。看不清的数字/符号明确写无法辨认，不猜测，不从图片恢复隐藏实验数据。区分作者陈述与你的解释，引用 [p.${page}]。\n同页文字（可能含 OCR 错误）：${context}\n用户问题：${question}`;
      res.writeHead(200, headers('application/x-ndjson; charset=utf-8')); stream(res, { type: 'start' });
      const answer = await completion(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: [
        { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: input.image } },
      ] }], { fetchImpl, signal: controller.signal, onToken: (text) => stream(res, { type: 'delta', text }) });
      controller.signal.throwIfAborted();
      const checked = checkedCitations(answer, [{ page, text: context || '用户框选的页面图像区域' }]);
      const visual = { id: randomUUID(), page, rect, kind: input.kind, question, answer: checked.text, citations: checked.citations, createdAt: new Date().toISOString() };
      const target = join(store.directory(id), `visual-${visual.id}.png`);
      await writeFile(target, image, { flag: 'wx', mode: 0o600 });
      try { await store.update(id, (p) => { p.visuals ||= []; p.visuals.push(visual); }); } catch (err) { await rm(target, { force: true }); throw err; }
      stream(res, { type: 'done', visual }); return res.end();
    });
  };
}
