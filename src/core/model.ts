export interface Chapter {
  title: string;
  /** Cấp trong mục lục (1 = cao nhất). */
  level: number;
  /** Các khối XHTML đã escape, mỗi phần tử là một khối hoàn chỉnh (p, h2, table...). */
  blocks: string[];
  /** true = builder tự chèn tiêu đề chương (TXT); false = tiêu đề đã nằm trong blocks (Markdown). */
  renderTitle: boolean;
}

export interface BookImage {
  /** Đường dẫn trong OEBPS, vd "images/img-1.png". */
  href: string;
  data: Buffer;
  mediaType: string;
}

export interface ParsedBook {
  title?: string;
  author?: string;
  chapters: Chapter[];
  images: BookImage[];
  paragraphMode?: 'blank' | 'line';
  warnings: string[];
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bỏ thẻ để lấy text thuần (dùng để đếm ký tự, cắt font, đặt tiêu đề). */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export function chapterChars(ch: Chapter): number {
  return ch.blocks.reduce((n, b) => n + stripTags(b).length, 0);
}

export function imageMediaType(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (data.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const head = data.subarray(0, 256).toString('utf-8');
  if (/<svg[\s>]/i.test(head) || (head.startsWith('<?xml') && data.includes('<svg'))) return 'image/svg+xml';
  return null;
}

export const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
