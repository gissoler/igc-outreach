/* Extracción de texto EN EL NAVEGADOR: los archivos originales nunca salen del equipo; al servidor
   solo llega el texto (máx. 60.000 caracteres por documento). PDF con pdf.js; DOCX, PPTX y XLSX
   leyendo el ZIP con DecompressionStream; TXT, MD, CSV y JSON como texto. */
export const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 60_000;

export type Extracted = { text: string; pages?: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
const stripXml = (xml: string, paragraph: RegExp) => decode(xml.replace(paragraph, '\n').replace(/<(?:w:tab|a:tab)\/>/g, '\t').replace(/<w:br\/>|<a:br\/>/g, '\n').replace(/<[^>]+>/g, ''));
const tidy = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, MAX_CHARS);

async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The file looks damaged.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (method === 0) out.set(name, dec.decode(data));
    else if (method === 8) out.set(name, dec.decode(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
  }
  return out;
}

const slideNo = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] || 0);

async function docx(buf: ArrayBuffer) {
  const files = await unzip(buf, (n) => n === 'word/document.xml');
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('No text found in this Word file.');
  return { text: tidy(stripXml(xml, /<\/w:p>/g)) };
}

async function pptx(buf: ArrayBuffer) {
  const files = await unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = [...files.keys()].sort((a, b) => slideNo(a) - slideNo(b));
  if (!slides.length) throw new Error('No slides found.');
  return { text: tidy(slides.map((n) => `[Slide ${slideNo(n)}]\n${stripXml(files.get(n)!, /<\/a:p>/g)}`).join('\n\n')), pages: slides.length };
}

async function xlsx(buf: ArrayBuffer) {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheets = [...files.keys()].filter((n) => n.includes('worksheets')).sort((a, b) => slideNo(a) - slideNo(b));
  const parts = sheets.map((n) => {
    const rows = [...files.get(n)!.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const attrs = c[1];
      const body = c[2] || '';
      if (/t="s"/.test(attrs)) return shared[Number(body.match(/<v>(\d+)<\/v>/)?.[1])] ?? '';
      if (/t="inlineStr"/.test(attrs)) return decode(body.replace(/<[^>]+>/g, ''));
      return decode(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
    }).join('\t').replace(/\t+$/, '')).filter(Boolean);
    return `[Sheet ${slideNo(n)}]\n${rows.join('\n')}`;
  });
  return { text: tidy(parts.join('\n\n')), pages: sheets.length };
}

async function pdf(buf: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < MAX_CHARS; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
    pages.push(`[Page ${i}]\n${text}`);
    total += text.length;
  }
  const text = tidy(pages.join('\n\n'));
  if (text.replace(/\[Página \d+\]|\s/g, '').length < 40) throw new Error('This PDF has no selectable text. Upload the .pptx/.docx or paste the text.');
  return { text, pages: doc.numPages };
}

export async function extractText(file: File): Promise<Extracted> {
  if (file.size > MAX_FILE_BYTES) throw new Error('25 MB max per file.');
  const ext = file.name.toLowerCase().split('.').pop() || '';
  if (['txt', 'md', 'csv', 'json'].includes(ext)) {
    const text = tidy(await file.text());
    if (!text) throw new Error('The file is empty.');
    return { text };
  }
  const buf = await file.arrayBuffer();
  if (ext === 'pdf') return pdf(buf);
  if (ext === 'docx') return docx(buf);
  if (ext === 'pptx') return pptx(buf);
  if (ext === 'xlsx') return xlsx(buf);
  if (ext === 'doc' || ext === 'ppt' || ext === 'xls') throw new Error('Old Office format: save as .docx, .pptx or .xlsx.');
  throw new Error('Unsupported format. Use PDF, Word, PowerPoint, Excel or text.');
}
