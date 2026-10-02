import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { analyze, convert } from '../core/convert.js';
import { BUNDLED_FONTS } from '../core/fonts.js';

const SOURCE_EXT = ['txt', 'md', 'markdown', 'text'];
let win: BrowserWindow | null = null;

/** File mở bằng "Open with" / kéo vào icon app (macOS gửi qua open-file, Windows qua argv). */
const pendingFiles: string[] = process.argv.slice(1).filter((a) => SOURCE_EXT.includes(path.extname(a).slice(1).toLowerCase()));

function sendPending() {
  if (win && pendingFiles.length) win.webContents.send('open-files', pendingFiles.splice(0));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    title: 'VN EPUB Maker',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', sendPending);
  win.on('closed', () => (win = null));
}

app.on('open-file', (e, file) => {
  e.preventDefault();
  pendingFiles.push(file);
  sendPending();
});

const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) =>
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)));

handle('pick-sources', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Chọn file TXT / Markdown',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Văn bản', extensions: SOURCE_EXT }, { name: 'Tất cả', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

handle('pick-cover', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Chọn ảnh bìa',
    properties: ['openFile'],
    filters: [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

handle('pick-font', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Chọn font (phải hỗ trợ tiếng Việt)',
    properties: ['openFile'],
    filters: [{ name: 'Font', extensions: ['ttf', 'otf'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

handle('pick-output-dir', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Chọn thư mục lưu EPUB', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('read-file-base64', (p: string) => fs.readFileSync(p).toString('base64'));
handle('analyze', (p: string, o: ConvertOptions) => analyze(p, o));
handle('convert', (p: string, o: ConvertOptions) => convert(p, o));
handle('show-in-folder', (p: string) => shell.showItemInFolder(p));
handle('list-fonts', (): BundledFontInfo[] =>
  BUNDLED_FONTS.map((f) => ({ id: f.id, label: f.label, previewUrl: `../fonts/${f.file}-Regular.ttf` })),
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
