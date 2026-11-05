import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function releaseSources(root) {
  let candidates;
  if (fs.existsSync(path.join(root, '.git'))) {
    const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Could not enumerate the Git source checkout.');
    candidates = result.stdout.split('\0').filter(Boolean);
  } else {
    // An extracted delivery is portable and has no .git directory. Never discover
    // its enclosing repository (for example when verifying it inside work/).
    const manifestPath = path.join(root, 'DELIVERY-MANIFEST.json');
    if (!fs.existsSync(manifestPath)) throw new Error('A Git checkout or extracted delivery manifest is required.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported delivery manifest.');
    candidates = manifest.files.map(entry => entry.path);
  }
  return [...new Set(candidates)].filter(file => {
    if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid release source path.');
    if (/^(?:data|work|output|dist|node_modules|\.git|delivery-evidence)\//.test(file)) return false;
    if (/(?:^|\/)(?:\.env(?:\..*)?|compose\.env(?:\..*)?)$/.test(file) && !file.endsWith('.example')) return false;
    if (/\.(?:pem|pfx|p12|key)$|(?:^|\/)id_(?:rsa|ed25519)$/.test(file)) return false;
    // Files referenced as optional historical evidence are kept in the repository;
    // the release contains current evidence rather than copying past runtime logs.
    if (file.startsWith('docs/submission/deployment/evidence/') || file.startsWith('deploy/verification/')) return false;
    if (file.endsWith('.log')) return false;
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid release source path.');
    return fs.existsSync(resolved) && fs.lstatSync(resolved).isFile();
  }).sort();
}
export function sourceDigest(root) {
  const hash = createHash('sha256');
  for (const file of releaseSources(root).filter(file => !file.startsWith('docs/') && !/\.md$/i.test(file))) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  }
  return hash.digest('hex');
}

export function treeDigest(directory) {
  const hash = createHash('sha256');
  function walk(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), `${relative}/`);
      else if (entry.isFile()) hash.update(relative).update('\0').update(fs.readFileSync(path.join(current, entry.name))).update('\0');
      else throw new Error('Only regular build files are permitted in a delivery package.');
    }
  }
  walk(directory);
  return hash.digest('hex');
}
