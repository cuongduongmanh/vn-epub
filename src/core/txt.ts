import { type Chapter, type ParsedBook, escapeXml } from './model.js';

const NUMBER_WORDS =
  'một|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|mốt|linh|lẻ|trăm|nghìn|ngàn|nhất|nhì|cuối|' +
  'mot|bon|nam|sau|bay|tam|chin|muoi|nhat|cuoi|' +
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|last';
const VOLUME_WORDS = 'quyển|quyen|tập|tap|phần|phan|book|part|volume|vol\\.?';
const CHAPTER_WORDS = 'chương|chuong|chapter|chap\\.?|hồi|hoi|tiết|mục';
const NUM = `(?:\\d+|[ivxlcdm]+|(?:thứ\\s+)?(?:${NUMBER_WORDS})(?:\\s+(?:${NUMBER_WORDS}))*)`;
const END = `(?=$|[\\s:.\\-–—)\\]|,])`;
const SPECIAL =
  'lời\\s+(?:mở\\s+đầu|giới\\s+thiệu|tựa|nói\\s+đầu|bạt|kết|cuối|tác\\s+giả)|mở\\s+đầu|phần\\s+kết|kết\\s+thúc|vĩ\\s+thanh|' +
  'ngoại\\s+truyện|phiên\\s+ngoại|tiền\\s+truyện|hậu\\s+ký|tự\\s+tựa|prologue|epilogue|preface|afterword|introduction';

/** Regex mặc định nhận diện tiêu đề chương/quyển trong truyện tiếng Việt (và tiếng Anh). */
export const DEFAULT_CHAPTER_PATTERN =
  `^\\s*(?:(?:${VOLUME_WORDS}|${CHAPTER_WORDS})\\s*${NUM}${END}.*` +
  `|đệ\\s+[\\p{L}\\s]{1,30}?\\s+(?:chương|hồi|quyển)${END}.*` +
  `|(?:${SPECIAL})${END}.*)$`;

const VOLUME_RE = new RegExp(`^\\s*(?:${VOLUME_WORDS})\\s*${NUM}${END}`, 'iu');
const BARE_HEADING_RE = new RegExp(`^\\s*(?:${VOLUME_WORDS}|${CHAPTER_WORDS})\\s*${NUM}\\s*[:.\\-–—]?\\s*$`, 'iu');
const SCENE_BREAK_RE = /^\s*(?:[*~#=•·-]\s*){3,}$/;
const MAX_HEADING_LEN = 100;

function buildHeadingRegex(pattern?: string): RegExp {
  const src = pattern?.trim() || DEFAULT_CHAPTER_PATTERN;
  try {
    return new RegExp(src, 'iu');
  } catch (e) {
    throw new Error(`Regex tiêu đề chương không hợp lệ: ${(e as Error).message}`);
  }
}

/**
 * Đoán cách chia đoạn: nếu văn bản bị ngắt dòng cứng (dòng giữa đoạn không kết thúc bằng dấu câu)
 * thì các dòng liền nhau thuộc cùng một đoạn, ngược lại mỗi dòng là một đoạn.
 */
function detectParagraphMode(lines: string[]): 'blank' | 'line' {
  let inMulti = 0;
  let unterminated = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const cur = lines[i].trim();
    const next = lines[i + 1].trim();
    if (cur && next) {
      inMulti++;
      if (!/[.!?…:;"”’»)\]]$/.test(cur)) unterminated++;
    }
  }
  if (inMulti < 10) return 'line';
  return unterminated / inMulti > 0.6 ? 'blank' : 'line';
}

function toParagraphs(lines: string[], mode: 'blank' | 'line', isHeading: (s: string) => boolean): string[] {
  if (mode === 'line') return lines.map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(buf.join(' ').replace(/\s+/g, ' '));
    buf = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      flush();
    } else if (isHeading(l) || SCENE_BREAK_RE.test(l)) {
      // Tiêu đề chương luôn đứng riêng dù không có dòng trống bao quanh.
      flush();
      out.push(l);
    } else {
      buf.push(l);
    }
  }
  flush();
  return out;
}

function paragraphBlock(p: string): string {
  if (SCENE_BREAK_RE.test(p)) return '<p class="scene-break">* * *</p>';
  return `<p>${escapeXml(p)}</p>`;
}

function splitBySize(paragraphs: string[], maxChars: number): Chapter[] {
  const chapters: Chapter[] = [];
  let blocks: string[] = [];
  let size = 0;
  const push = () => {
    if (!blocks.length) return;
    chapters.push({ title: `Phần ${chapters.length + 1}`, level: 1, blocks, renderTitle: true });
    blocks = [];
    size = 0;
  };
  for (const p of paragraphs) {
    blocks.push(paragraphBlock(p));
    size += p.length;
    if (size >= maxChars) push();
  }
  push();
  if (chapters.length === 1) chapters[0].renderTitle = false;
  return chapters;
}

export interface TxtOptions {
  paragraphMode: ParagraphMode;
  chapterPattern?: string;
  autoSplitChars: number;
}

export function parseTxt(text: string, opts: TxtOptions): ParsedBook {
  const warnings: string[] = [];
  const headingRe = buildHeadingRegex(opts.chapterPattern);
  const isHeading = (s: string) => s.length <= MAX_HEADING_LEN && headingRe.test(s);

  const lines = text.split('\n');
  const mode = opts.paragraphMode === 'auto' ? detectParagraphMode(lines) : opts.paragraphMode;
  const paragraphs = toParagraphs(lines, mode, isHeading);

  const chapters: Chapter[] = [];
  let preface: string[] = [];
  let current: Chapter | null = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (isHeading(p)) {
      let title = p.replace(/\s+/g, ' ').trim();
      // "Chương 1" + dòng kế tiếp ngắn không có dấu câu => tên chương, gộp lại: "Chương 1: Tên chương".
      const next = paragraphs[i + 1];
      if (
        BARE_HEADING_RE.test(title) &&
        next &&
        next.length <= 60 &&
        !isHeading(next) &&
        !SCENE_BREAK_RE.test(next) &&
        !/[.,;!?…"”]$/.test(next)
      ) {
        title = `${title.replace(/\s*[:.\-–—]\s*$/, '')}: ${next.trim()}`;
        i++;
      }
      current = { title, level: VOLUME_RE.test(title) ? 1 : 2, blocks: [], renderTitle: true };
      chapters.push(current);
    } else if (current) {
      current.blocks.push(paragraphBlock(p));
    } else {
      preface.push(p);
    }
  }

  if (!chapters.length) {
    warnings.push('Không tìm thấy tiêu đề chương – sách được tự chia theo độ dài. Có thể nhập regex tiêu đề chương riêng.');
    return { chapters: splitBySize(paragraphs, opts.autoSplitChars), images: [], paragraphMode: mode, warnings };
  }

  // Chỉ có một loại cấp (toàn "Chương" hoặc toàn "Quyển") thì đưa hết về cấp 1.
  if (new Set(chapters.map((c) => c.level)).size === 1) chapters.forEach((c) => (c.level = 1));

  const result: ParsedBook = { chapters, images: [], paragraphMode: mode, warnings };
  if (preface.length) {
    // Dòng đầu ngắn trước chương 1 thường là tên truyện / tác giả.
    const first = preface[0];
    if (first.length <= 80 && !/[.!?…]$/.test(first)) {
      result.title = first;
      preface = preface.slice(1);
      const authorMatch = preface[0]?.match(/^(?:tác\s*giả|tac\s*gia|author|by)\s*[:：-]?\s*(.{1,60})$/iu);
      if (authorMatch) {
        result.author = authorMatch[1].trim();
        preface = preface.slice(1);
      }
    }
    if (preface.length) {
      chapters.unshift({ title: 'Giới thiệu', level: 1, blocks: preface.map(paragraphBlock), renderTitle: true });
    }
  }

  const empty = chapters.filter((c) => !c.blocks.length).length;
  if (empty > chapters.length / 2) {
    warnings.push(`${empty}/${chapters.length} chương không có nội dung – có thể regex tiêu đề đang bắt nhầm dòng (vd: mục lục ở đầu file).`);
  }
  return result;
}
