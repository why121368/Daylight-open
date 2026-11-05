import fs from 'node:fs';
import path from 'node:path';

// Vite resolves the complete static/dynamic graph. Check resolved files here,
// including CSS/assets, instead of trying to discover JS imports with a regex.
export function frontendInputs(root) {
  const realRoot = fs.realpathSync(root);
  const allowed = ['src', 'shared', 'public', 'node_modules'].map(name => path.join(realRoot, name));
  return {
    name: 'daylight-frontend-inputs',
    enforce: 'pre',
    load(id) {
      if (id.includes('\0')) return null;
      const file = id.split('?')[0];
      if (!path.isAbsolute(file) || !fs.existsSync(file)) return null;
      const resolved = fs.realpathSync(file);
      if (resolved === path.join(realRoot, 'index.html')
        || allowed.some(directory => resolved.startsWith(directory + path.sep))) return null;
      throw new Error(`Frontend input is outside the Docker build sources: ${path.relative(realRoot, resolved)}. Move public build data into src/ and run npm run evidence:sync.`);
    },
  };
}
