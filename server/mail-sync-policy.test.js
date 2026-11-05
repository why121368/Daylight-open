import test from 'node:test';
import assert from 'node:assert/strict';
import { mailPollIntervalSec, mailPollIntervalMs } from './mail-sync-policy.js';

test('mail polling defaults to ten minutes and preserves configured intervals', () => {
  for (const value of [undefined, null, '', 0, 'invalid']) assert.equal(mailPollIntervalSec(value), 600);
  assert.equal(mailPollIntervalSec('600'), 600);
  assert.equal(mailPollIntervalSec(60), 60);
  assert.equal(mailPollIntervalSec(1), 30);
  assert.equal(mailPollIntervalSec(9999), 3600);
  assert.equal(mailPollIntervalMs({}), 600000);
  assert.equal(mailPollIntervalMs({ syncStrategy: 'idle', pollIntervalSec: 60 }), 300000);
  assert.equal(mailPollIntervalMs({ syncStrategy: 'idle', pollIntervalSec: 600 }), 600000);
});
