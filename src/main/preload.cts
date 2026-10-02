import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api: EpubApi = {
  pickSources: () => ipcRenderer.invoke('pick-sources'),
  pickCover: () => ipcRenderer.invoke('pick-cover'),
  pickFont: () => ipcRenderer.invoke('pick-font'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  readFileBase64: (p) => ipcRenderer.invoke('read-file-base64', p),
  analyze: (p, options) => ipcRenderer.invoke('analyze', p, options),
  convert: (p, options) => ipcRenderer.invoke('convert', p, options),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, paths: string[]) => cb(paths)),
};

contextBridge.exposeInMainWorld('api', api);
