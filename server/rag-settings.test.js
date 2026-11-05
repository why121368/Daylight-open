import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWithRequestContext } from './request-context.js';

test('当前账号的模型与 RAG 配置独立保存，保留共享默认与其它账号配置，密钥不回显', async t => {
  const work = path.resolve('work');
  fs.mkdirSync(work, { recursive: true });
  const directory = fs.mkdtempSync(path.join(work, 'rag-settings-'));
  assert.ok(directory.startsWith(`${work}${path.sep}`));
  process.env.DAYLIGHT_DATA_DIR = directory;
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({
    activeMailboxId: 'box-a', baseUrl: 'https://shared.example.invalid/v1', model: 'shared-model', apiKey: '',
    ragEnabled: false, ragEmbeddings: false, embeddingModel: 'shared-embedding',
    mailboxes: [{ id: 'box-a', ownerUserId: 'a', email: 'a@example.invalid' },
      { id: 'box-b', ownerUserId: 'b', email: 'b@example.invalid' }],
    userPrefs: { b: { baseUrl: 'https://b.example.invalid/v1', model: 'model-b', apiKey: 'synthetic-b-key' } },
  }));
  const { readSettings, saveSettings, publicSettings } = await import(`./store.js?rag-settings=${Date.now()}`);
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
  runWithRequestContext({ userId: 'a' }, () => {
    saveSettings({ ...readSettings(), baseUrl: 'https://a.example.invalid/v1', model: 'model-a',
      apiKey: 'synthetic-a-key', ragEnabled: true, ragEmbeddings: true, embeddingModel: 'embedding-a' });
    const saved = readSettings();
    assert.equal(saved.embeddingModel, 'embedding-a');
    assert.equal(saved.ragEmbeddings, true);
    assert.equal(saved.apiKey, 'synthetic-a-key');
    assert.doesNotMatch(JSON.stringify(publicSettings(saved)), /synthetic-a-key|synthetic-b-key/);
    saveSettings({ ...saved, ragEmbeddings: false });
    assert.equal(readSettings().embeddingModel, 'embedding-a');
    assert.equal(readSettings().ragEmbeddings, false);
  });
  const final = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
  assert.deepEqual(final.userPrefs.b, original.userPrefs.b);
  assert.equal(final.embeddingModel, 'shared-embedding');
  assert.equal(final.ragEnabled, false);
  assert.equal(final.ragEmbeddings, false);
  runWithRequestContext({ userId: 'b' }, () => {
    assert.equal(readSettings().embeddingModel, 'shared-embedding');
    assert.equal(readSettings().model, 'model-b');
  });
});
