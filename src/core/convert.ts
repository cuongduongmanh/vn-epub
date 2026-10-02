import fs from 'node:fs';
import path from 'node:path';
import { decodeBuffer, normalizeVietnamese } from './decode.js';
import { buildEpub } from './epub.js';
import { loadFont, subsetEmbeddedFont } from './fonts.js';
import { parseMarkdown } from './markdown.js';
import { type ParsedBook, chapterChars, imageMediaType, stripTags } from './model.js';
import { parseTxt } from './txt.js';

export const DEFAULT_OPTIONS: ConvertOptions = {
  encoding: 'auto',
  paragraphMode: 'auto',
  mdSplitLevel: 0,
  autoSplitChars: 20_000,
  font: 'literata',
  subsetFont: true,
  fontSizeEm: 1,
  lineHeight: 1.6,
  textIndentEm: 1.5,
  justify: true,
};

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd']);

function titleFromFilename(p: string): string {
  return path
    .basename(p, path.extname(p))
    .normalize('NFC')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeFilename(name: string): string {
  return (
    name
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/, '')
      .slice(0, 150) || 'book'
  );
}

interface Loaded {
  book: ParsedBook;
  encoding: string;
  title: string;
  author: string;
}

function load(sourcePath: string, opts: ConvertOptions): Loaded {
  const decoded = decodeBuffer(fs.readFileSync(sourcePath), opts.encoding);
  const text = normalizeVietnamese(decoded.text);
  const isMd = MD_EXT.has(path.extname(sourcePath).toLowerCase());
  const book = isMd
    ? parseMarkdown(text, sourcePath, opts)
    : parseTxt(text, { paragraphMode: opts.paragraphMode, chapterPattern: opts.chapterPattern, autoSplitChars: opts.autoSplitChars });
  book.warnings.unshift(...decoded.warnings);
  return {
    book,
    encoding: decoded.encoding,
    title: opts.title?.trim() || book.title || titleFromFilename(sourcePath),
    author: opts.author?.trim() || book.author || '',
  };
}

export function analyze(sourcePath: string, options: Partial<ConvertOptions> = {}): AnalyzeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { book, encoding, title, author } = load(sourcePath, opts);
  const chapters = book.chapters.map((c) => ({ title: c.title, chars: chapterChars(c) }));
  return {
    sourcePath,
    title,
    author,
    detectedEncoding: encoding,
    paragraphMode: book.paragraphMode ?? 'blank',
    chapters,
    totalChars: chapters.reduce((n, c) => n + c.chars, 0),
    warnings: book.warnings,
  };
}

export async function convert(sourcePath: string, options: Partial<ConvertOptions> = {}): Promise<ConvertResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { book, title, author } = load(sourcePath, opts);
  const warnings = [...book.warnings];

  let cover: { data: Buffer; mediaType: string } | undefined;
  if (opts.coverPath) {
    const data = fs.readFileSync(opts.coverPath);
    const mediaType = imageMediaType(data);
    if (mediaType && mediaType !== 'image/svg+xml') cover = { data, mediaType };
    else warnings.push('Ảnh bìa phải là JPG/PNG/GIF/WEBP – bỏ qua ảnh bìa.');
  } else if (opts.generatedCoverBase64) {
    cover = { data: Buffer.from(opts.generatedCoverBase64, 'base64'), mediaType: 'image/jpeg' };
  }

  let font = loadFont(opts.font, opts.customFontPath);
  if (font && opts.subsetFont) {
    const used = [title, author, opts.description ?? '', ...book.chapters.flatMap((c) => [c.title, ...c.blocks.map(stripTags)])].join('');
    const r = await subsetEmbeddedFont(font, used);
    font = r.font;
    if (r.warning) warnings.push(r.warning);
  }

  const epub = await buildEpub({
    title,
    author,
    description: opts.description,
    language: 'vi',
    chapters: book.chapters,
    images: book.images,
    cover,
    font,
    style: { fontSizeEm: opts.fontSizeEm, lineHeight: opts.lineHeight, textIndentEm: opts.textIndentEm, justify: opts.justify },
  });

  const outDir = opts.outputDir || path.dirname(sourcePath);
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${safeFilename(title)}.epub`);
  fs.writeFileSync(outputPath, epub);
  return { outputPath, sizeBytes: epub.length, chapters: book.chapters.length, warnings };
}
