# VN EPUB Maker

App desktop (Windows + macOS) chuyển file **TXT / Markdown** sang **EPUB 3** để đọc trên Android
(Moon+ Reader, ReadEra, Lithium, KOReader, Google Play Books, PocketBook…), xử lý kỹ tiếng Việt.
Viết bằng TypeScript + Electron.

## Tính năng

**Đọc file tiếng Việt**
- Tự nhận diện bảng mã: UTF-8 (có/không BOM), UTF-16 LE/BE, Windows-1258, **TCVN3 (ABC)**; chọn tay nếu cần.
- Tự sửa chữ bị lỗi kiểu `Tiáº¿ng Viá»‡t` (file UTF-8 bị mở nhầm bằng CP1252 rồi lưu lại).
- Chuẩn hoá **Unicode NFC**: file từ macOS/CP1258 ở dạng tổ hợp (NFD) làm dấu bị lệch hoặc tách rời trên nhiều app Android – được gộp thành ký tự dựng sẵn.
- Bỏ ký tự vô hình (zero-width, soft hyphen, BOM lẫn trong file).

**Tách chương**
- TXT: nhận diện `Chương 1`, `Chương một`, `Hồi thứ nhất`, `Đệ nhất chương`, `Quyển/Phần/Tập …` (tạo mục lục 2 cấp), `Lời mở đầu`, `Vĩ thanh`, `Ngoại truyện`, `Chapter`, `Prologue`… Gộp `Chương 1` + dòng tên chương bên dưới thành `Chương 1: Tên chương`. Có thể nhập regex riêng.
- Tự đoán cách chia đoạn (văn bản bị ngắt dòng cứng sẽ được nối lại).
- Markdown: tách theo H1/H2/H3 (tự chọn), đọc front matter `title`/`author`, nhúng ảnh cục bộ.
- Không có chương → tự chia theo độ dài. Chương quá dài được chia nhỏ file XHTML để app đọc mở nhanh.

**Font & trình bày**
- Nhúng sẵn font hỗ trợ đầy đủ tiếng Việt, giấy phép SIL OFL: **Literata**, **Noto Serif**, **Be Vietnam Pro** (đủ Regular/Italic/Bold/BoldItalic), hoặc chọn file `.ttf/.otf` riêng, hoặc không nhúng.
- **Cắt font** (subset bằng HarfBuzz) chỉ giữ ký tự dùng trong sách + toàn bộ bảng chữ tiếng Việt: ~250 KB → ~70 KB mỗi kiểu chữ.
- CSS cho tiếng Việt: `line-height` ≥ 1.5 để dấu chồng (Ầ, Ễ, Ộ) không bị cắt, tắt hyphenation (bộ ngắt từ tiếng Anh chèn "-" sai vào âm tiết tiếng Việt), `xml:lang="vi"`.
- Tự tạo ảnh bìa từ tên sách / tác giả bằng chính font đã chọn, hoặc dùng ảnh riêng.
- Có cả `nav.xhtml` (EPUB 3) và `toc.ncx` (EPUB 2) để tương thích app đọc cũ.

## Chạy khi phát triển

```bash
npm install
npm start          # build + mở app
npm test           # kiểm thử chuyển đổi (nhiều bảng mã, Markdown, XML hợp lệ)
```

Dòng lệnh (không cần giao diện):

```bash
npm run build
node dist/cli.js truyen.txt -o out --font literata
node dist/cli.js truyen.txt --analyze      # chỉ xem danh sách chương
```

## Đóng gói bộ cài

```bash
npm run dist:win   # release/VN EPUB Maker Setup x.y.z.exe  (chạy trên Windows)
npm run dist:mac   # release/*.dmg cho Intel + Apple Silicon (phải chạy trên macOS)
```

Không có máy Mac: push tag `v1.0.0` (hoặc bấm *Run workflow*) – GitHub Actions trong
`.github/workflows/build.yml` build cả `.exe` và `.dmg`, tải về ở mục *Artifacts*.

> Bản chưa ký số: Windows SmartScreen sẽ cảnh báo (bấm *More info → Run anyway*); macOS chặn app
> chưa notarize – chuột phải vào app → *Open*, hoặc chạy `xattr -cr "/Applications/VN EPUB Maker.app"`.
> Muốn phát hành chính thức cần chứng chỉ ký số (Windows) và Apple Developer ID (macOS).

> Windows: nếu thư mục dự án nằm ở đường dẫn rất dài (> 260 ký tự), Electron sẽ lỗi
> `Error loading V8 startup snapshot file` – hãy đặt dự án ở đường dẫn ngắn, vd `C:\dev\vn-epub`.

Thêm icon: đặt `build/icon.ico` (Windows) và `build/icon.icns` hoặc `build/icon.png` 1024×1024 (macOS).

## Mẹo đọc trên Android

- **Moon+ Reader**: Cài đặt → Hiển thị → bật *Dùng font của sách* (Use book's fonts), nếu không app sẽ dùng font của nó.
- **ReadEra**: mở sách → *Aa* → chọn font *Mặc định của sách* (Publisher).
- **Google Play Books**: tải EPUB lên play.google.com/books → *Tải lên*; chọn font *Mặc định của nhà xuất bản*.
- Nếu không thích font nhúng, chọn *Không nhúng* – app đọc sẽ dùng font hệ thống (Android có Noto hỗ trợ tiếng Việt).

## Cấu trúc

```
src/core/decode.ts     nhận diện bảng mã, TCVN3, sửa mojibake, chuẩn hoá NFC
src/core/txt.ts        chia đoạn + tách chương TXT
src/core/markdown.ts   Markdown → XHTML (marked), ảnh, front matter
src/core/fonts.ts      font có sẵn + subset
src/core/epub.ts       dựng EPUB 3 (OPF, nav, NCX, CSS, bìa)
src/core/convert.ts    ghép các bước, dùng chung cho app và CLI
src/main/              Electron main + preload
src/renderer/          giao diện, tạo bìa bằng canvas
```
