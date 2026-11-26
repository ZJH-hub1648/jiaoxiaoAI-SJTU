// A tiny, self-generated PDF: no private paper or third-party copyrighted text.
export const PAGES = [
  { number: 1, text: 'A Small Study of Grounded Reading\nAbstract\nWe propose a reading assistant that links explanations to source pages. Our method preserves evidence and helps readers verify each claim.\nKeywords: reading, evidence\n1 Introduction\nSource-grounded answers help readers inspect the original document.\nThe assistant never replaces critical reading.' },
  { number: 2, text: '2 Method and Limitations\nThe method retrieves relevant passages and attaches page references.\nThe study has two limitations: small samples and imperfect text extraction.\nA page reference identifies a source, but does not prove a claim is true.\n3 Conclusion\nReaders should always check the source evidence.' },
];
export const QUOTE = 'Source-grounded answers help readers inspect the original document.';
export function fixturePdf() {
  const objects = [null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, page] of PAGES.entries()) {
    const lines = page.text.split('\n').flatMap((line) => line.match(/.{1,76}(?:\s|$)/g)?.map((s) => s.trim()) || [line]);
    const commands = ['BT', '/F1 12 Tf', '16 TL', '55 735 Td', ...lines.flatMap((line, i) => [i ? 'T*' : '', `(${line.replace(/[()\\]/g, '\\$&')}) Tj`]), 'ET'].join('\n');
    objects[index ? 6 : 4] = `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`;
  }
  let content = '%PDF-1.4\n'; const offsets = [0];
  for (let id = 1; id < objects.length; id++) { offsets.push(Buffer.byteLength(content)); content += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
export function mockAnswer(prompt) {
  if (prompt.includes('只返回 JSON 数组')) return JSON.stringify([{ title: '证据与解释', quote: QUOTE, explanation: '作者强调回答应回到原文核对。页码定位有助于阅读，但不等于结论已经被证明。' }]);
  if (prompt.includes('忠实翻译')) return '我们提出一种阅读助手，将解释与原文页码关联。该方法保留证据，并帮助读者核验每项论断。';
  return '本文将回答与相关原文片段关联，以便读者核对依据 [p.1]。研究局限包括样本量小和文字提取不完善 [p.2]。';
}
export function mockFetch(_url, options) {
  const request = JSON.parse(options.body);
  const answer = mockAnswer(request.messages.at(-1).content);
  const frames = Array.from(answer).reduce((pieces, char, index) => {
    if (index % 12 === 0) pieces.push(''); pieces[pieces.length - 1] += char; return pieces;
  }, []);
  return Promise.resolve(new Response(frames.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
}
