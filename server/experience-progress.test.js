import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPERIENCE_VERSION } from '../shared/experience-fixtures.js';
import { EXPERIENCE_PROGRESS_KEY, experienceSearch, experienceShareUrl, experienceStart, readExperienceProgress, saveExperienceProgress } from '../shared/experience-progress.js';

const storage = value => ({ value, getItem(key) { assert.equal(key, EXPERIENCE_PROGRESS_KEY); return this.value; }, setItem(key, next) { assert.equal(key, EXPERIENCE_PROGRESS_KEY); this.value = next; } });
const saved = (step, furthest = step) => JSON.stringify({ version: EXPERIENCE_VERSION, step, furthest });

test('a returned visitor restores the selected step and completed review range', () => {
  assert.deepEqual(experienceStart('', storage(saved(3, 6))), { step: 3, furthest: 6 });
  assert.deepEqual(experienceStart('?step=2', storage(saved(3, 6))), { step: 2, furthest: 6 });
});

test('an explicit shared step works on a fresh device', () => {
  for (let step = 0; step <= 7; step++) assert.deepEqual(experienceStart(`?step=${step}`, storage(null)), { step, furthest: step });
});

test('restart at step zero resets the previous review range', () => {
  const target = storage(saved(7));
  assert.deepEqual(experienceStart('?step=0', target), { step: 0, furthest: 0 });
  assert.equal(saveExperienceProgress(target, { step: 0, furthest: 0 }), true);
  assert.deepEqual(experienceStart('', target), { step: 0, furthest: 0 });
});

test('malformed or duplicated URL steps start with bounded empty state', () => {
  for (const search of ['?step=8', '?step=-1', '?step=3.0', '?step=03', '?step=Infinity', '?step=', '?step=2&step=7', '?step=2%26step%3D7']) {
    assert.deepEqual(experienceStart(search, storage(saved(6))), { step: 0, furthest: 0 }, search);
  }
});

test('changed fixtures and corrupted session records are ignored', () => {
  for (const record of ['{', 'null', '[]', saved(8), saved(3, 2), saved('3'), JSON.stringify({ version: 'older', step: 3, furthest: 3 })]) {
    assert.deepEqual(readExperienceProgress(storage(record)), { step: 0, furthest: 0 });
  }
});

test('denied browser storage preserves shared-link navigation', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(experienceStart('?step=5', denied), { step: 5, furthest: 5 });
  assert.equal(saveExperienceProgress(denied, { step: 5, furthest: 5 }), false);
  assert.deepEqual(experienceStart('', undefined), { step: 0, furthest: 0 });
});

test('saved progress contains only the version and bounded indices', () => {
  const target = storage(null);
  assert.equal(saveExperienceProgress(target, { step: 3, furthest: 7, events: ['ignored'], token: 'ignored' }), true);
  assert.deepEqual(JSON.parse(target.value), { version: EXPERIENCE_VERSION, step: 3, furthest: 7 });
  const before = target.value;
  assert.equal(saveExperienceProgress(target, { step: 5, furthest: 2 }), false);
  assert.equal(target.value, before);
});

test('step navigation replaces ambiguous parameters while preserving other page preferences', () => {
  assert.equal(experienceSearch('?step=2&step=3&theme=dark', 4), '?step=4&theme=dark');
  assert.throws(() => experienceSearch('', 8), RangeError);
});

test('cross-device links include only the public path and current step', () => {
  assert.equal(experienceShareUrl('https://daylight.yunforis.com/private?token=discarded#fragment', 3), 'https://daylight.yunforis.com/experience?step=3');
  assert.equal(experienceShareUrl('https://discard:discard@daylight.yunforis.com', 5), 'https://daylight.yunforis.com/experience?step=5');
  assert.throws(() => experienceShareUrl('https://daylight.yunforis.com', -1), RangeError);
});
