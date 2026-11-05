/** Build an isolated client inventory with exact eager and route asset sizes. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.resolve(root, process.argv[2] || '');
if (!directory.startsWith(path.join(root, 'work') + path.sep)) throw new Error('Output must be a directory below work/.');
fs.mkdirSync(directory, { recursive: true });
const relative = id => id.replaceAll('\\', '/').replace(root.replaceAll('\\', '/'), '.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inventoryFile = path.join(directory, 'inventory.json');
let chunks;
if (process.argv.includes('--existing')) {
  ({ chunks } = JSON.parse(fs.readFileSync(inventoryFile, 'utf8')));
} else await build({
  build: { outDir: path.join(directory, 'dist'), manifest: true },
  plugins: [{ name: 'daylight-client-inventory', generateBundle(_options, bundle) {
    chunks = Object.fromEntries(Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => [chunk.fileName, {
      name: chunk.name, entry: chunk.isEntry, dynamicEntry: chunk.isDynamicEntry,
      imports: chunk.imports, dynamicImports: chunk.dynamicImports,
      modules: Object.entries(chunk.modules).map(([id, info]) => ({ id: relative(id), renderedLength: info.renderedLength }))
        .sort((a, b) => b.renderedLength - a.renderedLength),
    }]));
  } }],
});
// Vite adds preload dependencies after generateBundle. Measure the final files.
const dist = path.join(directory, 'dist');
const manifestBytes = fs.readFileSync(path.join(dist, '.vite', 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const assets = {};
const addAsset = file => {
  if (assets[file]) return;
  const bytes = fs.readFileSync(path.join(dist, file));
  assets[file] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha(bytes) };
};
for (const [file, chunk] of Object.entries(chunks)) {
  addAsset(file);
  Object.assign(chunk, assets[file]);
}
const closure = (...names) => {
  const visited = new Set();
  const visit = name => {
    if (visited.has(name)) return;
    const item = manifest[name];
    if (!item) throw new Error(`Missing manifest dependency: ${name}`);
    visited.add(name);
    (item.imports || []).forEach(visit);
  };
  names.forEach(visit);
  const js = new Set(), css = new Set();
  for (const name of visited) {
    const item = manifest[name];
    if (item.file.endsWith('.js')) js.add(item.file);
    (item.css || []).forEach(file => css.add(file));
  }
  const group = set => {
    const files = [...set].sort();
    files.forEach(addAsset);
    return { files, bytes: files.reduce((sum, file) => sum + assets[file].bytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + assets[file].gzipBytes, 0) };
  };
  return { javaScript: group(js), css: group(css) };
};
const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry);
const initial = closure(entryKey);
const inventory = {
  createdAt: new Date().toISOString(), kind: 'Final Vite files and manifest static import closure',
  measurement: 'Final dist files; gzipSync default compression per file; excludes HTML, APIs, images and dynamic imports beyond the selected route.',
  manifestSha256: sha(manifestBytes), entry: manifest[entryKey].file,
  initialJavaScript: initial.javaScript, initialCss: initial.css,
  routes: Object.fromEntries(Object.entries(manifest).filter(([, item]) => item.isDynamicEntry)
    .map(([key, item]) => [item.name, { manifestKey: key, ...closure(entryKey, key) }])),
  assets, chunks,
};
fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2) + '\n');
console.log('CLIENT_INVENTORY_SAVED', path.relative(root, directory), JSON.stringify({
  initialJavaScript: inventory.initialJavaScript, initialCss: inventory.initialCss,
  experience: inventory.routes['experience-page'],
}));
