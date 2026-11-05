/** Reproducible, isolated browser fixture with a local structured-answer model stub. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { isolatedEnvironment } from './lib/isolated-environment.mjs';
import { ragEvaluation } from './fixtures/rag-evaluation.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = fs.mkdtempSync(path.join(root, 'work', 'rag-ui-'));
const data = path.join(directory, 'data');
const guard = path.join(root, 'scripts/fixtures/offline-guard.cjs');
const env = isolatedEnvironment({ DAYLIGHT_DATA_DIR: data, DAYLIGHT_DEMO: '1', DAYLIGHT_DEMO_GUARDED: '1',
  HOST: '127.0.0.1', PORT: '3187', DAYLIGHT_REGRESSION_GUARD_LOG: path.join(directory, 'guard.jsonl') });
const seed = spawn(process.execPath, ['--require', guard, 'scripts/seed-demo.mjs'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
if ((await once(seed, 'exit'))[0] !== 0) throw new Error('UI fixture seed failed');
const model = http.createServer(async (req, res) => {
  let body = ''; for await (const bytes of req) body += bytes;
  const payload = JSON.parse(body);
  const user = JSON.parse(payload.messages.find(m => m.role === 'user').content);
  if (user.question.includes('延迟')) await new Promise(resolve => setTimeout(resolve, 9000));
  if (user.question.includes('故障')) {
    res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'synthetic-failure' } })); return;
  }
  const snippets = user.snippets;
  const claims = [
    { term: '203室', text: '星河项目报到地点是学术中心203室，时间为11月9日09:00。', quote: '星河项目报到地点为学术中心203室，时间为11月9日09:00。' },
    { term: '校园卡', text: '报到时需携带校园卡与纸质录取通知书。', quote: '星河项目报到时需携带校园卡与纸质录取通知书。' },
  ].flatMap(item => { const hit = snippets.find(s => s.text.includes(item.term)); return hit ? [{ text: item.text, evidence: [{ sourceId: user.question.includes('伪造') ? 'S99' : hit.sourceId, quote: item.quote }] }] : []; });
  fs.appendFileSync(path.join(directory, 'model-requests.jsonl'), JSON.stringify({ at: new Date().toISOString(), question: user.question, claims: claims.length })+'\n');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answerable: Boolean(claims.length), claims }) } }], usage: { prompt_tokens: 300, completion_tokens: 100 } }));
});
await new Promise(resolve => model.listen(3197, '127.0.0.1', resolve));
const settingsFile = path.join(data, 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
settings.userPrefs['demo-user'] = { ...settings.userPrefs['demo-user'], baseUrl: 'http://127.0.0.1:3197/v1', apiKey: 'synthetic-ui-key', model: 'synthetic-rag-ui', ragEmbeddings: false };
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
Object.assign(process.env, env);
const { ingestEmailKnowledge } = await import('../server/rag/mail-index.js');
const { readStore, saveStore } = await import('../server/store.js');
const store = readStore('demo-main');
for (const doc of ragEvaluation.cases.find(c => c.id === 'multi-source').documents) {
  store.emails.push({ ...doc, mode: 'demo-ui', sender: 'Project team <team@example.invalid>', receivedAt: '2026-11-04T01:00:00+08:00', category: 'notice', summary: doc.body });
  await ingestEmailKnowledge({ mailboxId: 'demo-main', email: doc, settings: { ragEnabled: true, ragEmbeddings: false } });
}
saveStore(store, 'demo-main');
const log = fs.createWriteStream(path.join(directory, 'server.txt'));
const app = spawn(process.execPath, ['--require', guard, 'server/index.js', '--production'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.pipe(log); app.stderr.pipe(log);
const stop = () => { app.kill('SIGTERM'); model.close(); setTimeout(() => process.exit(0), 1000); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('RAG_UI_FIXTURE', directory, 'http://127.0.0.1:3187/login');
await once(app, 'exit');
model.close();
