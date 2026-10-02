// Kiểu dữ liệu dùng chung giữa main process, preload và renderer (khai báo global).

type TextEncodingOption = 'auto' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1258' | 'tcvn3';

/** 'auto' = tự đoán; 'blank' = đoạn văn cách nhau bằng dòng trống; 'line' = mỗi dòng là một đoạn. */
type ParagraphMode = 'auto' | 'blank' | 'line';

/** Font nhúng: id font có sẵn, 'custom' (file người dùng chọn) hoặc 'none' (dùng font của app đọc). */
type FontChoice = 'literata' | 'noto-serif' | 'be-vietnam-pro' | 'custom' | 'none';

interface ConvertOptions {
  title?: string;
  author?: string;
  description?: string;
  encoding: TextEncodingOption;
  paragraphMode: ParagraphMode;
  /** Regex (không có dấu /) để nhận diện dòng tiêu đề chương trong TXT. Rỗng = mặc định. */
  chapterPattern?: string;
  /** Markdown: cấp heading dùng để tách chương (1-6). 0 = tự động. */
  mdSplitLevel: number;
  /** Nếu không tìm thấy chương nào: tự chia mỗi phần khoảng N ký tự. */
  autoSplitChars: number;
  font: FontChoice;
  /** Đường dẫn font tuỳ chọn (TTF/OTF) khi font = 'custom'. */
  customFontPath?: string;
  /** Cắt font chỉ giữ ký tự dùng trong sách (giảm dung lượng rất nhiều). */
  subsetFont: boolean;
  fontSizeEm: number;
  lineHeight: number;
  textIndentEm: number;
  justify: boolean;
  /** Ảnh bìa: đường dẫn file ảnh. */
  coverPath?: string;
  /** Ảnh bìa JPEG được renderer tạo tự động (base64, không có tiền tố data:). */
  generatedCoverBase64?: string;
  /** Thư mục xuất; rỗng = cùng thư mục với file nguồn. */
  outputDir?: string;
}

interface ChapterSummary {
  title: string;
  chars: number;
}

interface AnalyzeResult {
  sourcePath: string;
  title: string;
  author: string;
  detectedEncoding: string;
  paragraphMode: 'blank' | 'line';
  chapters: ChapterSummary[];
  totalChars: number;
  warnings: string[];
}

interface ConvertResult {
  outputPath: string;
  sizeBytes: number;
  chapters: number;
  warnings: string[];
}

interface BundledFontInfo {
  id: FontChoice;
  label: string;
  /** Đường dẫn tương đối từ renderer tới file regular, dùng để vẽ bìa. */
  previewUrl: string;
}

interface EpubApi {
  pickSources(): Promise<string[]>;
  pickCover(): Promise<string | null>;
  pickFont(): Promise<string | null>;
  pickOutputDir(): Promise<string | null>;
  pathForFile(file: File): string;
  readFileBase64(path: string): Promise<string>;
  analyze(path: string, options: ConvertOptions): Promise<AnalyzeResult>;
  convert(path: string, options: ConvertOptions): Promise<ConvertResult>;
  showInFolder(path: string): Promise<void>;
  listFonts(): Promise<BundledFontInfo[]>;
  /** File được mở từ hệ điều hành (Open with / kéo vào icon app). */
  onOpenFiles(cb: (paths: string[]) => void): void;
}
