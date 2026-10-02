#!/usr/bin/env node
import { analyze, convert } from './core/convert.js';

const HELP = `Cách dùng: vn-epub <file.txt|file.md> [tuỳ chọn]

  -o, --out <thư mục>      Thư mục xuất (mặc định: cạnh file nguồn)
  -t, --title <tên>        Tên sách
  -a, --author <tên>       Tác giả
  -f, --font <id>          literata | noto-serif | be-vietnam-pro | none | đường dẫn .ttf/.otf
  -e, --encoding <mã>      auto | utf-8 | utf-16le | utf-16be | windows-1258 | tcvn3
  -p, --paragraph <kiểu>   auto | blank | line
      --chapter <regex>    Regex dòng tiêu đề chương
      --cover <ảnh>        Ảnh bìa JPG/PNG
      --no-subset          Nhúng nguyên font (không cắt)
      --analyze            Chỉ phân tích, in danh sách chương
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return;
  }
  const opts: Partial<ConvertOptions> = {};
  const files: string[] = [];
  let onlyAnalyze = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`Thiếu giá trị cho ${a}`);
      return v;
    };
    switch (a) {
      case '-o': case '--out': opts.outputDir = next(); break;
      case '-t': case '--title': opts.title = next(); break;
      case '-a': case '--author': opts.author = next(); break;
      case '-e': case '--encoding': opts.encoding = next() as TextEncodingOption; break;
      case '-p': case '--paragraph': opts.paragraphMode = next() as ParagraphMode; break;
      case '--chapter': opts.chapterPattern = next(); break;
      case '--cover': opts.coverPath = next(); break;
      case '--no-subset': opts.subsetFont = false; break;
      case '--analyze': onlyAnalyze = true; break;
      case '-f': case '--font': {
        const v = next();
        if (/\.(ttf|otf)$/i.test(v)) { opts.font = 'custom'; opts.customFontPath = v; }
        else opts.font = v as FontChoice;
        break;
      }
      default:
        if (a.startsWith('-')) throw new Error(`Tuỳ chọn không hợp lệ: ${a}`);
        files.push(a);
    }
  }
  for (const file of files) {
    if (onlyAnalyze) {
      const r = analyze(file, opts);
      console.log(`${r.title} — ${r.author || '(không rõ tác giả)'} | mã: ${r.detectedEncoding} | đoạn: ${r.paragraphMode} | ${r.chapters.length} chương, ${r.totalChars} ký tự`);
      r.chapters.forEach((c, i) => console.log(`  ${String(i + 1).padStart(4)}. ${c.title} (${c.chars})`));
      r.warnings.forEach((w) => console.warn(`  ! ${w}`));
    } else {
      const r = await convert(file, opts);
      console.log(`✔ ${r.outputPath} (${(r.sizeBytes / 1024).toFixed(0)} KB, ${r.chapters} chương)`);
      r.warnings.forEach((w) => console.warn(`  ! ${w}`));
    }
  }
}

main().catch((e) => {
  console.error(`Lỗi: ${(e as Error).message}`);
  process.exit(1);
});
