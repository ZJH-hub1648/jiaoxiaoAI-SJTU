import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_PDF_BYTES, paperId, validPages, abstractOf, normalized } from './paper.js';
import { withFileLock } from './file-lock.js';

export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function createStore(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const locks = new Map();
  function directory(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('论文标识无效');
    return join(root, id);
  }
  async function read(id) { const paper = JSON.parse(await readFile(join(directory(id), 'paper.json'), 'utf8')); paper.visuals ||= []; return paper; }
  async function update(id, fn) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => withFileLock(join(directory(id), 'paper.lock'), async () => {
      const paper = await read(id);
      await fn(paper);
      paper.updatedAt = new Date().toISOString();
      await atomicJson(join(directory(id), 'paper.json'), paper);
      return paper;
    }));
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  async function importPdf(bytes, name) {
    if (bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('请选择 32 MiB 以内的 PDF 文件');
    const id = paperId(bytes);
    const dir = directory(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try { return await read(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(join(dir, 'source.pdf'), bytes, { mode: 0o600 });
    const paper = { id, name: String(name || '论文.pdf').slice(0, 240), pages: [], abstract: { text: '', page: 1, detected: false },
      translation: '', notes: [], messages: [], position: { page: 1, zoom: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await atomicJson(join(dir, 'paper.json'), paper);
    return paper;
  }
  async function setPages(id, pages) {
    const validated = validPages(pages);
    return update(id, (paper) => { paper.pages = validated; paper.abstract = abstractOf(validated); });
  }
  async function list() {
    const items = [];
    for (const id of await readdir(root)) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      try { const p = await read(id); items.push({ id, name: p.name, pageCount: p.pages.length, updatedAt: p.updatedAt, page: p.position.page }); } catch { /* Incomplete import is not a library entry. */ }
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function addNote(id, note) {
    return update(id, (paper) => {
      const page = paper.pages.find((item) => item.number === note.page);
      const quote = normalized(note.quote);
      if (!page || !quote || !normalized(page.text).includes(quote)) throw new Error('注释引用未对应论文原文');
      paper.notes.push({ id: randomUUID(), page: page.number, quote, title: String(note.title || '我的注释').slice(0, 100),
        body: String(note.body || '').slice(0, 10000), kind: 'user', createdAt: new Date().toISOString() });
    });
  }
  return { read, update, importPdf, setPages, list, addNote, directory,
    pdf: (id) => readFile(join(directory(id), 'source.pdf')),
    remove: (id) => update(id, async () => {}).then(() => rm(directory(id), { recursive: true, force: true })) };
}
