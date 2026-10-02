import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { EmbeddedFont, FontStyle } from './fonts.js';
import { type BookImage, type Chapter, IMAGE_EXT, escapeXml } from './model.js';

export interface EpubInput {
  title: string;
  author: string;
  description?: string;
  language: string;
  chapters: Chapter[];
  images: BookImage[];
  cover?: { data: Buffer; mediaType: string };
  font: EmbeddedFont | null;
  style: { fontSizeEm: number; lineHeight: number; textIndentEm: number; justify: boolean };
}

/** Mỗi file XHTML nên nhỏ (~60k ký tự) để app đọc Android mở chương nhanh, không bị giật. */
const MAX_FILE_CHARS = 60_000;

const FONT_CSS: Record<FontStyle, string> = {
  regular: 'font-weight: normal; font-style: normal;',
  italic: 'font-weight: normal; font-style: italic;',
  bold: 'font-weight: bold; font-style: normal;',
  boldItalic: 'font-weight: bold; font-style: italic;',
};

function fontMediaType(data: Buffer): { type: string; ext: string } {
  return data.subarray(0, 4).toString('latin1') === 'OTTO' ? { type: 'font/otf', ext: 'otf' } : { type: 'font/ttf', ext: 'ttf' };
}

function buildCss(input: EpubInput, fontHrefs: { style: FontStyle; href: string }[]): string {
  const { style, font } = input;
  const faces = font
    ? fontHrefs
        .map((f) => `@font-face {\n  font-family: "${font.family}";\n  src: url("${f.href}");\n  ${FONT_CSS[f.style]}\n}`)
        .join('\n')
    : '';
  const family = font ? `"${font.family}", ` : '';
  // Ghi chú tiếng Việt:
  // - line-height >= 1.5 để dấu chồng (Ầ, Ễ, Ộ...) không bị cắt/đè lên dòng trên.
  // - Tắt hyphenation: từ tiếng Việt là âm tiết đơn, bộ ngắt từ tiếng Anh sẽ chèn "-" sai.
  return `@charset "UTF-8";
${faces}
html, body {
  font-family: ${family}"Noto Serif", "Times New Roman", serif;
}
body {
  margin: 0 3%;
  ${style.fontSizeEm !== 1 ? `font-size: ${style.fontSizeEm}em;` : ''}
  line-height: ${style.lineHeight};
  text-align: ${style.justify ? 'justify' : 'left'};
  -webkit-hyphens: none;
  -epub-hyphens: none;
  adobe-hyphenate: none;
  hyphens: none;
  overflow-wrap: break-word;
  widows: 2;
  orphans: 2;
}
p {
  margin: 0 0 0.35em 0;
  text-indent: ${style.textIndentEm}em;
}
h1, h2, h3, h4, h5, h6 {
  font-family: ${family}serif;
  line-height: 1.4;
  text-align: center;
  text-indent: 0;
  hyphens: none;
  -webkit-hyphens: none;
  page-break-after: avoid;
  break-after: avoid;
  margin: 1.2em 0 1em 0;
}
h1 { font-size: 1.5em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1.05em; }
.chapter-start { page-break-before: always; break-before: page; }
.scene-break { text-align: center; text-indent: 0; margin: 1em 0; letter-spacing: 0.3em; }
blockquote { margin: 0.8em 1.5em; font-style: italic; }
blockquote p { text-indent: 0; }
pre, code { font-family: monospace; font-size: 0.9em; white-space: pre-wrap; }
pre { margin: 0.8em 0; text-align: left; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 0.8em auto; }
td, th { border: 1px solid #888; padding: 0.2em 0.5em; text-indent: 0; }
li p { text-indent: 0; }
hr { border: none; border-top: 1px solid #999; margin: 1.2em 20%; }
.title-page { text-align: center; text-indent: 0; padding-top: 25%; }
.title-page h1 { font-size: 1.8em; margin-bottom: 0.6em; }
.title-page .author { font-size: 1.15em; font-style: italic; text-indent: 0; text-align: center; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { height: 100%; max-width: 100%; }
`;
}

function xhtmlDoc(title: string, body: string, bodyAttrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi" lang="vi">
<head>
<meta charset="UTF-8" />
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body${bodyAttrs}>
${body}
</body>
</html>
`;
}

interface SpineFile {
  id: string;
  href: string;
  content: string;
  linear?: boolean;
}

interface TocEntry {
  title: string;
  href: string;
  level: number;
}

/** Chia một chương thành nhiều file XHTML nếu quá dài (mục lục chỉ trỏ tới file đầu). */
function chapterFiles(ch: Chapter, index: number): SpineFile[] {
  const parts: string[][] = [[]];
  let size = 0;
  for (const b of ch.blocks) {
    if (size >= MAX_FILE_CHARS && parts[parts.length - 1].length) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(b);
    size += b.length;
  }
  const n = String(index + 1).padStart(4, '0');
  return parts.map((blocks, i) => {
    const heading = i === 0 && ch.renderTitle ? `<h${Math.min(ch.level + 1, 6)} class="chapter-title">${escapeXml(ch.title)}</h${Math.min(ch.level + 1, 6)}>\n` : '';
    const cls = i === 0 ? ' class="chapter-start"' : '';
    const suffix = i === 0 ? '' : `-${i + 1}`;
    return {
      id: `ch${n}${suffix}`,
      href: `text/chapter-${n}${suffix}.xhtml`,
      content: xhtmlDoc(ch.title, `<section epub:type="chapter"${cls}>\n${heading}${blocks.join('\n')}\n</section>`),
    };
  });
}

function navTree(entries: TocEntry[], hrefPrefix: string): string {
  let out = '<ol>\n';
  let depth = 1;
  entries.forEach((e, i) => {
    const level = i === 0 ? 1 : Math.min(e.level, depth + 1); // không nhảy cóc cấp
    if (i > 0) {
      if (level > depth) out += '\n<ol>\n';
      else {
        out += '</li>\n';
        for (let d = depth; d > level; d--) out += '</ol>\n</li>\n';
      }
    }
    depth = level;
    out += `<li><a href="${hrefPrefix}${e.href}">${escapeXml(e.title)}</a>`;
  });
  if (entries.length) out += '</li>\n';
  for (let d = depth; d > 1; d--) out += '</ol>\n</li>\n';
  return out + '</ol>';
}

function ncxTree(entries: TocEntry[]): string {
  let out = '';
  let depth = 0;
  let order = 0;
  for (const e of entries) {
    const level = Math.min(e.level, depth + 1);
    for (let d = depth; d >= level; d--) out += '</navPoint>\n';
    depth = level;
    order++;
    out += `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeXml(e.title)}</text></navLabel><content src="${e.href}"/>\n`;
  }
  for (let d = depth; d >= 1; d--) out += '</navPoint>\n';
  return out;
}

export async function buildEpub(input: EpubInput): Promise<Buffer> {
  const zip = new JSZip();
  const uuid = `urn:uuid:${randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // "mimetype" phải là file đầu tiên và không nén.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  );

  const manifest: string[] = [];
  const spine: SpineFile[] = [];
  const toc: TocEntry[] = [];

  // Font
  const fontHrefs: { style: FontStyle; href: string }[] = [];
  if (input.font) {
    for (const f of input.font.files) {
      const { type, ext } = fontMediaType(f.data);
      const href = `fonts/${f.style}.${ext}`;
      zip.file(`OEBPS/${href}`, f.data);
      manifest.push(`<item id="font-${f.style}" href="${href}" media-type="${type}"/>`);
      fontHrefs.push({ style: f.style, href: `../${href}` });
    }
    if (input.font.license) zip.file('OEBPS/fonts/OFL.txt', input.font.license);
  }

  zip.file('OEBPS/styles/book.css', buildCss(input, fontHrefs));
  manifest.push('<item id="css" href="styles/book.css" media-type="text/css"/>');

  // Ảnh bìa
  if (input.cover) {
    const href = `images/cover.${IMAGE_EXT[input.cover.mediaType] ?? 'jpg'}`;
    zip.file(`OEBPS/${href}`, input.cover.data);
    manifest.push(`<item id="cover-image" href="${href}" media-type="${input.cover.mediaType}" properties="cover-image"/>`);
    spine.push({
      id: 'cover',
      href: 'text/cover.xhtml',
      content: xhtmlDoc(
        input.title,
        `<section epub:type="cover" class="cover"><img src="../${href}" alt="${escapeXml(input.title)}" /></section>`,
        ' class="cover"',
      ),
    });
  }

  for (const img of input.images) {
    zip.file(`OEBPS/${img.href}`, img.data);
    manifest.push(`<item id="${img.href.replace(/\W/g, '_')}" href="${img.href}" media-type="${img.mediaType}"/>`);
  }

  // Trang tên sách
  spine.push({
    id: 'titlepage',
    href: 'text/title.xhtml',
    content: xhtmlDoc(
      input.title,
      `<section epub:type="titlepage" class="title-page">\n<h1>${escapeXml(input.title)}</h1>\n${
        input.author ? `<p class="author">${escapeXml(input.author)}</p>` : ''
      }\n</section>`,
    ),
  });

  input.chapters.forEach((ch, i) => {
    const files = chapterFiles(ch, i);
    toc.push({ title: ch.title, href: files[0].href, level: ch.level });
    spine.push(...files);
  });

  // Mục lục EPUB 3 (nav.xhtml) + EPUB 2 (toc.ncx) cho các app đọc cũ trên Android.
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi" lang="vi">
<head><meta charset="UTF-8" /><title>Mục lục</title><link rel="stylesheet" type="text/css" href="styles/book.css" /></head>
<body>
<nav epub:type="toc" id="toc"><h1>Mục lục</h1>
${navTree(toc, '')}
</nav>
<nav epub:type="landmarks" hidden="hidden"><ol>
${input.cover ? '<li><a epub:type="cover" href="text/cover.xhtml">Bìa</a></li>' : ''}
<li><a epub:type="bodymatter" href="${toc[0]?.href ?? 'text/title.xhtml'}">Nội dung</a></li>
</ol></nav>
</body>
</html>
`,
  );
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="vi">
<head>
<meta name="dtb:uid" content="${uuid}"/>
<meta name="dtb:depth" content="${Math.max(1, ...toc.map((t) => t.level))}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(input.title)}</text></docTitle>
${input.author ? `<docAuthor><text>${escapeXml(input.author)}</text></docAuthor>` : ''}
<navMap>
${ncxTree(toc)}</navMap>
</ncx>
`,
  );
  manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

  for (const f of spine) {
    zip.file(`OEBPS/${f.href}`, f.content);
    manifest.push(`<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`);
  }

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="vi">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuid}</dc:identifier>
<dc:title>${escapeXml(input.title)}</dc:title>
${input.author ? `<dc:creator id="creator">${escapeXml(input.author)}</dc:creator>` : ''}
<dc:language>${input.language}</dc:language>
${input.description ? `<dc:description>${escapeXml(input.description)}</dc:description>` : ''}
<meta property="dcterms:modified">${modified}</meta>
${input.cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.map((f) => `<itemref idref="${f.id}"${f.linear === false ? ' linear="no"' : ''}/>`).join('\n')}
</spine>
${input.cover ? '<guide><reference type="cover" title="Bìa" href="text/cover.xhtml"/></guide>' : ''}
</package>
`,
  );

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    mimeType: 'application/epub+zip',
  });
}
