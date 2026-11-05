#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { releaseSources, sourceDigest, treeDigest } from './lib/release-inventory.mjs';
import { verifyDeliveryIntegrity } from './lib/delivery-integrity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let verificationPath;
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--verification' || !args[index + 1]) throw new Error('Usage: npm run release:bundle -- [--verification work/release-check-.../summary.json]');
  verificationPath = path.resolve(args[++index]);
}
if (!verificationPath) {
  const candidates = fs.readdirSync(path.join(root, 'work'), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('release-check-'))
    .map(entry => path.join(root, 'work', entry.name, 'summary.json')).filter(file => fs.existsSync(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  verificationPath = candidates[0];
}
if (!verificationPath) throw new Error('Run npm run verify before creating a delivery package.');
const verification = JSON.parse(fs.readFileSync(verificationPath));
if (!verification.ok || verification.stages?.length !== 5 || verification.stages.some(stage => stage.code !== 0)
    || verification.sourceDigest !== sourceDigest(root) || verification.buildDigest !== treeDigest(path.join(root, 'dist'))) {
  throw new Error('The current source needs a successful npm run verify. Existing/older reports cannot approve changed code.');
}
const workRoot = path.join(root, 'work');
const stage = fs.mkdtempSync(path.join(workRoot, 'delivery-stage-'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const outputDir = path.join(root, 'output', 'delivery');
fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(outputDir, `daylight-demo-${stamp}.tar.gz`);
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [];
function copy(source, relative) {
  const target = path.join(stage, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  files.push({ path: relative.replaceAll('\\', '/'), bytes: fs.statSync(target).size, sha256: hashFile(target) });
}
for (const file of releaseSources(root)) copy(path.join(root, file), file);
function copyTree(directory, prefix) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not permitted in the release build.');
    if (entry.isDirectory()) copyTree(path.join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (entry.isFile()) copy(path.join(directory, entry.name), `${prefix}/${entry.name}`);
  }
}
copyTree(path.join(root, 'dist'), 'dist');
copy(verificationPath, 'delivery-evidence/summary.json');
for (const step of verification.stages) copy(path.join(path.dirname(verificationPath), step.log), `delivery-evidence/${step.log}`);
const starter = `# Daylight 竞赛交付包

源码版本：\`${verification.sourceCommit}\`。需要 Node.js >=22.19 和 npm。

## 1. 校验文件

在解压目录执行：

\`\`\`sh
node scripts/verify-delivery.mjs . --out work/package-integrity.json
\`\`\`

校验覆盖源码、构建、说明和五阶段验证日志。拿到交付包时，先核对随包提供的 SHA-256。

## 2. 安装与启动

\`\`\`sh
npm ci
npm run demo -- --no-build
\`\`\`

打开 http://127.0.0.1:3180/experience，免登录走完七步体验。

- 技术与实测：http://127.0.0.1:3180/evidence
- 分章讲解：http://127.0.0.1:3180/demo
- 完整工作区：http://127.0.0.1:3180/login，点击「进入演示工作区」

演示使用独立样例数据，邮件提取采用预置结果，工具当场执行。实时邮箱、模型和 SMTP 由演示模式关闭。每次启动在 work 下新建数据目录；Ctrl+C 结束。

## 3. 重新验证与部署

\`\`\`sh
npm run verify
\`\`\`

五阶段原始结果：delivery-evidence/summary.json。部署方式：docs/delivery/cloud-deployment.md；现场脚本：docs/delivery/demo-script.md。

公网体验：https://daylight.yunforis.com/experience。node_modules 由首次联网安装取得，源码和构建的完整清单见 DELIVERY-MANIFEST.json。
`;
fs.writeFileSync(path.join(stage, 'START-HERE.md'), starter);
files.push({ path: 'START-HERE.md', bytes: Buffer.byteLength(starter), sha256: hashFile(path.join(stage, 'START-HERE.md')) });
fs.writeFileSync(path.join(stage, 'DELIVERY-MANIFEST.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(),
  sourceCommit: verification.sourceCommit, sourceDigest: verification.sourceDigest, buildDigest: verification.buildDigest, workingTreeChangesIncluded: verification.dirty,
  verification: 'delivery-evidence/summary.json', scope: 'offline-demo-and-pre-cloud-delivery', cloudAcceptance: false,
  excludes: ['user data', 'runtime credentials', 'node_modules', 'temporary work files', 'historical deployment logs'], files }, null, 2));
const integrity = verifyDeliveryIntegrity(stage);
const tar = spawnSync('tar', ['--format=pax', '-czf', archive, '-C', stage, '.'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
if (tar.status !== 0) throw new Error('Could not create delivery archive; install a tar implementation with gzip support.');
const sha256 = hashFile(archive);
fs.writeFileSync(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
fs.writeFileSync(path.join(outputDir, 'latest.json'), JSON.stringify({ archive, sha256, sourceCommit: verification.sourceCommit,
  sourceDigest: verification.sourceDigest, buildDigest: verification.buildDigest, files: files.length, bytes: fs.statSync(archive).size,
  integrity: { manifestSha256: integrity.manifestSha256, files: integrity.files, bytes: integrity.bytes } }, null, 2));
// stage was created under this exact workspace in this process.
if (!stage.startsWith(workRoot + path.sep)) throw new Error('Unexpected staging directory.');
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Delivery archive: ${archive}\nSHA-256: ${sha256}\nFiles: ${files.length}. User data and runtime secrets are excluded.`);
