// Kiểm thử nhanh: tạo file mẫu với nhiều bảng mã, chuyển sang EPUB và kiểm tra cấu trúc/XML.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { analyze, convert } from '../dist/core/convert.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-epub-test-'));
const story = `Truyện Thử Nghiệm
Tác giả: Nguyễn Văn Ẩn

Đây là lời giới thiệu ngắn của truyện.

Chương 1
Khởi đầu mới

Trời đã về khuya, ánh trăng soi xuống mặt hồ.
Người lữ khách ngồi lặng lẽ bên bờ, nghĩ về quê hương.

* * *

“Ngày mai ta sẽ đi tiếp,” ông nói – giọng trầm ấm.

Chương 2: Hành trình

Những con đường quanh co dẫn lên núi. Ầ Ẩ Ẫ Ấ Ậ Ễ Ệ Ộ Ợ Ự & <thẻ> "ngoặc".

Phần lớn người dân trong làng đều biết chuyện này.
`;

// Dạng CP1258 thật: chữ có mũ/móc dựng sẵn (ê, ơ...) + dấu thanh tổ hợp.
const toCp1258Form = (t) =>
  [...t.normalize('NFC')].map((c) => {
    const d = c.normalize('NFD');
    const tones = d.replace(/[^̣̀́̃̉]/g, '');
    return d.replace(/[̣̀́̃̉]/g, '').normalize('NFC') + tones;
  }).join('');

// Mô phỏng Windows mở nhầm UTF-8 bằng CP1252 (byte không định nghĩa giữ nguyên mã U+0081...).
const mojibake = (t) =>
  [...Buffer.from(t, 'utf-8')]
    .map((b) => {
      const c = iconv.decode(Buffer.from([b]), 'windows-1252');
      return c === '�' ? String.fromCharCode(b) : c;
    })
    .join('');

const write = (name, buf) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
};

// TCVN3: đảo bảng mã từ decode.ts bằng cách mã hoá thủ công vài ký tự
const TCVN3 = { 'à': 0xb5, 'á': 0xb8, 'ư': 0xad, 'ơ': 0xac, 'ố': 0xe8, 'ệ': 0xd6, 'ơ': 0xac, 'ờ': 0xea, 'ạ': 0xb9, 'ộ': 0xe9, 'đ': 0xae, 'ầ': 0xc7, 'ế': 0xd5, 'ê': 0xaa, 'â': 0xa9, 'ổ': 0xe6, 'ó': 0xe3, 'ể': 0xd3, 'ấ': 0xca, 'ủ': 0xf1, 'ừ': 0xf5, 'ô': 0xab };
const tcvnText = 'Chương 1\n\nNgười đàn ông đến từ phố cổ. Bạn có thể ấy đó.\n\nChương 2\n\nTiếng Việt có đầy đủ dấu.\n'.normalize('NFC');
const tcvnBuf = Buffer.from([...tcvnText].map((c) => TCVN3[c] ?? (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0x3f)));

const cases = [
  ['utf8.txt', Buffer.from(story, 'utf-8'), 'utf-8'],
  ['utf8-bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(story, 'utf-8')]), 'utf-8 (BOM)'],
  ['utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(story, 'utf-16le')]), 'utf-16le (BOM)'],
  ['nfd-mac.txt', Buffer.from(story.normalize('NFD'), 'utf-8'), 'utf-8'],
  ['cp1258.txt', iconv.encode(toCp1258Form(story), 'windows-1258'), 'windows-1258'],
  ['mojibake.txt', Buffer.from(mojibake(story), 'utf-8'), 'utf-8 + sửa lỗi mojibake'],
  ['tcvn3.txt', tcvnBuf, 'tcvn3'],
];

async function checkEpub(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const raw = fs.readFileSync(file);
  assert.equal(raw.subarray(30, 38).toString(), 'mimetype', 'mimetype phải là file đầu tiên');
  assert.equal(raw.readUInt16LE(8), 0, 'mimetype không được nén');
  for (const name of Object.keys(zip.files)) {
    if (/\.(xhtml|opf|ncx|xml)$/.test(name)) {
      const xml = await zip.file(name).async('string');
      const v = XMLValidator.validate(xml);
      assert.equal(v, true, `${name}: XML lỗi ${JSON.stringify(v)}`);
    }
  }
  return zip;
}

const strip = (s) => s.replace(/<[^>]+>/g, '');
const expected = 'Trời đã về khuya, ánh trăng soi xuống mặt hồ.';

for (const [name, buf, enc] of cases) {
  const src = write(name, buf);
  const a = analyze(src);
  assert.equal(a.detectedEncoding, enc, `${name}: bảng mã`);
  const r = await convert(src, { outputDir: path.join(dir, 'out-' + name) });
  const zip = await checkEpub(r.outputPath);
  const all = (await Promise.all(Object.keys(zip.files).filter((n) => n.includes('chapter-')).map((n) => zip.file(n).async('string')))).join('');
  if (name === 'tcvn3.txt') {
    assert.ok(strip(all).includes('Người đàn ông đến từ phố cổ'), 'TCVN3 decode');
  } else {
    assert.equal(a.title, 'Truyện Thử Nghiệm', `${name}: title`);
    assert.equal(a.author, 'Nguyễn Văn Ẩn', `${name}: author`);
    assert.deepEqual(a.chapters.map((c) => c.title), ['Giới thiệu', 'Chương 1: Khởi đầu mới', 'Chương 2: Hành trình'], `${name}: chương`);
    const text = strip(all);
    assert.ok(text.includes(expected), `${name}: nội dung`);
    assert.ok(!/[̀-ͯ]/.test(text), `${name}: còn dấu tổ hợp (chưa NFC)`);
    assert.ok(all.includes('&amp; &lt;thẻ&gt;'), `${name}: escape XML`);
  }
  assert.ok(zip.file('OEBPS/fonts/regular.ttf'), 'font nhúng');
  console.log(`✔ ${name.padEnd(14)} ${a.detectedEncoding.padEnd(26)} ${a.chapters.length} chương  ${(r.sizeBytes / 1024).toFixed(0)} KB`);
}

// Markdown
fs.mkdirSync(path.join(dir, 'img'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(dir, 'img', 'a.png'), png);
const md = `---
title: Sổ tay Markdown
author: Trần Thị Bé
---

# Sổ tay Markdown

Lời mở đầu với **chữ đậm** và *nghiêng*&nbsp;cùng<br>xuống dòng.

## Chương một

Đoạn văn có [liên kết](https://example.com) và ảnh:

![ảnh thử](img/a.png)

- [x] việc đã xong
- việc khác

| Cột A | Cột B |
|---|---|
| ấ | ợ |

<div onclick="x">html thô</div>

## Chương hai

> Trích dẫn tiếng Việt.

\`\`\`
mã <nguồn>
\`\`\`

---
`;
const mdPath = write('so-tay.md', md);
const a = analyze(mdPath);
assert.equal(a.title, 'Sổ tay Markdown');
assert.equal(a.author, 'Trần Thị Bé');
assert.deepEqual(a.chapters.map((c) => c.title), ['Mở đầu', 'Chương một', 'Chương hai']);
const r = await convert(mdPath, { font: 'be-vietnam-pro', outputDir: path.join(dir, 'out-md') });
const zip = await checkEpub(r.outputPath);
assert.ok(zip.file('OEBPS/images/img-1.png'), 'ảnh được nhúng');
console.log(`✔ ${'so-tay.md'.padEnd(14)} ${a.chapters.length} chương  ${(r.sizeBytes / 1024).toFixed(0)} KB`);

// Không có chương -> chia theo độ dài
const long = Array.from({ length: 300 }, (_, i) => `Đoạn văn số ${i + 1} kể về một ngày bình thường ở làng quê Việt Nam, nơi mọi người sống yên bình.`).join('\n\n');
const la = analyze(write('long.txt', long), { autoSplitChars: 5000 });
assert.ok(la.chapters.length > 3 && la.chapters[0].title === 'Phần 1', 'chia theo độ dài');
console.log(`✔ ${'long.txt'.padEnd(14)} ${la.chapters.length} phần`);

console.log(`\nTất cả kiểm thử đều đạt. File mẫu: ${dir}`);
