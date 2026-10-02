// Giao diện (renderer). Script thường (không phải module) – mọi truy cập hệ thống đi qua window.api.

interface Window {
  api: EpubApi;
}

interface FileItem {
  path: string;
  name: string;
  title: string;
  author: string;
  description: string;
  coverPath: string | null;
  analysis: AnalyzeResult | null;
  state: 'idle' | 'busy' | 'ok' | 'err';
  message: string;
  outputPath?: string;
}

interface GlobalSettings {
  encoding: TextEncodingOption;
  paragraphMode: ParagraphMode;
  chapterPattern: string;
  mdSplitLevel: number;
  autoSplitChars: number;
  font: FontChoice;
  customFontPath: string;
  subsetFont: boolean;
  fontSizeEm: number;
  lineHeight: number;
  textIndentEm: number;
  justify: boolean;
  autoCover: boolean;
  outputDir: string;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  encoding: 'auto',
  paragraphMode: 'auto',
  chapterPattern: '',
  mdSplitLevel: 0,
  autoSplitChars: 20000,
  font: 'literata',
  customFontPath: '',
  subsetFont: true,
  fontSizeEm: 1,
  lineHeight: 1.6,
  textIndentEm: 1.5,
  justify: true,
  autoCover: true,
  outputDir: '',
};

const SETTINGS_KEY = 'vn-epub-settings';
const bridge = window.api;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: GlobalSettings = loadSettings();
let fonts: BundledFontInfo[] = [];
const items: FileItem[] = [];
let active: FileItem | null = null;
let previewFamily = 'serif';

function loadSettings(): GlobalSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* bỏ qua */
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: number | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

function optionsFor(item: FileItem): ConvertOptions {
  return {
    title: item.title,
    author: item.author,
    description: item.description || undefined,
    encoding: settings.encoding,
    paragraphMode: settings.paragraphMode,
    chapterPattern: settings.chapterPattern || undefined,
    mdSplitLevel: settings.mdSplitLevel,
    autoSplitChars: settings.autoSplitChars,
    font: settings.font,
    customFontPath: settings.customFontPath || undefined,
    subsetFont: settings.subsetFont,
    fontSizeEm: settings.fontSizeEm,
    lineHeight: settings.lineHeight,
    textIndentEm: settings.textIndentEm,
    justify: settings.justify,
    coverPath: item.coverPath || undefined,
    outputDir: settings.outputDir || undefined,
  };
}

// ---------------- Danh sách file ----------------

function addFiles(paths: string[]) {
  for (const p of paths) {
    if (!/\.(txt|md|markdown|text)$/i.test(p) || items.some((i) => i.path === p)) continue;
    items.push({ path: p, name: basename(p), title: '', author: '', description: '', coverPath: null, analysis: null, state: 'idle', message: '' });
  }
  renderList();
  if (!active && items.length) select(items[0]);
  else if (active) void analyzeActive();
}

function renderList() {
  const ul = $('file-list');
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = item === active ? 'active' : '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.name;
    const state = document.createElement('span');
    state.className = `state ${item.state}`;
    state.textContent =
      item.message ||
      (item.analysis ? `${item.analysis.chapters.length} chương · ${item.analysis.detectedEncoding}` : item.name);
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.title = 'Bỏ file';
    rm.textContent = '×';
    rm.onclick = (e) => {
      e.stopPropagation();
      items.splice(items.indexOf(item), 1);
      if (active === item) {
        active = null;
        if (items[0]) select(items[0]);
        else $('detail').hidden = true;
      }
      renderList();
    };
    li.append(name, state, rm);
    li.onclick = () => select(item);
    ul.append(li);
  }
  ($('btn-convert-all') as HTMLButtonElement).disabled = items.length === 0;
}

function select(item: FileItem) {
  active = item;
  $('detail').hidden = false;
  $<HTMLInputElement>('f-title').value = item.title;
  $<HTMLInputElement>('f-author').value = item.author;
  $<HTMLTextAreaElement>('f-desc').value = item.description;
  renderList();
  renderStatus();
  void analyzeActive();
}

// ---------------- Phân tích ----------------

async function analyzeItem(item: FileItem): Promise<void> {
  try {
    const opts = optionsFor(item);
    // Ô trống -> để core tự lấy tên/tác giả từ file.
    item.analysis = await bridge.analyze(item.path, { ...opts, title: item.title || undefined, author: item.author || undefined });
    if (item.state === 'err') {
      item.state = 'idle';
      item.message = '';
    }
  } catch (e) {
    item.analysis = null;
    item.state = 'err';
    item.message = errorText(e);
  }
}

async function analyzeActive() {
  const item = active;
  if (!item) return;
  await analyzeItem(item);
  if (item !== active) return;
  renderAnalysis(item);
  renderList();
  void drawPreviewCover();
}

const analyzeSoon = debounce(() => void analyzeActive(), 350);

function renderAnalysis(item: FileItem) {
  const a = item.analysis;
  const stats = $('stats');
  const warn = $('warnings');
  const toc = $('toc');
  warn.innerHTML = '';
  toc.innerHTML = '';
  if (!a) {
    stats.textContent = item.message || 'Không phân tích được file.';
    return;
  }
  $<HTMLInputElement>('f-title').placeholder = a.title;
  $<HTMLInputElement>('f-author').placeholder = a.author || 'Không rõ';
  const modeLabel = a.paragraphMode === 'blank' ? 'theo dòng trống' : 'mỗi dòng một đoạn';
  stats.innerHTML = '';
  const lines = [
    ['Bảng mã', a.detectedEncoding],
    ['Chia đoạn', modeLabel],
    ['Số chương', String(a.chapters.length)],
    ['Số ký tự', a.totalChars.toLocaleString('vi-VN')],
  ];
  for (const [k, v] of lines) {
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `${k}: `;
    div.append(b, v);
    stats.append(div);
  }
  for (const w of a.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    warn.append(li);
  }
  const MAX = 500;
  a.chapters.slice(0, MAX).forEach((c) => {
    const li = document.createElement('li');
    if (!c.chars) li.className = 'empty';
    li.textContent = c.title;
    const s = document.createElement('span');
    s.className = 'chars';
    s.textContent = `${c.chars.toLocaleString('vi-VN')} ký tự`;
    li.append(s);
    toc.append(li);
  });
  if (a.chapters.length > MAX) {
    const li = document.createElement('li');
    li.textContent = `… và ${a.chapters.length - MAX} chương nữa`;
    toc.append(li);
  }
}

// ---------------- Font xem trước ----------------

async function loadPreviewFont() {
  // Mỗi phần tử: [nguồn font, độ đậm]. Font có sẵn nạp cả Regular (xem trước) và Bold (bìa).
  const sources: [string | ArrayBuffer, string][] = [];
  if (settings.font === 'custom' && settings.customFontPath) {
    const b64 = await bridge.readFileBase64(settings.customFontPath);
    sources.push([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, 'normal']);
  } else {
    const f = fonts.find((x) => x.id === settings.font);
    if (f) {
      sources.push([`url("${f.previewUrl}")`, 'normal']);
      sources.push([`url("${f.previewUrl.replace('-Regular', '-Bold')}")`, 'bold']);
    }
  }
  previewFamily = 'serif';
  if (sources.length) {
    try {
      const family = `Preview-${settings.font}-${Date.now()}`;
      for (const [src, weight] of sources) {
        const face = new FontFace(family, src, { weight });
        await face.load();
        document.fonts.add(face);
      }
      previewFamily = `"${family}", serif`;
    } catch {
      /* fallback serif */
    }
  }
  const sample = $('font-sample');
  sample.style.fontFamily = previewFamily;
  sample.style.lineHeight = String(settings.lineHeight);
  sample.style.textAlign = settings.justify ? 'justify' : 'left';
}

// ---------------- Bìa tự tạo ----------------

function hashHue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCover(canvas: HTMLCanvasElement, title: string, author: string) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const hue = hashHue(title);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue}, 45%, 26%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360}, 50%, 14%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const m = W * 0.06;
  ctx.strokeStyle = `hsla(${hue}, 60%, 80%, 0.55)`;
  ctx.lineWidth = W * 0.004;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  ctx.strokeRect(m * 1.35, m * 1.35, W - 2.7 * m, H - 2.7 * m);

  ctx.fillStyle = '#fbf7ef';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxW = W - 5 * m;

  // Giảm cỡ chữ đến khi tên sách vừa tối đa 6 dòng.
  let size = W * 0.11;
  let lines: string[] = [];
  for (; size > W * 0.035; size *= 0.92) {
    ctx.font = `bold ${size}px ${previewFamily}`;
    lines = wrapLines(ctx, title.toLocaleUpperCase('vi'), maxW);
    if (lines.length <= 6 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  // Giãn dòng rộng (1.35) vì chữ HOA tiếng Việt có dấu chồng cao (Ấ, Ễ…).
  const lh = size * 1.35;
  let y = H * 0.36 - ((lines.length - 1) * lh) / 2;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += lh;
  }

  ctx.fillStyle = `hsla(${hue}, 60%, 85%, 0.8)`;
  ctx.fillRect(W / 2 - W * 0.08, y + size * 0.1, W * 0.16, W * 0.004);

  if (author) {
    ctx.fillStyle = '#efe6d6';
    let aSize = W * 0.05;
    ctx.font = `italic ${aSize}px ${previewFamily}`;
    while (ctx.measureText(author).width > maxW && aSize > 12) {
      aSize *= 0.92;
      ctx.font = `italic ${aSize}px ${previewFamily}`;
    }
    ctx.fillText(author, W / 2, H * 0.82);
  }
}

function coverTexts(item: FileItem): [string, string] {
  return [item.title || item.analysis?.title || item.name, item.author || item.analysis?.author || ''];
}

async function drawPreviewCover() {
  const canvas = $<HTMLCanvasElement>('cover');
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!active) return;
  if (active.coverPath) {
    const b64 = await bridge.readFileBase64(active.coverPath);
    const img = new Image();
    img.src = `data:image/*;base64,${b64}`;
    await img.decode().catch(() => undefined);
    // Cắt giữa theo tỉ lệ 2:3.
    const r = Math.max(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * r;
    const h = img.height * r;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } else if (settings.autoCover) {
    drawCover(canvas, ...coverTexts(active));
  }
}

function generateCoverBase64(item: FileItem): string {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 1800;
  drawCover(c, ...coverTexts(item));
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// ---------------- Chuyển đổi ----------------

function errorText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function convertItem(item: FileItem) {
  item.state = 'busy';
  item.message = 'Đang tạo EPUB…';
  renderList();
  if (item === active) renderStatus();
  try {
    if (!item.analysis) await analyzeItem(item);
    const opts = optionsFor(item);
    if (!item.coverPath && settings.autoCover) opts.generatedCoverBase64 = generateCoverBase64(item);
    const r = await bridge.convert(item.path, opts);
    item.state = 'ok';
    item.outputPath = r.outputPath;
    item.message = `✔ ${basename(r.outputPath)} · ${(r.sizeBytes / 1024).toFixed(0)} KB`;
  } catch (e) {
    item.state = 'err';
    item.message = `Lỗi: ${errorText(e)}`;
  }
  renderList();
  if (item === active) renderStatus();
}

function renderStatus() {
  const s = $('status');
  s.innerHTML = '';
  if (!active) return;
  s.textContent = active.message;
  if (active.state === 'ok' && active.outputPath) {
    const a = document.createElement('a');
    a.textContent = ' Mở thư mục';
    const out = active.outputPath;
    a.onclick = () => void bridge.showInFolder(out);
    s.append(a);
  }
  ($('btn-convert') as HTMLButtonElement).disabled = active.state === 'busy';
}

// ---------------- Gắn sự kiện ----------------

function bindSettings() {
  const bind = <K extends keyof GlobalSettings>(id: string, key: K, parse: (el: HTMLInputElement) => GlobalSettings[K], reanalyze: boolean) => {
    const el = $<HTMLInputElement>(id);
    if (el.type === 'checkbox') el.checked = settings[key] as boolean;
    else el.value = String(settings[key]);
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      settings[key] = parse(el);
      saveSettings();
      if (reanalyze) analyzeSoon();
      if (key === 'lineHeight' || key === 'justify') void loadPreviewFont();
      if (key === 'autoCover') void drawPreviewCover();
    });
  };
  const num = (el: HTMLInputElement) => Number(el.value);
  const str = (el: HTMLInputElement) => el.value;
  const chk = (el: HTMLInputElement) => el.checked;
  bind('o-encoding', 'encoding', (el) => el.value as TextEncodingOption, true);
  bind('o-para', 'paragraphMode', (el) => el.value as ParagraphMode, true);
  bind('o-pattern', 'chapterPattern', str, true);
  bind('o-mdlevel', 'mdSplitLevel', num, true);
  bind('o-autosplit', 'autoSplitChars', (el) => Math.max(2000, Number(el.value) || 20000), true);
  bind('o-subset', 'subsetFont', chk, false);
  bind('o-size', 'fontSizeEm', num, false);
  bind('o-lh', 'lineHeight', num, false);
  bind('o-indent', 'textIndentEm', num, false);
  bind('o-justify', 'justify', chk, false);
  bind('o-autocover', 'autoCover', chk, false);

  const fontSel = $<HTMLSelectElement>('o-font');
  for (const f of fonts) fontSel.add(new Option(f.label, f.id));
  fontSel.add(new Option('Font khác (chọn file .ttf/.otf)…', 'custom'));
  fontSel.add(new Option('Không nhúng – dùng font của app đọc', 'none'));
  fontSel.value = settings.font;
  const syncFontRow = () => {
    $('custom-font-row').hidden = settings.font !== 'custom';
    $('custom-font-name').textContent = settings.customFontPath ? basename(settings.customFontPath) : 'Chưa chọn font';
  };
  syncFontRow();
  fontSel.onchange = async () => {
    settings.font = fontSel.value as FontChoice;
    saveSettings();
    syncFontRow();
    await loadPreviewFont();
    void drawPreviewCover();
  };
  $('btn-font').onclick = async () => {
    const p = await bridge.pickFont();
    if (!p) return;
    settings.customFontPath = p;
    saveSettings();
    syncFontRow();
    await loadPreviewFont();
    void drawPreviewCover();
  };

  const syncOut = () => ($('out-dir').textContent = settings.outputDir || 'Cùng thư mục với file nguồn');
  syncOut();
  $('btn-out').onclick = async () => {
    const p = await bridge.pickOutputDir();
    if (p) {
      settings.outputDir = p;
      saveSettings();
      syncOut();
    }
  };
  $('btn-out-clear').onclick = () => {
    settings.outputDir = '';
    saveSettings();
    syncOut();
  };
}

function bindItemFields() {
  const field = (id: string, key: 'title' | 'author' | 'description') => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      if (!active) return;
      active[key] = el.value;
      if (key !== 'description') {
        renderList();
        void drawPreviewCover();
      }
    });
  };
  field('f-title', 'title');
  field('f-author', 'author');
  field('f-desc', 'description');

  $('btn-cover').onclick = async () => {
    if (!active) return;
    const p = await bridge.pickCover();
    if (p) {
      active.coverPath = p;
      void drawPreviewCover();
    }
  };
  $('btn-cover-clear').onclick = () => {
    if (!active) return;
    active.coverPath = null;
    void drawPreviewCover();
  };
  $('btn-convert').onclick = () => active && void convertItem(active);
  $('btn-convert-all').onclick = async () => {
    for (const item of items) await convertItem(item);
  };
}

function bindDrop() {
  const drop = $('drop');
  $('btn-add').onclick = async () => addFiles(await bridge.pickSources());
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) drop.classList.remove('over');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = Array.from(e.dataTransfer?.files ?? []);
    addFiles(files.map((f) => bridge.pathForFile(f)).filter(Boolean));
  });
  bridge.onOpenFiles(addFiles);
}

async function init() {
  fonts = await bridge.listFonts();
  bindSettings();
  bindItemFields();
  bindDrop();
  await loadPreviewFont();
}

void init();
