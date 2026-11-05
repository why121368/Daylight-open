import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { configureProxyTrust } from './proxy-trust.js';

test('代理信任默认关闭，明确代理地址以外的客户端不能提供转发身份', () => {
  const app = express();
  assert.deepEqual(configureProxyTrust(app, ''), []);
  assert.equal(app.get('trust proxy'), false);
  configureProxyTrust(app, '172.30.255.2/32,2001:db8::1/128');
  const trust = app.get('trust proxy fn');
  assert.equal(trust('172.30.255.2'), true);
  assert.equal(trust('172.30.255.3'), false);
  assert.equal(trust('127.0.0.1'), false);
  assert.equal(trust('2001:db8::1'), true);
});

test('代理配置拒绝任意来源信任、跳数、无效网段与空项目', () => {
  for (const value of ['true', '1', '*', '0.0.0.0/0', '::/0', '172.30.255.2/33', '::1/129', '127.0.0.1,', 'proxy.local', '127.0.0.1/24/1']) {
    assert.throws(() => configureProxyTrust(express(), value), /DAYLIGHT_TRUST_PROXY/);
  }
});
