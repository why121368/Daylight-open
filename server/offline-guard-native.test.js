import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../scripts/lib/isolated-environment.mjs';

test('offline realpath native variants resolve fixture paths and still reject user data', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const code = `const fs=require('node:fs');const assert=require('node:assert/strict');
    assert.equal(typeof fs.realpathSync.native,'function');assert.equal(typeof fs.realpath.native,'function');
    assert.equal(fs.realpathSync.native('.'),fs.realpathSync('.'));
    const privatePath=require('node:path').join(process.cwd(),'data');
    for(const fn of [fs.realpathSync.native,fs.realpath.native])assert.throws(()=>fn(privatePath,()=>{}),{code:'DAYLIGHT_REGRESSION_GUARD'});
    fs.realpath.native('.',(error,result)=>{assert.ifError(error);assert.equal(result,fs.realpathSync('.'));console.log('PASS_NATIVE_REALPATH_GUARD');});`;
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'scripts/fixtures/offline-guard.cjs'), '-e', code],
    { cwd: root, env: isolatedEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS_NATIVE_REALPATH_GUARD/);
});
