import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { validRect, validateOcr } from './advanced.js';
const require = createRequire(import.meta.url);
globalThis.DOMMatrix ||= DOMMatrix; globalThis.ImageData ||= ImageData; globalThis.Path2D ||= Path2D;
let library;
export async function loadPdf(bytes) {
  library ||= import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument } = await library;
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0,
    standardFontDataUrl: join(root, 'standard_fonts') + '/', cMapUrl: join(root, 'cmaps') + '/', cMapPacked: true });
  try { const pdf = await task.promise; if (pdf.numPages > 500) throw new Error('最多支持 500 页'); return { pdf, close: () => task.destroy() }; }
  catch (err) { await task.destroy(); throw err; }
}
export async function extractPdf(bytes) {
  const document = await loadPdf(bytes);
  try {
    const pages = [];
    for (let number = 1; number <= document.pdf.numPages; number++) {
      const page = await document.pdf.getPage(number); const content = await page.getTextContent();
      const text = content.items.filter((i) => typeof i.str === 'string').map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').trim();
      pages.push({ number, text });
    }
    return pages;
  } finally { await document.close(); }
}
export async function rendered(bytes, number, maxSide = 2200) {
  const document = await loadPdf(bytes);
  try {
    if (!Number.isInteger(number) || number < 1 || number > document.pdf.numPages) throw new Error('页码无效');
    const page = await document.pdf.getPage(number); const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.5, maxSide / Math.max(base.width, base.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  } finally { await document.close(); }
}
export async function cropPdf(bytes, page, input) {
  const rect = validRect(input); const source = await rendered(bytes, page, 2000);
  const canvas = createCanvas(Math.max(1, Math.ceil(source.width * rect.width)), Math.max(1, Math.ceil(source.height * rect.height)));
  canvas.getContext('2d').drawImage(source, source.width * rect.x, source.height * rect.y, source.width * rect.width, source.height * rect.height, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}
export async function ocrPdf(bytes, page, language, dataDir) {
  if (!['eng', 'eng+chi_sim'].includes(language)) throw new Error('OCR 语言必须为 eng 或 eng+chi_sim');
  const langPath = join(dataDir, 'ocr-languages'); await mkdir(langPath, { recursive: true, mode: 0o700 });
  for (const lang of language.split('+')) {
    const data = require(`@tesseract.js-data/${lang}`);
    try { await copyFile(join(data.langPath, `${lang}.traineddata.gz`), join(langPath, `${lang}.traineddata.gz`), constants.COPYFILE_EXCL); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  const canvas = await rendered(bytes, page);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(language, 1, { langPath, cacheMethod: 'none', gzip: true, logger() {} });
  try {
    const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, blocks: true });
    const words = (data.blocks || []).flatMap((b) => b.paragraphs || []).flatMap((p) => p.lines || []).flatMap((l) => l.words || [])
      .filter((w) => w.text?.trim()).map((w) => ({ text: w.text, confidence: w.confidence, x: w.bbox.x0 / canvas.width, y: w.bbox.y0 / canvas.height,
        width: Math.max(.00001, (w.bbox.x1 - w.bbox.x0) / canvas.width), height: Math.max(.00001, (w.bbox.y1 - w.bbox.y0) / canvas.height) }));
    return validateOcr({ page, text: data.text, language, confidence: data.confidence, words }, page);
  } finally { await worker.terminate(); }
}
