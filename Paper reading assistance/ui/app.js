import * as pdfjs from '/vendor/build/pdf.mjs';
import { textOf, quoteRange } from '/pdf-utils.js';
import { mountAdvanced } from '/advanced.js';
import { renderOcrLayer } from '/ocr.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/build/pdf.worker.mjs';
const $ = (id) => document.getElementById(id);
const state = { paper: null, pdf: null, page: 1, zoom: 1, tab: 'summary', selection: '', busy: false, config: {}, controller: null, renderTask: null, renderVersion: 0 };
let resizeTimer;
let positionTimer;
let textLayer = null;
let advanced;
let observedWidth = 0;

function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
function status(message) { $('reader-status').textContent = message; }
async function api(path, input, method = 'POST') {
  const response = await fetch(path, input === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '操作失败');
  return payload;
}
function path(action = '') { return `/api/papers/${state.paper.id}${action ? '/' + action : ''}`; }
function setBusy(value, label = '正在生成…') {
  state.busy = value;
  $('generation-status').hidden = !value;
  $('generation-label').textContent = label;
  $('cancel-generation').disabled = !state.controller;
  updateControls();
}
function updateControls() {
  const unavailable = !state.paper || !state.pdf || state.busy;
  for (const id of ['prev-page', 'next-page', 'page-input', 'zoom', 'translate-button', 'annotate-button', 'ask-button', 'export-button', 'delete-button']) $(id).disabled = unavailable;
  $('prev-page').disabled ||= state.page <= 1;
  $('next-page').disabled ||= state.page >= (state.pdf?.numPages || 0);
  $('file-input').disabled = state.busy;
  $('choose-pdf').disabled = state.busy;
  $('settings-button').disabled = state.busy;
  for (const button of $('library-list').querySelectorAll('button')) button.disabled = state.busy;
  for (const button of $('selection-box').querySelectorAll('button')) button.disabled = state.busy;
  advanced?.updateControls();
}
function switchTab(tab) {
  state.tab = tab;
  for (const name of ['summary', 'notes', 'chat', 'visual']) {
    $('panel-' + name).hidden = name !== tab;
    $('tab-' + name).setAttribute('aria-selected', String(name === tab));
  }
}
function sourceButton(page, label = `PDF 第 ${page} 页`) {
  const button = document.createElement('button'); button.textContent = label;
  button.addEventListener('click', () => guard(() => gotoPage(page)));
  return button;
}
async function refreshLibrary() {
  const items = await api('/api/library');
  $('paper-count').textContent = String(items.length).padStart(2, '0');
  $('library-list').replaceChildren();
  for (const item of items) {
    const button = document.createElement('button'); button.className = 'library-item' + (item.id === state.paper?.id ? ' active' : '');
    const title = document.createElement('strong'); title.textContent = item.name;
    const meta = document.createElement('small'); meta.textContent = item.pageCount ? `${item.pageCount} 页 · 读到第 ${item.page} 页` : '等待解析';
    button.append(title, meta); button.onclick = () => guard(() => openPaper(item.id));
    $('library-list').append(button);
  }
  updateControls();
  advanced?.refreshLibrary(items);
  return items;
}

function summaryView() {
  $('abstract-source').textContent = state.paper?.abstract?.text || '未自动识别完整摘要。可以在原文中选中摘要，再点击“翻译选中摘要”。';
  $('translation-output').textContent = state.paper?.translation || (state.config.consent ? '点击“翻译摘要”生成中文译文。' : '在模型设置中连接服务后，可以翻译与解读。原文不会在配置前发出。');
  $('translation-output').classList.toggle('placeholder', !state.paper?.translation);
}
function notesView() {
  $('notes-list').replaceChildren();
  const notes = state.paper?.notes || [];
  if (!notes.length) { const p = document.createElement('p'); p.className = 'helper'; p.textContent = '这里还没有注释。试试“解读当前页”，或选中一段原文写下想法。'; $('notes-list').append(p); }
  for (const note of notes) {
    const card = document.createElement('article'); card.className = 'note-card'; card.tabIndex = 0; card.dataset.noteId = note.id;
    const head = document.createElement('header'); const title = document.createElement('strong'); title.textContent = note.title;
    const meta = document.createElement('small'); meta.textContent = `p.${note.page} · ${note.kind === 'ai' ? 'AI 解读' : '我的笔记'}${note.sourceChanged ? ' · 原文已更新，需复核' : ''}`; head.append(title, meta);
    const quote = document.createElement('blockquote'); quote.textContent = note.quote;
    const content = document.createElement('p'); content.textContent = note.body;
    const footer = document.createElement('footer'); const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '删除';
    remove.onclick = (event) => { event.stopPropagation(); guard(async () => { if (state.busy) return; state.paper.notes = await api(path('notes'), { removeId: note.id }); notesView(); paintHighlights(); }); };
    footer.append(remove); card.append(head, quote, content, footer);
    const locate = () => guard(async () => { await gotoPage(note.page); paintHighlights(note.quote); status(`已定位第 ${note.page} 页引用`); });
    card.onclick = locate; card.onkeydown = (event) => { if (event.key === 'Enter') locate(); };
    $('notes-list').append(card);
  }
}
function addMessage(message) {
  if ($('messages').querySelector('.chat-empty')) $('messages').replaceChildren();
  const q = document.createElement('div'); q.className = 'message question'; q.textContent = message.question;
  const a = document.createElement('div'); a.className = 'message answer';
  const label = document.createElement('span'); label.className = 'answer-label'; label.textContent = '交小AI · 论文解读';
  const text = document.createElement('div'); text.textContent = message.answer || '';
  const links = document.createElement('div'); links.className = 'source-links';
  for (const citation of message.citations || []) links.append(sourceButton(citation.page));
  a.append(label, text, links);
  if (message.answer && !message.citations?.length) { const warning = document.createElement('div'); warning.className = 'uncited'; warning.textContent = '此回答没有可定位页码，请结合原文核对。'; a.append(warning); }
  $('messages').append(q, a); $('messages').scrollTop = $('messages').scrollHeight;
  return text;
}
function messagesView() {
  if (state.paper?.messages.length) { $('messages').replaceChildren(); for (const message of state.paper.messages) addMessage(message); }
  else { $('messages').replaceChildren(); const welcome = document.createElement('div'); welcome.className = 'chat-empty'; const h = document.createElement('h2'); h.textContent = '带着问题阅读。'; const p = document.createElement('p'); p.textContent = '这篇论文解决了什么问题？\n它的方法有哪些局限？\n也可以先选中一段文字。'; welcome.append(h, p); $('messages').append(welcome); }
}
function clearSelection() { state.selection = ''; $('selection-box').hidden = true; window.getSelection()?.removeAllRanges(); }

async function openPaper(id, { analyze = false } = {}) {
  if (state.busy) return;
  clearSelection(); error(''); setBusy(true, '正在读取论文…');
  let opened = false;
  try {
    state.paper = await api(`/api/papers/${id}`);
    analyze ||= !state.paper.pages.length;
    if (state.pdfTask) { state.renderVersion++; state.renderTask?.cancel(); await state.pdfTask.destroy(); state.pdf = null; }
    state.pdfTask = pdfjs.getDocument({ url: `/api/papers/${id}/pdf`, cMapUrl: '/vendor/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/vendor/standard_fonts/', wasmUrl: '/vendor/wasm/', iccUrl: '/vendor/iccs/', isEvalSupported: false });
    state.pdf = await state.pdfTask.promise;
    if (state.pdf.numPages > 500) throw new Error('本版本最多支持 500 页，请拆分文件');
    if (!state.paper.pages.length) {
      const pages = [];
      for (let number = 1; number <= state.pdf.numPages; number++) {
        status(`正在解析第 ${number} / ${state.pdf.numPages} 页`);
        const page = await state.pdf.getPage(number);
        pages.push({ number, text: textOf(await page.getTextContent()) });
      }
      await api(path('pages'), { pages }); state.paper = await api(path());
    }
    state.page = Math.min(state.pdf.numPages, state.paper.position.page || 1);
    state.zoom = state.paper.position.zoom || 1;
    $('page-total').textContent = `/ ${state.pdf.numPages}`;
    $('zoom').value = String(state.zoom);
    $('paper-title').textContent = state.paper.name;
    $('paper-meta').textContent = `${state.pdf.numPages} 页 · PDF · 阅读进度自动保存`;
    $('empty-state').hidden = true; $('page-container').hidden = false;
    summaryView(); notesView(); messagesView();
    advanced?.paperOpened();
    await renderPage(); await refreshLibrary();
    status(state.paper.pages.every((p) => !p.text.trim()) ? '此 PDF 没有原生文字；点击 OCR 可在本机识别' : `已打开 · 第 ${state.page} 页`);
    opened = true;
  } catch (err) {
    state.pdf = null; $('empty-state').hidden = false; $('page-container').hidden = true;
    if (err.name === 'PasswordException') throw new Error('这个 PDF 需要密码。请先在本机解密另存后再导入。');
    throw err;
  } finally { setBusy(false); }
  if (opened && analyze && $('auto-analyze').checked && state.config.consent && state.config.model) {
    if (state.paper.abstract.text && !state.paper.translation) await runModel('translate');
    if (!state.paper.notes.some((note) => note.page === state.page && note.kind === 'ai') && state.paper.pages[state.page - 1]?.text.trim()) await runModel('annotate');
  }
}

async function importFile(file) {
  if (!file || state.busy) return;
  if (file.size > 32 * 1024 * 1024) throw new Error('PDF 不能超过 32 MiB');
  let imported;
  setBusy(true, '正在导入 PDF…'); error('');
  try {
    const response = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) }, body: file });
    imported = await response.json(); if (!response.ok) throw new Error(imported.error);
  } finally { setBusy(false); $('file-input').value = ''; }
  await openPaper(imported.id, { analyze: true });
}

async function renderPage() {
  if (!state.pdf) return;
  advanced?.beforeRender();
  const version = ++state.renderVersion;
  state.renderTask?.cancel(); textLayer?.cancel();
  const page = await state.pdf.getPage(state.page);
  if (version !== state.renderVersion) return;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.35, Math.min(1.35, ($('reader-scroll').clientWidth - 56) / base.width)) * state.zoom;
  const viewport = page.getViewport({ scale });
  const wrapper = $('pdf-page'); wrapper.replaceChildren();
  wrapper.style.width = viewport.width + 'px'; wrapper.style.height = viewport.height + 'px';
  wrapper.style.setProperty('--scale-factor', scale); wrapper.style.setProperty('--total-scale-factor', scale);
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
  const layer = document.createElement('div'); layer.className = 'textLayer'; layer.id = 'text-layer';
  const highlights = document.createElement('div'); highlights.className = 'highlight-layer'; highlights.id = 'highlights';
  wrapper.append(canvas, highlights, layer);
  const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
  state.renderTask = renderTask;
  try {
    await renderTask.promise;
    if (version !== state.renderVersion) return;
    const ocr = state.paper.pages[state.page - 1]?.ocr;
    if (ocr?.words?.length) renderOcrLayer(layer, ocr, viewport);
    else {
      textLayer = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport });
      await textLayer.render();
    }
    if (version !== state.renderVersion) return;
    paintHighlights(); $('page-input').value = state.page;
    $('ocr-transcript').hidden = !ocr; $('ocr-transcript-text').textContent = ocr ? state.paper.pages[state.page - 1].text : '';
    advanced?.pageRendered();
  } catch (err) { if (err.name !== 'RenderingCancelledException' && err.name !== 'AbortException') throw err; }
}
function paintHighlights(focusQuote = '') {
  const layer = $('text-layer'); const overlay = $('highlights');
  if (!layer || !overlay || !state.paper) return;
  overlay.replaceChildren();
  const bounds = $('pdf-page').getBoundingClientRect();
  let first = null;
  for (const note of state.paper.notes.filter((note) => note.page === state.page)) {
    const range = quoteRange(layer, note.quote);
    if (!range) continue;
    for (const rect of range.getClientRects()) {
      if (rect.width < 1) continue;
      const mark = document.createElement('div'); mark.className = 'quote-highlight' + (note.quote === focusQuote ? ' focus' : '');
      Object.assign(mark.style, { left: rect.left - bounds.left + 'px', top: rect.top - bounds.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      overlay.append(mark); if (note.quote === focusQuote && !first) first = mark;
    }
  }
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
async function gotoPage(number) {
  if (state.busy || !state.pdf) return;
  if (!Number.isInteger(number) || number < 1 || number > state.pdf.numPages) throw new Error('页码超出范围');
  state.page = number; clearSelection(); updateControls();
  await renderPage(); $('reader-scroll').scrollTop = 0; savePosition(); status(`第 ${number} 页 · 进度自动保存`);
}
function savePosition() {
  clearTimeout(positionTimer);
  const id = state.paper.id; const position = { page: state.page, zoom: state.zoom };
  state.paper.position = position;
  positionTimer = setTimeout(() => api(`/api/papers/${id}/position`, position).then(refreshLibrary).catch((err) => error('阅读进度保存失败：' + err.message)), 150);
}

async function runModel(action, extra = {}) {
  if (state.busy || !state.paper) return;
  if (!state.config.consent || !state.config.model) { await showSettings(); return; }
  state.controller = new AbortController(); error('');
  if (action === 'translate') switchTab('summary');
  if (action === 'annotate') switchTab('notes');
  let streamingOutput = null;
  const input = { page: state.page, ...extra };
  if (action === 'ask') { switchTab('chat'); streamingOutput = addMessage({ question: input.question }); }
  if (action === 'translate') { streamingOutput = $('translation-output'); streamingOutput.textContent = ''; streamingOutput.classList.remove('placeholder'); }
  setBusy(true, action === 'annotate' ? '正在解读当前页…' : action === 'translate' ? '正在翻译摘要…' : '正在核对论文并回答…');
  let done = false;
  try {
    const response = await fetch(path(action), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: state.controller.signal });
    if (!response.ok) { const problem = await response.json(); throw new Error(problem.error); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const consume = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'delta' && streamingOutput) { streamingOutput.textContent += event.text; if (action === 'ask') $('messages').scrollTop = $('messages').scrollHeight; }
      if (event.type === 'done') {
        done = true;
        if (action === 'translate') { state.paper.translation = event.translation; state.paper.abstract = event.abstract; summaryView(); }
        if (action === 'annotate') { state.paper.notes = event.notes; notesView(); paintHighlights(); }
        if (action === 'ask') { state.paper.messages.push(event.message); messagesView(); }
      }
    };
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); consume(line); }
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
    if (!done) throw new Error('生成中断，未收到完整结果，请重试');
    status('已保存到本机阅读记录');
  } catch (err) {
    if (action === 'ask') messagesView();
    if (action === 'translate') summaryView();
    if (err.name === 'AbortError') { error('已取消生成；已保存的内容保持不变。'); }
    else error(err.message);
  } finally { state.controller = null; setBusy(false); }
}

async function showSettings() {
  state.config = await api('/api/config');
  $('model-base').value = state.config.baseUrl; $('model-name').value = state.config.model;
  $('model-key').value = ''; $('model-key').placeholder = state.config.keyConfigured ? '已配置；留空保留原密钥' : '未配置；本机模型可留空';
  $('clear-key').checked = false; $('model-consent').checked = state.config.consent;
  advanced?.settingsOpened();
  $('settings-error').hidden = true; $('settings-dialog').showModal();
}
async function guard(fn) { try { await fn(); } catch (err) { error(err.message || '操作失败'); } }

$('choose-pdf').onclick = () => $('file-input').click();
$('header-import').onclick = () => $('file-input').click();
$('file-input').onchange = () => guard(() => importFile($('file-input').files[0]));
$('reader-scroll').ondragover = (event) => { event.preventDefault(); };
$('reader-scroll').ondrop = (event) => { event.preventDefault(); guard(() => importFile(event.dataTransfer.files[0])); };
$('prev-page').onclick = () => guard(() => gotoPage(state.page - 1));
$('next-page').onclick = () => guard(() => gotoPage(state.page + 1));
$('page-input').onchange = () => guard(() => gotoPage(Number($('page-input').value)));
$('zoom').onchange = () => guard(async () => { state.zoom = Number($('zoom').value); await renderPage(); savePosition(); });
$('settings-button').onclick = () => guard(showSettings);
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => switchTab(button.dataset.tab);
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
$('auto-analyze').checked = localStorage.getItem('paper-auto-analyze') !== 'false';
$('auto-analyze').onchange = () => localStorage.setItem('paper-auto-analyze', String($('auto-analyze').checked));
$('settings-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    state.config = await api('/api/config', { baseUrl: $('model-base').value, model: $('model-name').value, apiKey: $('model-key').value, clearKey: $('clear-key').checked, consent: $('model-consent').checked, ...advanced.configFields() });
    $('model-key').value = ''; $('settings-dialog').close(); summaryView(); status('模型设置已保存在本机');
    if (state.paper && $('auto-analyze').checked && state.config.consent) {
      if (state.paper.abstract.text && !state.paper.translation) await runModel('translate');
      if (!state.paper.notes.length) await runModel('annotate');
    }
  } catch (err) { $('settings-error').textContent = err.message; $('settings-error').hidden = false; }
};
$('translate-button').onclick = () => guard(() => runModel('translate'));
$('annotate-button').onclick = () => guard(() => runModel('annotate'));
$('question-form').onsubmit = (event) => { event.preventDefault(); const question = $('question').value.trim(); if (question && !state.busy) { $('question').value = ''; guard(() => runModel('ask', { question, selection: state.selection })); } };
$('cancel-generation').onclick = () => state.controller?.abort();
$('clear-selection').onclick = clearSelection;
$('explain-selection').onclick = () => guard(() => runModel('ask', { question: '请解释选中段落的含义、关键术语和它在论文中的作用，并区分原文与推断。', selection: state.selection }));
$('translate-selection').onclick = () => guard(() => runModel('translate', { text: state.selection }));
$('add-note').onclick = () => { if (!state.selection) return; $('note-quote').textContent = state.selection; $('note-body').value = ''; $('note-title').value = '我的注释'; $('note-dialog').showModal(); };
$('note-form').onsubmit = (event) => {
  event.preventDefault(); guard(async () => { state.paper.notes = await api(path('notes'), { page: state.page, quote: state.selection, title: $('note-title').value, body: $('note-body').value }); $('note-dialog').close(); switchTab('notes'); notesView(); paintHighlights(); });
};
$('pdf-page').addEventListener('mouseup', () => {
  if (state.busy) return;
  const selection = window.getSelection(); const value = selection?.toString().trim();
  const layer = $('text-layer');
  if (!value || !selection.rangeCount || !layer?.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
  state.selection = value.slice(0, 6000); $('selection-text').textContent = state.selection; $('selection-box').hidden = false;
});
$('export-button').onclick = () => { if (state.paper) { const a = document.createElement('a'); a.href = path('export'); a.download = 'paper-notes.md'; a.click(); } };
$('delete-button').onclick = () => guard(async () => {
  if (!state.paper || state.busy || !confirm('删除这篇论文、原文件、注释和问答记录？此操作不可撤销。')) return;
  clearTimeout(positionTimer); await api(path(), {}, 'DELETE'); location.reload();
});
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width === observedWidth) return;
  observedWidth = width;
  clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.pdf && !state.busy) guard(renderPage); }, 180);
}).observe($('reader-scroll'));
window.addEventListener('pagehide', () => { if (state.paper) fetch(path('position'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.page, zoom: state.zoom }), keepalive: true }).catch(() => {}); });

advanced = mountAdvanced({ state, api, path, guard, error, status, setBusy, renderPage, summaryView, notesView, switchTab, openPaper, gotoPage });
guard(async () => { state.config = await api('/api/config'); const items = await refreshLibrary(); if (items.length) await openPaper(items[0].id); });
