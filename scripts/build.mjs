import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const css = readFileSync(resolve(root, 'src/style.css'), 'utf-8');
const js = readFileSync(resolve(root, 'src/script.js'), 'utf-8');
const template = readFileSync(resolve(root, 'src/template.html'), 'utf-8');
const worker = readFileSync(resolve(root, 'src/worker.js'), 'utf-8');

const html = template
  .replace('/* INLINE_CSS */', css)
  .replace('/* INLINE_JS */', js);

const output = worker.replace('/* INLINE_HTML */', () => {
  return html;
});

writeFileSync(resolve(root, '_worker.js'), output);
console.log('✓ _worker.js built successfully');
