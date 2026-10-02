import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

export type FontStyle = 'regular' | 'italic' | 'bold' | 'boldItalic';

export interface FontFile {
  style: FontStyle;
  data: Buffer;
}

export interface EmbeddedFont {
  family: string;
  files: FontFile[];
  license?: string;
}

/** Font có sẵn: đều hỗ trợ đầy đủ tiếng Việt và theo giấy phép SIL OFL (được phép nhúng vào ebook). */
export const BUNDLED_FONTS: { id: FontChoice; label: string; family: string; file: string }[] = [
  { id: 'literata', label: 'Literata (serif – font của Google Play Books)', family: 'Literata', file: 'literata' },
  { id: 'noto-serif', label: 'Noto Serif (serif)', family: 'Noto Serif', file: 'noto-serif' },
  { id: 'be-vietnam-pro', label: 'Be Vietnam Pro (sans-serif)', family: 'Be Vietnam Pro', file: 'be-vietnam-pro' },
];

const STYLES: FontStyle[] = ['regular', 'italic', 'bold', 'boldItalic'];
const STYLE_FILE: Record<FontStyle, string> = { regular: 'Regular', italic: 'Italic', bold: 'Bold', boldItalic: 'BoldItalic' };

/** Thư mục chứa font đã copy khi build (dist/fonts). */
export function fontsDir(): string {
  return path.resolve(import.meta.dirname, '..', 'fonts');
}

export function bundledFontPath(id: string, style: FontStyle): string {
  return path.join(fontsDir(), `${id}-${STYLE_FILE[style]}.ttf`);
}

export function loadFont(choice: FontChoice, customPath?: string): EmbeddedFont | null {
  if (choice === 'none') return null;
  if (choice === 'custom') {
    if (!customPath) throw new Error('Chưa chọn file font.');
    const data = fs.readFileSync(customPath);
    const sig = data.subarray(0, 4).toString('latin1');
    if (!(sig === '\x00\x01\x00\x00' || sig === 'OTTO' || sig === 'true')) {
      throw new Error('File font phải là TTF hoặc OTF.');
    }
    return { family: 'BookFont', files: [{ style: 'regular', data }] };
  }
  const def = BUNDLED_FONTS.find((f) => f.id === choice);
  if (!def) throw new Error(`Font không tồn tại: ${choice}`);
  const files = STYLES.map((style) => ({ style, data: fs.readFileSync(bundledFontPath(def.file, style)) }));
  const licensePath = path.join(fontsDir(), `${def.file}-OFL.txt`);
  const license = fs.existsSync(licensePath) ? fs.readFileSync(licensePath, 'utf-8') : undefined;
  return { family: def.family, files, license };
}

/** Toàn bộ chữ cái tiếng Việt (hoa + thường, mọi dấu) – luôn giữ lại khi cắt font. */
function vietnameseAlphabet(): string {
  const vowels = 'aăâeêioôơuưy';
  const tones = ['', '̀', '́', '̉', '̃', '̣'];
  let s = 'đĐ';
  for (const v of vowels) for (const t of tones) s += (v + t).normalize('NFC') + (v.toUpperCase() + t).normalize('NFC');
  return s;
}

const ALWAYS_KEEP =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') +
  vietnameseAlphabet() +
  '“”‘’«»…–—•·°©®™€£¥§¶†‡№  ';

/** Cắt font chỉ giữ ký tự cần dùng. Lỗi khi cắt thì trả lại font gốc. */
export async function subsetEmbeddedFont(font: EmbeddedFont, usedText: string): Promise<{ font: EmbeddedFont; warning?: string }> {
  const chars = [...new Set(usedText + ALWAYS_KEEP)].join('');
  try {
    const files = await Promise.all(
      font.files.map(async (f) => ({ style: f.style, data: await subsetFont(f.data, chars, { targetFormat: 'truetype' }) })),
    );
    return { font: { ...font, files } };
  } catch (e) {
    return { font, warning: `Không cắt được font (${(e as Error).message}) – nhúng nguyên font.` };
  }
}
