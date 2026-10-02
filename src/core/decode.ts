import iconv from 'iconv-lite';

export interface DecodedText {
  text: string;
  encoding: string;
  warnings: string[];
}

// Bảng mã TCVN3 (ABC) -> Unicode. Font TCVN3 dùng chung mã cho chữ hoa có dấu
// (hiển thị bằng font .VnTimeH) nên chữ hoa có dấu sẽ thành chữ thường.
const TCVN3: Record<number, string> = {
  0xa1: 'Ă', 0xa2: 'Â', 0xa3: 'Ê', 0xa4: 'Ô', 0xa5: 'Ơ', 0xa6: 'Ư', 0xa7: 'Đ',
  0xa8: 'ă', 0xa9: 'â', 0xaa: 'ê', 0xab: 'ô', 0xac: 'ơ', 0xad: 'ư', 0xae: 'đ',
  0xb5: 'à', 0xb6: 'ả', 0xb7: 'ã', 0xb8: 'á', 0xb9: 'ạ',
  0xbb: 'ằ', 0xbc: 'ẳ', 0xbd: 'ẵ', 0xbe: 'ắ', 0xc6: 'ặ',
  0xc7: 'ầ', 0xc8: 'ẩ', 0xc9: 'ẫ', 0xca: 'ấ', 0xcb: 'ậ',
  0xcc: 'è', 0xce: 'ẻ', 0xcf: 'ẽ', 0xd0: 'é', 0xd1: 'ẹ',
  0xd2: 'ề', 0xd3: 'ể', 0xd4: 'ễ', 0xd5: 'ế', 0xd6: 'ệ',
  0xd7: 'ì', 0xd8: 'ỉ', 0xdc: 'ĩ', 0xdd: 'í', 0xde: 'ị',
  0xdf: 'ò', 0xe1: 'ỏ', 0xe2: 'õ', 0xe3: 'ó', 0xe4: 'ọ',
  0xe5: 'ồ', 0xe6: 'ổ', 0xe7: 'ỗ', 0xe8: 'ố', 0xe9: 'ộ',
  0xea: 'ờ', 0xeb: 'ở', 0xec: 'ỡ', 0xed: 'ớ', 0xee: 'ợ',
  0xef: 'ù', 0xf1: 'ủ', 0xf2: 'ũ', 0xf3: 'ú', 0xf4: 'ụ',
  0xf5: 'ừ', 0xf6: 'ử', 0xf7: 'ữ', 0xf8: 'ứ', 0xf9: 'ự',
  0xfa: 'ỳ', 0xfb: 'ỷ', 0xfc: 'ỹ', 0xfd: 'ý', 0xfe: 'ỵ',
};

function decodeTcvn3(buf: Buffer): string {
  let out = '';
  for (const b of buf) {
    out += TCVN3[b] ?? (b < 0x80 ? String.fromCharCode(b) : iconv.decode(Buffer.from([b]), 'windows-1252'));
  }
  return out;
}

/** Byte đặc trưng của TCVN3 (nguyên âm có dấu phổ biến) – hiếm khi xuất hiện trong văn bản CP1258. */
const TCVN3_MARKERS = new Set([0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9]);

function looksLikeTcvn3(buf: Buffer): boolean {
  let high = 0;
  let markers = 0;
  for (const b of buf) {
    if (b >= 0x80) {
      high++;
      if (TCVN3_MARKERS.has(b)) markers++;
    }
  }
  return high > 0 && markers / high > 0.3;
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** UTF-16 không có BOM: rất nhiều byte 0 ở vị trí chẵn hoặc lẻ. */
function guessUtf16(buf: Buffer): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(buf.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) evenZero++;
    if (buf[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  if (oddZero / half > 0.3 && evenZero / half < 0.05) return 'utf-16le';
  if (evenZero / half > 0.3 && oddZero / half < 0.05) return 'utf-16be';
  return null;
}

// Lỗi "mojibake": file UTF-8 từng bị mở nhầm bằng Windows-1252 rồi lưu lại
// (vd: "Tiáº¿ng Viá»‡t"). Chuyển ngược ký tự -> byte CP1252 rồi giải mã lại UTF-8.
const MOJIBAKE_RE = /(?:Ã[\u0080-¿]|á[º»]|Ä[‘\u0091]|Æ[°¡]|Ä\u0090)/g;
let cp1252Reverse: Map<string, number> | null = null;

function repairMojibake(text: string): string | null {
  const hits = text.match(MOJIBAKE_RE)?.length ?? 0;
  if (hits < 3) return null;
  if (!cp1252Reverse) {
    cp1252Reverse = new Map();
    for (let b = 0x80; b <= 0xff; b++) {
      const ch = iconv.decode(Buffer.from([b]), 'windows-1252');
      // 0x81, 0x8D, 0x8F, 0x90, 0x9D không có trong CP1252 – Windows giữ nguyên thành U+0081... (xử lý ở dưới).
      if (ch !== '�') cp1252Reverse.set(ch, b);
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (cp1252Reverse.has(ch)) bytes.push(cp1252Reverse.get(ch)!);
    else if (code <= 0xff) bytes.push(code);
    else return null; // có ký tự ngoài CP1252 -> không phải mojibake thuần
  }
  const buf = Buffer.from(bytes);
  if (!isValidUtf8(buf)) return null;
  return buf.toString('utf-8');
}

export function decodeBuffer(buf: Buffer, encoding: TextEncodingOption = 'auto'): DecodedText {
  const warnings: string[] = [];
  let text: string;
  let used: string;

  if (encoding !== 'auto') {
    used = encoding;
    text = encoding === 'tcvn3' ? decodeTcvn3(buf) : iconv.decode(buf, encoding);
  } else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    used = 'utf-8 (BOM)';
    text = buf.subarray(3).toString('utf-8');
  } else if (buf[0] === 0xff && buf[1] === 0xfe) {
    used = 'utf-16le (BOM)';
    text = iconv.decode(buf.subarray(2), 'utf-16le');
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    used = 'utf-16be (BOM)';
    text = iconv.decode(buf.subarray(2), 'utf-16be');
  } else if (guessUtf16(buf)) {
    used = guessUtf16(buf)!;
    text = iconv.decode(buf, used);
  } else if (isValidUtf8(buf)) {
    used = 'utf-8';
    text = buf.toString('utf-8');
  } else if (looksLikeTcvn3(buf)) {
    used = 'tcvn3';
    text = decodeTcvn3(buf);
    warnings.push('File có vẻ dùng bảng mã TCVN3 (ABC) cũ – đã chuyển sang Unicode. Chữ HOA có dấu có thể bị thành chữ thường, hãy kiểm tra lại.');
  } else {
    used = 'windows-1258';
    text = iconv.decode(buf, 'windows-1258');
    warnings.push('File không phải UTF-8 – đã đọc theo Windows-1258. Nếu chữ bị lỗi, hãy chọn bảng mã thủ công.');
  }

  const repaired = repairMojibake(text);
  if (repaired) {
    text = repaired;
    used += ' + sửa lỗi mojibake';
    warnings.push('Phát hiện chữ bị lỗi kiểu "Tiáº¿ng Viá»‡t" – đã tự động sửa.');
  }

  return { text, encoding: used, warnings };
}

/**
 * Chuẩn hoá văn bản tiếng Việt:
 * - NFC: gộp chữ + dấu tổ hợp thành ký tự dựng sẵn (file từ macOS hay CP1258 thường ở dạng NFD,
 *   nhiều app đọc Android hiển thị dấu bị lệch/tách rời với dạng này).
 * - Bỏ ký tự vô hình, BOM lẫn trong file, chuẩn hoá xuống dòng.
 */
export function normalizeVietnamese(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[​‌‍⁠﻿­]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .normalize('NFC');
}
