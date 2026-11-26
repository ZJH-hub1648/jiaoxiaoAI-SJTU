import { recognizePage } from '/ocr.js';

const $ = (id) => document.getElementById(id);
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
async function readStream(response, onDelta) {
  if (!response.ok) throw new Error((await response.json()).error || '请求失败');
  const decoder = new TextDecoder(); let buffer = '', result;
  const parse = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'delta') onDelta(event.text);
    if (event.type === 'done') result = event;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end; while ((end = buffer.indexOf('\n')) >= 0) { parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
  }
  buffer += decoder.decode(); if (buffer.trim()) parse(buffer);
  if (!result) throw new Error('生成中断，未收到完整结果');
  return result;
}
export function mountAdvanced({ state, api, path, guard, error, status, setBusy, renderPage, summaryView, notesView, switchTab, openPaper, gotoPage }) {
  let ocrDraft = null;
  let region = null;
  let regionMode = false;
  let compared = null;
  let library = [];
  let renderingComparison = false;
  function updateControls() {
    for (const id of ['ocr-page', 'ocr-missing', 'region-tool']) $(id).disabled = !state.pdf || state.busy;
    $('compare-papers').disabled = state.busy;
    $('header-compare').disabled = state.busy;
  }
  function refreshLibrary(items) { library = items; }
  function settingsOpened() {
    $('model-protocol').value = state.config.protocol || 'openai'; $('model-vision').checked = state.config.vision === true; $('image-consent').checked = state.config.imageConsent === true;
    $('model-detection').textContent = '';
  }
  function configFields() { return { protocol: $('model-protocol').value, vision: $('model-vision').checked, imageConsent: $('image-consent').checked }; }
  function visualView() {
    $('visual-list').replaceChildren();
    for (const item of [...(state.paper?.visuals || [])].reverse()) {
      const card = element('article', undefined, 'note-card visual-card');
      card.append(element('strong', `${item.kind === 'formula' ? '公式' : item.kind === 'table' ? '表格' : '图表'} · PDF 第 ${item.page} 页`));
      const image = element('img'); image.src = `/api/papers/${state.paper.id}/visual/${item.id}.png`; image.alt = '已解读的区域';
      card.append(image, element('p', item.answer));
      const locate = element('button', '定位框选区域', 'text-button'); locate.onclick = () => guard(async () => { await gotoPage(item.page); markRegions(item.id); });
      card.append(locate); $('visual-list').append(card);
    }
  }
  function markRegions(focusId) {
    $('visual-regions')?.remove();
    if (!state.paper || !$('pdf-page')) return;
    const overlay = element('div', undefined, 'visual-regions'); overlay.id = 'visual-regions';
    let first;
    for (const item of state.paper.visuals || []) {
      if (item.page !== state.page) continue;
      const box = element('div', undefined, 'saved-region');
      Object.assign(box.style, { left: `${item.rect.x * 100}%`, top: `${item.rect.y * 100}%`, width: `${item.rect.width * 100}%`, height: `${item.rect.height * 100}%` });
      if (item.id === focusId) { box.classList.add('active'); first = box; }
      overlay.append(box);
    }
    $('pdf-page').append(overlay); first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function exitRegion() { regionMode = false; $('region-selector')?.remove(); $('region-tool').textContent = '框选公式 / 图表'; }
  function startRegion() {
    if (regionMode) { exitRegion(); return; }
    if (!state.pdf || state.busy) return;
    regionMode = true; $('region-tool').textContent = '取消框选';
    const selector = element('div', undefined, 'region-selector'); selector.id = 'region-selector'; $('pdf-page').append(selector);
    let origin;
    const pointer = (event) => { const b = selector.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (event.clientY - b.top) / b.height)) }; };
    const draft = element('div', undefined, 'region-draft'); selector.append(draft);
    selector.onpointerdown = (event) => { event.preventDefault(); origin = pointer(event); selector.setPointerCapture(event.pointerId); };
    selector.onpointermove = (event) => {
      if (!origin) return; const p = pointer(event);
      Object.assign(draft.style, { left: `${Math.min(origin.x, p.x) * 100}%`, top: `${Math.min(origin.y, p.y) * 100}%`, width: `${Math.abs(origin.x - p.x) * 100}%`, height: `${Math.abs(origin.y - p.y) * 100}%` });
    };
    selector.onpointerup = (event) => guard(async () => {
      if (!origin) return; const p = pointer(event);
      const rect = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), width: Math.abs(origin.x - p.x), height: Math.abs(origin.y - p.y) };
      origin = null; if (rect.width < 0.02 || rect.height < 0.01) return;
      const source = $('pdf-page').querySelector('canvas');
      const crop = document.createElement('canvas'); const width = Math.ceil(source.width * rect.width), height = Math.ceil(source.height * rect.height);
      const scale = Math.min(1, 1600 / Math.max(width, height)); crop.width = Math.max(1, Math.ceil(width * scale)); crop.height = Math.max(1, Math.ceil(height * scale));
      crop.getContext('2d').drawImage(source, source.width * rect.x, source.height * rect.y, source.width * rect.width, source.height * rect.height, 0, 0, crop.width, crop.height);
      region = { rect, image: crop.toDataURL('image/png'), page: state.page };
      $('region-preview').src = region.image; $('region-consent').checked = false;
      exitRegion(); $('region-dialog').showModal();
    });
  }

  async function runOcr(allMissing = false) {
    if (state.busy || !state.pdf) return;
    const available = await api('/api/ocr/status');
    if (!available.ready) throw new Error('请先运行 ' + available.install);
    const pages = allMissing ? state.paper.pages.filter((p) => p.text.trim().length < 20).map((p) => p.number) : [state.page];
    if (!pages.length) { status('没有待识别页，可手动识别当前页'); return; }
    const overwrite = !allMissing && state.paper.pages[state.page - 1].text.trim().length > 20 && !state.paper.pages[state.page - 1].ocr;
    if (overwrite && !confirm('当前页已有可提取文字。确认使用 OCR 识别，并在核对后替换原有文字？')) return;
    state.controller = new AbortController(); const signal = state.controller.signal;
    setBusy(true, '本机 OCR 正在初始化…'); error('');
    try {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]; const pdfPage = await state.pdf.getPage(page);
        const result = await recognizePage(pdfPage, $('ocr-language').value, { signal, onProgress: (phase, progress) => {
          $('generation-label').textContent = `本机 OCR ${i + 1}/${pages.length} · ${phase} ${Math.round(progress * 100)}%`;
        } });
        if (!result.text) throw new Error(`第 ${page} 页未识别出文字，请提高扫描质量或选择正确语言`);
        if (allMissing) {
          state.paper = await api(path('ocr'), { ...result, page, overwrite: false });
        } else {
          ocrDraft = { ...result, page, overwrite };
          $('ocr-text').value = result.text; $('ocr-confidence').textContent = `PDF 第 ${page} 页 · 平均置信度 ${result.confidence.toFixed(1)}% · ${result.confidence < 70 ? '较低，建议逐项核对' : '置信度不是准确率保证'}`;
          $('ocr-dialog').showModal();
        }
      }
      if (allMissing) { summaryView(); notesView(); await renderPage(); status(`已保存 ${pages.length} 页本机 OCR；可逐页核对修订`); }
    } catch (err) { if (signal.aborted) error('OCR 已取消；之前已保存的页面保留，可继续识别未完成页'); else throw err; }
    finally { state.controller = null; setBusy(false); }
  }
  $('ocr-page').onclick = () => guard(() => runOcr()); $('ocr-missing').onclick = () => guard(() => runOcr(true));
  $('ocr-form').onsubmit = (event) => { event.preventDefault(); guard(async () => {
    if (!ocrDraft || state.busy) return;
    const text = $('ocr-text').value.trim(); const corrected = text !== ocrDraft.text;
    state.paper = await api(path('ocr'), { ...ocrDraft, text, corrected, words: corrected ? [] : ocrDraft.words });
    $('ocr-dialog').close(); summaryView(); notesView(); await renderPage(); status('OCR 文本已保存，可用于翻译、注释与检索');
  }); };
  $('region-tool').onclick = startRegion;
  $('region-form').onsubmit = (event) => { event.preventDefault(); guard(async () => {
    if (!region || state.busy) return;
    if (!state.config.vision || !state.config.imageConsent || !state.config.consent) throw new Error('请先在模型设置配置支持图像的模型，并开启文字与图像发送授权');
    $('region-dialog').close(); switchTab('visual'); $('visual-output').textContent = '';
    state.controller = new AbortController(); setBusy(true, '正在解读框选图像…'); error('');
    try {
      const response = await fetch(path('visual'), { method: 'POST', headers: { 'content-type': 'application/json' }, signal: state.controller.signal,
        body: JSON.stringify({ ...region, kind: $('region-kind').value, question: $('region-question').value, confirmImage: $('region-consent').checked }) });
      const result = await readStream(response, (text) => { $('visual-output').textContent += text; });
      state.paper.visuals ||= []; state.paper.visuals.push(result.visual); $('visual-output').textContent = ''; visualView(); markRegions(result.visual.id); status('图像解读和区域位置已保存');
    } catch (err) { $('visual-output').textContent = ''; error(state.controller.signal.aborted ? '已取消图像解读，未保存部分结果' : err.message); }
    finally { state.controller = null; setBusy(false); }
  }); };

  function showComparison(result) {
    compared = result; $('compare-output').textContent = result.answer; $('compare-sources').replaceChildren();
    for (const source of result.citations) {
      const button = element('button', `${source.tag} · ${source.paperName} · 第 ${source.page} 页${source.ocr ? '（OCR）' : ''}`);
      button.onclick = () => guard(async () => {
        if (state.busy) return; $('compare-dialog').close();
        if (state.paper?.id !== source.paperId) await openPaper(source.paperId);
        await gotoPage(source.page);
      }); $('compare-sources').append(button);
    }
    if (!result.citations.length) $('compare-sources').append(element('p', '此对照没有可定位的有效引用，需核对原文。', 'helper'));
    $('compare-export').hidden = false;
  }
  async function refreshHistory() {
    const history = await api('/api/comparisons'); $('comparison-history').replaceChildren();
    for (const result of [...history].reverse()) { const button = element('button', `${new Date(result.createdAt).toLocaleDateString()} · ${result.question.slice(0, 70)}`); button.onclick = () => { if (!state.busy) showComparison(result); }; $('comparison-history').append(button); }
  }
  async function showCompare() {
    if (state.busy) return; $('compare-options').replaceChildren();
    for (const paper of library) {
      const label = element('label', undefined, 'paper-choice'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.value = paper.id;
      checkbox.disabled = !paper.pageCount; checkbox.checked = paper.id === state.paper?.id;
      label.append(checkbox, element('span', `${paper.name} · ${paper.pageCount} 页${paper.pageCount ? '' : '（需先打开解析）'}`)); $('compare-options').append(label);
    }
    $('compare-error').hidden = true; await refreshHistory(); $('compare-dialog').showModal();
  }
  $('compare-papers').onclick = () => guard(showCompare); $('header-compare').onclick = () => guard(showCompare);
  $('compare-form').onsubmit = (event) => { event.preventDefault(); guard(async () => {
    if (state.busy) return;
    const paperIds = [...$('compare-options').querySelectorAll('input:checked')].map((input) => input.value);
    if (paperIds.length < 2 || paperIds.length > 4) { $('compare-error').textContent = '请选择 2–4 篇已解析论文'; $('compare-error').hidden = false; return; }
    state.controller = new AbortController(); setBusy(true, '正在对照论文证据…'); renderingComparison = true;
    $('compare-cancel').hidden = false; $('compare-submit').disabled = true; $('compare-output').textContent = ''; $('compare-sources').replaceChildren(); $('compare-export').hidden = true; $('compare-error').hidden = true;
    try {
      const result = await readStream(await fetch('/api/compare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paperIds, question: $('compare-question').value }), signal: state.controller.signal }), (text) => { $('compare-output').textContent += text; });
      showComparison(result.comparison); await refreshHistory(); status('论文对照已保存');
    } catch (err) { $('compare-output').textContent = ''; $('compare-error').textContent = state.controller.signal.aborted ? '已取消对照，未保存部分结果' : err.message; $('compare-error').hidden = false; }
    finally { state.controller = null; setBusy(false); renderingComparison = false; $('compare-cancel').hidden = true; $('compare-submit').disabled = false; }
  }); };
  $('compare-cancel').onclick = () => state.controller?.abort();
  $('compare-dialog').addEventListener('cancel', (event) => { if (renderingComparison) { event.preventDefault(); state.controller?.abort(); } });
  $('compare-export').onclick = () => {
    if (!compared) return; const content = ['# 多篇论文对照', compared.question, ...compared.papers.map((p) => `${p.tag}: ${p.name}`), '', compared.answer, '', ...compared.citations.map((c) => `${c.tag}:p.${c.page} · ${c.paperName}`)].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' })); const a = element('a'); a.href = url; a.download = 'paper-comparison.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  for (const [id, protocol, base] of [['preset-ollama', 'ollama', 'http://127.0.0.1:11434'], ['preset-studio', 'openai', 'http://127.0.0.1:1234/v1']]) $(id).onclick = () => {
    $('model-protocol').value = protocol; $('model-base').value = base; $('model-key').value = ''; $('model-detection').textContent = '请启动本机服务，然后点击检测连接；不会自动安装或下载模型。';
  };
  $('detect-models').onclick = () => guard(async () => {
    $('model-detection').textContent = '正在检测…'; $('detect-models').disabled = true;
    try {
      const result = await api('/api/models', { baseUrl: $('model-base').value, protocol: $('model-protocol').value, apiKey: $('model-key').value, clearKey: $('clear-key').checked });
      $('model-options').replaceChildren(); for (const name of result.models) { const option = element('option'); option.value = name; $('model-options').append(option); }
      if (!$('model-name').value && result.models.length) $('model-name').value = result.models[0];
      $('model-detection').textContent = `连接成功，发现 ${result.models.length} 个模型。图像解读需选择支持视觉的模型。`;
    } catch (err) { $('model-detection').textContent = err.message; } finally { $('detect-models').disabled = false; }
  });
  return { updateControls, refreshLibrary, settingsOpened, configFields, beforeRender: exitRegion, paperOpened: () => { exitRegion(); visualView(); $('visual-output').textContent = ''; }, pageRendered: markRegions };
}
