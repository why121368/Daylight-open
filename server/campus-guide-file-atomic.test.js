import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGuideRepository, ACTIVITY_KEY } from './campus-guide/repository.js';

async function fixture() {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/campus-file-atomic-'));
  const repository = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false });
  await repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ id: 'retained', message: '合成旧记录' }); });
  const files = await fs.readdir(path.join(directory, 'campus-guide'));
  return { repository, directory: path.join(directory, 'campus-guide'), filename: path.join(directory, 'campus-guide', files[0]) };
}

test('校园本地原子替换：Windows瞬态占用重试同一临时文件，成功前完整旧文件始终可读', { skip: process.platform !== 'win32' }, async t => {
  const { repository, filename, directory } = await fixture(), original = await fs.readFile(filename, 'utf8'), rename = fs.rename;
  let attempts = 0, temporaryPath;
  t.mock.method(fs, 'rename', async (temporary, target) => {
    assert.equal(target, filename); attempts++;
    temporaryPath ||= temporary; assert.equal(temporary, temporaryPath);
    assert.equal(await fs.readFile(filename, 'utf8'), original);
    const staged = JSON.parse(await fs.readFile(temporary, 'utf8')); assert.equal(staged.version, 2); assert.equal(staged.payload.feedback.length, 2);
    if (attempts <= 3) throw Object.assign(Error('synthetic transient file sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][attempts - 1] });
    return rename(temporary, target);
  });
  const result = await repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ id: 'added', message: '合成新记录' }); });
  assert.equal(attempts, 4); assert.equal(result.version, 2); assert.equal((await repository.read(ACTIVITY_KEY)).payload.feedback.length, 2); assert.deepEqual(await fs.readdir(directory), [path.basename(filename)]);
});

test('校园本地原子替换：永久占用有界失败并清理临时文件，完整旧数据保留且可再次提交', async t => {
  const { repository, filename, directory } = await fixture(), original = await fs.readFile(filename, 'utf8'), rename = fs.rename;
  let attempts = 0, temporaryPath;
  const mocked = t.mock.method(fs, 'rename', async (temporary, target) => {
    attempts++; temporaryPath ||= temporary; assert.equal(temporary, temporaryPath); assert.equal(target, filename); assert.equal(await fs.readFile(filename, 'utf8'), original); assert.ok((await fs.stat(temporary)).isFile());
    throw Object.assign(Error('synthetic persistent file lock'), { code: 'EACCES' });
  });
  await assert.rejects(repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ id: 'not-saved' }); }), error => error.code === 'EACCES');
  assert.equal(attempts, process.platform === 'win32' ? 6 : 1); assert.equal(await fs.readFile(filename, 'utf8'), original); assert.deepEqual(await fs.readdir(directory), [path.basename(filename)]);
  mocked.mock.restore();
  await repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ id: 'retry-saved' }); });
  const saved = await repository.read(ACTIVITY_KEY); assert.equal(saved.version, 2); assert.deepEqual(saved.payload.feedback.map(row => row.id), ['retained', 'retry-saved']); assert.equal(fs.rename, rename);
});

test('校园本地原子替换：非占用类错误不重试也不删除当前文件', async t => {
  const { repository, filename, directory } = await fixture(), original = await fs.readFile(filename, 'utf8');
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => { attempts++; throw Object.assign(Error('synthetic disk failure'), { code: 'ENOSPC' }); });
  await assert.rejects(repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ id: 'not-saved' }); }), error => error.code === 'ENOSPC');
  assert.equal(attempts, 1); assert.equal(await fs.readFile(filename, 'utf8'), original); assert.deepEqual(await fs.readdir(directory), [path.basename(filename)]);
});
