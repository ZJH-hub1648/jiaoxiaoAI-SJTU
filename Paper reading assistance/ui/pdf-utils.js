export function textOf(content) {
  return content.items.filter((item) => typeof item.str === 'string').map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
}

// Map normalized PDF text back to concrete text nodes. Insert separators between
// PDF.js spans so quotes spanning separate PDF text items still match.
export function quoteRange(container, quote) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent) nodes.push(node);
  let text = '';
  const locations = [];
  for (const node of nodes) {
    if (text && !text.endsWith(' ')) { text += ' '; locations.push(null); }
    for (let i = 0; i < node.textContent.length; i++) {
      const char = node.textContent[i];
      if (/\s/u.test(char)) {
        if (!text.endsWith(' ')) { text += ' '; locations.push({ node, offset: i }); }
      } else { text += char; locations.push({ node, offset: i }); }
    }
  }
  const needle = String(quote).replace(/\s+/gu, ' ').trim();
  let start = needle ? text.indexOf(needle) : -1;
  if (start < 0) return null;
  let end = start + needle.length - 1;
  while (start <= end && !locations[start]) start++;
  while (end >= start && !locations[end]) end--;
  if (start > end) return null;
  const range = document.createRange();
  range.setStart(locations[start].node, locations[start].offset);
  range.setEnd(locations[end].node, locations[end].offset + 1);
  return range;
}
