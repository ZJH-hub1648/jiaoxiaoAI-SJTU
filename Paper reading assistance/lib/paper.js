import { createHash } from 'node:crypto';

export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export function paperId(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function normalized(text) { return String(text || '').replace(/\s+/gu, ' ').trim(); }
export function validPages(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 500) throw new Error('论文必须包含 1–500 页');
  let length = 0;
  return pages.map((page, index) => {
    if (page.number !== index + 1 || typeof page.text !== 'string' || page.text.length > 100000) throw new Error('论文页码或文本格式无效');
    length += page.text.length;
    if (length > 3000000) throw new Error('论文文本过大，请拆分文档');
    return { number: index + 1, text: page.text };
  });
}

export function abstractOf(pages) {
  const opening = pages.slice(0, 3).map((page) => ({ ...page, clean: normalized(page.text) }));
  for (const page of opening) {
    const match = /(?:\babstract\b|摘\s*要)\s*[:：.\-—]?\s*/iu.exec(page.clean);
    if (!match) continue;
    const rest = page.clean.slice(match.index + match[0].length);
    const stop = /(?:\bkey\s*words?\b|\bindex terms\b|\b(?:1\s*[.．]?\s*)?introduction\b|关\s*键\s*词|(?:1\s*[.．]?\s*)?引\s*言)/iu.exec(rest);
    const text = rest.slice(0, stop ? stop.index : 8000).trim();
    if (text.length > 30) return { text, page: page.number, detected: true };
  }
  return { text: '', page: 1, detected: false };
}

export function chunksOf(pages) {
  const chunks = [];
  for (const page of pages) {
    const text = normalized(page.text);
    for (let start = 0; start < text.length; start += 1300) {
      chunks.push({ id: `p${page.number}-${start}`, page: page.number, text: text.slice(start, start + 1600) });
    }
  }
  return chunks;
}

function terms(text) {
  const lower = normalized(text).toLowerCase();
  const words = lower.match(/[a-z0-9]{2,}/g) || [];
  const chinese = lower.match(/[\p{Script=Han}]+/gu) || [];
  for (const part of chinese) for (let i = 0; i < part.length - 1; i++) words.push(part.slice(i, i + 2));
  return [...new Set(words)];
}

export function contextFor(pages, question, currentPage = 1, selection = '') {
  const chunks = chunksOf(pages);
  const needles = terms(question + ' ' + selection);
  const ranked = chunks.map((chunk) => {
    const text = chunk.text.toLowerCase();
    let score = chunk.page === currentPage ? 2 : 0;
    for (const term of needles) if (text.includes(term)) score += 3;
    if (selection && text.includes(normalized(selection).slice(0, 80).toLowerCase())) score += 30;
    if (chunk.page === 1) score += 1;
    return { ...chunk, score };
  }).sort((a, b) => b.score - a.score).slice(0, 10);
  return ranked.map(({ id, page, text }) => ({ id, page, text }));
}

export function validateNotes(raw, pages, requestedPage) {
  if (!Array.isArray(raw)) throw new Error('模型未返回有效注释列表，请重试');
  const page = pages.find((entry) => entry.number === requestedPage);
  const source = normalized(page?.text);
  const notes = [];
  for (const item of raw.slice(0, 4)) {
    const quote = normalized(item.quote);
    if (!quote || quote.length > 1000 || !source.includes(quote) || !String(item.explanation || '').trim()) continue;
    notes.push({ page: requestedPage, quote, title: String(item.title || '论文解读').slice(0, 100),
      body: String(item.explanation).slice(0, 6000), kind: 'ai', verified: true });
  }
  if (!notes.length) throw new Error('模型注释未能对应本页原文，未保存；可选中文本后重试');
  return notes;
}

export function checkedCitations(answer, contexts) {
  const allowed = new Set(contexts.map((entry) => entry.page));
  const cited = new Set();
  const text = answer.replace(/\[p\.(\d+)\]/g, (match, number) => {
    const page = Number(number);
    if (!allowed.has(page)) return '[未核验页码]';
    cited.add(page);
    return match;
  });
  return { text, citations: [...cited].map((page) => ({ page, excerpts: contexts.filter((item) => item.page === page).map((item) => item.text) })) };
}
