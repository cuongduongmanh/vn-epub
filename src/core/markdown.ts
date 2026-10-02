import fs from 'node:fs';
import path from 'node:path';
import { Marked, type Token, type Tokens, type TokensList } from 'marked';
import { type BookImage, type Chapter, type ParsedBook, IMAGE_EXT, escapeXml, imageMediaType, stripTags } from './model.js';

const SAFE_INLINE_TAGS = /^<\/?(b|i|em|strong|u|s|del|ins|sup|sub|small|mark|span|br|hr)\s*\/?>$/i;

// Entity HTML phổ biến -> ký tự (XHTML chỉ hiểu &amp; &lt; &gt; &quot; &apos;).
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•', times: '×',
  divide: '÷', para: '¶', sect: '§', shy: '', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
};

function toXhtml(html: string): string {
  return html
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name: string) => {
      if (/^(amp|lt|gt|quot|apos)$/.test(name)) return m;
      const ch = NAMED_ENTITIES[name.toLowerCase()];
      return ch === undefined ? `&amp;${name};` : ch;
    })
    .replace(/<(br|hr|img|input|col|wbr|source)(\s[^>]*?)?\s*\/?>/gi, (_, tag: string, attrs = '') => `<${tag.toLowerCase()}${attrs} />`)
    .replace(/(<input\b[^>]*?)\b(disabled|checked)=""/gi, '$1$2="$2"');
}

function parseFrontMatter(src: string): { body: string; meta: Record<string, string> } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { body: src, meta: {} };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { body: src.slice(m[0].length), meta };
}

function pickSplitLevel(tokens: Token[]): number {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const t of tokens) if (t.type === 'heading') counts[(t as Tokens.Heading).depth]++;
  for (let d = 1; d <= 3; d++) if (counts[d] >= 2) return d;
  return 0;
}

export interface MdOptions {
  mdSplitLevel: number;
  autoSplitChars: number;
}

export function parseMarkdown(src: string, sourcePath: string, opts: MdOptions): ParsedBook {
  const warnings: string[] = [];
  const { body, meta } = parseFrontMatter(src);
  const baseDir = path.dirname(sourcePath);
  const images: BookImage[] = [];
  const imageByPath = new Map<string, string>();

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // Không tin HTML thô (có thể làm hỏng XHTML) – chỉ giữ vài thẻ định dạng đơn giản.
      html({ text }: Tokens.HTML | Tokens.Tag) {
        const t = text.trim();
        if (SAFE_INLINE_TAGS.test(t)) return t;
        if (/^<!--[\s\S]*-->$/.test(t)) return '';
        return escapeXml(text);
      },
    },
  });

  const tokens = marked.lexer(body);

  // Ảnh cục bộ: nhúng vào EPUB. Ảnh từ URL: giữ link (app đọc offline sẽ không hiện).
  marked.walkTokens(tokens, (tok) => {
    if (tok.type !== 'image') return;
    const img = tok as Tokens.Image;
    if (/^(https?:|data:)/i.test(img.href)) {
      warnings.push(`Ảnh online không được nhúng: ${img.href}`);
      return;
    }
    const abs = path.resolve(baseDir, decodeURI(img.href.split(/[?#]/)[0]));
    let href = imageByPath.get(abs);
    if (!href) {
      if (!fs.existsSync(abs)) {
        warnings.push(`Không tìm thấy ảnh: ${img.href}`);
        return;
      }
      const data = fs.readFileSync(abs);
      const mediaType = imageMediaType(data);
      if (!mediaType) {
        warnings.push(`Định dạng ảnh không hỗ trợ: ${img.href}`);
        return;
      }
      href = `images/img-${images.length + 1}.${IMAGE_EXT[mediaType]}`;
      images.push({ href, data, mediaType });
      imageByPath.set(abs, href);
    }
    img.href = `../${href}`;
  });

  const renderToken = (tok: Token): string => {
    const list = [tok] as unknown as TokensList;
    list.links = tokens.links;
    return toXhtml(marked.parser(list)).trim();
  };

  const splitLevel = opts.mdSplitLevel || pickSplitLevel(tokens);
  let title = meta.title;
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  const preface: string[] = [];

  // Một H1 duy nhất ở đầu file khi tách theo H2 => là tên sách.
  if (splitLevel >= 2) {
    const firstIdx = tokens.findIndex((t) => t.type !== 'space');
    const first = tokens[firstIdx] as Tokens.Heading | undefined;
    const h1Count = tokens.filter((t) => t.type === 'heading' && (t as Tokens.Heading).depth === 1).length;
    if (first?.type === 'heading' && first.depth === 1 && h1Count === 1) {
      title ??= stripTags(renderToken(first)).trim();
      tokens.splice(firstIdx, 1);
    }
  }

  for (const tok of tokens) {
    if (tok.type === 'space') continue;
    const html = renderToken(tok);
    if (!html) continue;
    if (splitLevel && tok.type === 'heading' && (tok as Tokens.Heading).depth <= splitLevel) {
      const h = tok as Tokens.Heading;
      current = { title: stripTags(html).trim() || `Chương ${chapters.length + 1}`, level: h.depth, blocks: [html], renderTitle: false };
      chapters.push(current);
    } else if (current) {
      current.blocks.push(html);
    } else {
      preface.push(html);
    }
  }

  if (!chapters.length) {
    // Không tách được -> chia theo độ dài, ngắt tại ranh giới khối.
    let blocks: string[] = [];
    let size = 0;
    for (const b of preface) {
      blocks.push(b);
      size += stripTags(b).length;
      if (size >= opts.autoSplitChars) {
        chapters.push({ title: `Phần ${chapters.length + 1}`, level: 1, blocks, renderTitle: true });
        blocks = [];
        size = 0;
      }
    }
    if (blocks.length) chapters.push({ title: `Phần ${chapters.length + 1}`, level: 1, blocks, renderTitle: true });
    if (chapters.length === 1) chapters[0].renderTitle = false;
  } else {
    if (preface.length) chapters.unshift({ title: 'Mở đầu', level: chapters[0].level, blocks: preface, renderTitle: true });
    const minLevel = Math.min(...chapters.map((c) => c.level));
    chapters.forEach((c) => (c.level = c.level - minLevel + 1));
  }

  return { title, author: meta.author, chapters, images, warnings };
}
