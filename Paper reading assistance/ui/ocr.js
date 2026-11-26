let loader;
async function loadEngine() {
  if (globalThis.Tesseract) return globalThis.Tesseract;
  loader ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/ocr/vendor/tesseract/tesseract.min.js';
    script.onload = () => resolve(globalThis.Tesseract); script.onerror = () => { loader = null; reject(new Error('OCR 组件未安装，请运行 npm --prefix "Paper reading assistance" ci')); };
    document.head.append(script);
  });
  return loader;
}
function wordBoxes(data, width, height) {
  return (data.blocks || []).flatMap((b) => b.paragraphs || []).flatMap((p) => p.lines || []).flatMap((l) => l.words || []).filter((w) => w.text?.trim()).map((w) => ({
    text: w.text, confidence: w.confidence,
    x: Math.max(0, w.bbox.x0 / width), y: Math.max(0, w.bbox.y0 / height),
    width: Math.max(0.0001, (w.bbox.x1 - w.bbox.x0) / width), height: Math.max(0.0001, (w.bbox.y1 - w.bbox.y0) / height),
  }));
}
export async function recognizePage(pdfPage, language, { signal, onProgress = () => {} } = {}) {
  const engine = await loadEngine(); signal?.throwIfAborted();
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
  const cancelRender = () => task.cancel(); signal?.addEventListener('abort', cancelRender, { once: true });
  try { await task.promise; } finally { signal?.removeEventListener('abort', cancelRender); }
  signal?.throwIfAborted();
  let worker;
  const creating = engine.createWorker(language, 1, { workerPath: '/ocr/vendor/tesseract/worker.min.js', corePath: '/ocr/vendor/core',
    langPath: '/ocr/lang', workerBlobURL: false, cacheMethod: 'none', logger: (event) => { onProgress(event.status, event.progress || 0); } });
  const abort = () => { creating.then((w) => w.terminate()).catch(() => {}); worker?.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  let rejectAbort;
  const abortRecognition = () => rejectAbort?.(new DOMException('已取消', 'AbortError'));
  try {
    worker = await creating; signal?.throwIfAborted();
    const result = await Promise.race([
      worker.recognize(canvas, {}, { text: true, blocks: true }),
      new Promise((_, reject) => { rejectAbort = reject; if (signal?.aborted) abortRecognition(); else signal?.addEventListener('abort', abortRecognition, { once: true }); }),
    ]);
    signal?.throwIfAborted();
    return { text: result.data.text.trim(), confidence: result.data.confidence, words: wordBoxes(result.data, canvas.width, canvas.height), language };
  } finally { signal?.removeEventListener('abort', abort); signal?.removeEventListener('abort', abortRecognition); await worker?.terminate(); canvas.width = canvas.height = 1; }
}

export function renderOcrLayer(layer, ocr, viewport) {
  layer.replaceChildren(); layer.className = 'ocr-text-layer';
  const context = document.createElement('canvas').getContext('2d');
  for (const word of ocr.words || []) {
    const span = document.createElement('span'); span.textContent = word.text + ' ';
    const fontSize = Math.max(5, word.height * viewport.height);
    context.font = `${fontSize}px sans-serif`;
    const measured = context.measureText(word.text).width || 1;
    Object.assign(span.style, { left: word.x * viewport.width + 'px', top: word.y * viewport.height + 'px', fontSize: fontSize + 'px',
      transform: `scaleX(${word.width * viewport.width / measured})` });
    layer.append(span);
  }
}
