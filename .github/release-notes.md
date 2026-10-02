Bản phát hành đầu tiên của **VN EPUB Maker** – chuyển file TXT / Markdown sang EPUB 3 tối ưu tiếng Việt để đọc trên Android.

## Tải về

| Hệ điều hành | File |
|---|---|
| Windows 10/11 (64-bit) | `VN-EPUB-Maker-Setup-*.exe` |
| macOS Apple Silicon (M1/M2/M3…) | `VN-EPUB-Maker-*-arm64.dmg` |
| macOS Intel | `VN-EPUB-Maker-*-x64.dmg` |

## Tính năng

- Tự nhận diện bảng mã UTF-8, UTF-16, Windows-1258, TCVN3 (ABC); tự sửa chữ lỗi kiểu `Tiáº¿ng Viá»‡t`
- Chuẩn hoá Unicode NFC để dấu tiếng Việt không bị lệch/tách trên app đọc Android
- Tự tách chương: Chương / Hồi / Quyển / Phần / Lời mở đầu… (mục lục 2 cấp); Markdown tách theo heading
- Nhúng font Literata, Noto Serif, Be Vietnam Pro (hoặc font riêng), tự cắt font cho nhẹ
- Tự tạo ảnh bìa từ tên sách và tác giả
- EPUB 3 kèm mục lục EPUB 2 (toc.ncx) cho app đọc cũ

## Lưu ý khi cài

Bản này **chưa ký số**:
- **Windows:** SmartScreen cảnh báo → bấm *More info* → *Run anyway*.
- **macOS:** chuột phải vào app → *Open* → *Open*. Nếu báo "app bị hỏng", chạy:
  `xattr -cr "/Applications/VN EPUB Maker.app"`

Trên Android (Moon+ Reader, ReadEra…) hãy bật **"Dùng font của sách"** để hiển thị font đã nhúng.
