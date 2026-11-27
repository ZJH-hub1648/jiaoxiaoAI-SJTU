import { createCanvas } from '@napi-rs/canvas';
export function scannedFixture() {
  const canvas = createCanvas(1400, 700); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black'; ctx.font = '38px sans-serif';
  ['SCANNED EVIDENCE STUDY', 'Abstract', 'We study evidence based reading.', 'Readers should verify source evidence.', 'Keywords: evidence, reading'].forEach((line, index) => ctx.fillText(line, 70, 100 + index * 95));
  const jpeg = canvas.toBuffer('image/jpeg'); const drawing = Buffer.from('q 612 0 0 306 0 0 cm /Im1 Do Q');
  const objects = [null, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 306] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${drawing.length} >>\nstream\n`), drawing, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1400 /Height 700 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')])];
  const pieces = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = pieces[0].length;
  for (let id = 1; id < objects.length; id++) { offsets.push(length); const piece = Buffer.concat([Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from('\nendobj\n')]); pieces.push(piece); length += piece.length; }
  pieces.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(pieces);
}
