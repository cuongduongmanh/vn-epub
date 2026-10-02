// Copy font (OFL) từ node_modules và file tĩnh của giao diện vào dist/.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fontsOut = path.join(root, 'dist', 'fonts');
fs.mkdirSync(fontsOut, { recursive: true });

const FONTS = {
  literata: 'Literata',
  'noto-serif': 'NotoSerif',
  'be-vietnam-pro': 'BeVietnamPro',
};
const STYLES = { Regular: '400Regular', Italic: '400Regular_Italic', Bold: '700Bold', BoldItalic: '700Bold_Italic' };

for (const [id, prefix] of Object.entries(FONTS)) {
  const pkg = path.join(root, 'node_modules', '@expo-google-fonts', id);
  for (const [style, dir] of Object.entries(STYLES)) {
    fs.copyFileSync(path.join(pkg, dir, `${prefix}_${dir}.ttf`), path.join(fontsOut, `${id}-${style}.ttf`));
  }
  const lic = path.join(pkg, 'LICENSE_FONT');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(fontsOut, `${id}-OFL.txt`));
}

const rendererOut = path.join(root, 'dist', 'renderer');
fs.mkdirSync(rendererOut, { recursive: true });
for (const f of ['index.html', 'style.css']) {
  fs.copyFileSync(path.join(root, 'src', 'renderer', f), path.join(rendererOut, f));
}
console.log('assets copied');
