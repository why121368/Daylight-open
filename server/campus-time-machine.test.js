import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLAY_MINUTES, advanceReplayMinute, busiestReplayStart, formatShanghaiDateTime, parseShanghaiDateTime, replayFrame, replayInitialState } from '../shared/campus-time-machine.js';

test('replay start time is Shanghai wall time in every host time zone and rejects invalid dates', () => {
  const value = parseShanghaiDateTime('2026-10-23T00:30');
  assert.equal(new Date(value).toISOString(), '2026-10-22T16:30:00.000Z');
  assert.equal(formatShanghaiDateTime(value), '2026-10-23T00:30');
  assert.equal(formatShanghaiDateTime(0), '1970-01-01T08:00');
  for (const invalid of ['2026-02-29T09:00', '2026-13-01T00:00', '2026-10-23T24:00', '2026-10-23T08:00Z', 'text']) assert.equal(parseShanghaiDateTime(invalid), null);
  assert.equal(parseShanghaiDateTime('2024-02-29T09:00'), Date.parse('2024-02-29T01:00:00Z'));
  assert.equal(formatShanghaiDateTime(Infinity), '');
});

test('shared replay time validates before opening and defaults to current Shanghai midnight', () => {
  const now = Date.parse('2026-10-22T17:00:00Z');
  assert.deepEqual(replayInitialState(null, now), { start: Date.parse('2026-10-22T16:00:00Z'), minute: 60, expanded: false });
  assert.equal(replayInitialState('0', now).start, 0);
  assert.equal(replayInitialState('0', now).expanded, true);
  for (const invalid of ['NaN', 'Infinity', '-1', '9e15', '9999999999999999']) assert.equal(replayInitialState(invalid, now).expanded, false);
});

const event = (id, start, end, extra = {}) => ({ id, title: id, start, end, ...extra });
test('replay frames use a separate bounded clock, active event boundaries and explicit long exhibition counts', () => {
  const start = Date.parse('2026-10-23T05:00:00+08:00');
  const events = [event('展览 A', '2026-10-22T00:00:00+08:00', '2026-10-25T00:00:00+08:00'), event('ordinary', '2026-10-23T06:00:00+08:00', '2026-10-23T07:00:00+08:00'), event('hidden', '2026-10-22T00:00:00+08:00', '2026-10-25T00:00:00+08:00', { hidden: true }), event('cancelled', '2026-10-22T00:00:00+08:00', '2026-10-25T00:00:00+08:00', { status: 'cancelled' })];
  const night = replayFrame(events, start, -10), morning = replayFrame(events, start, 60), end = replayFrame(events, start, 120);
  assert.equal(night.timestamp, start); assert.equal(night.night, true); assert.equal(morning.daylight, true); assert.equal(morning.simulated, true); assert.equal(morning.clockKind, 'playback');
  assert.equal(morning.activeEvents.length, 2); assert.equal(morning.longExhibitionCount, 1); assert.equal(end.activeEvents.length, 1);
  assert.equal(replayFrame(events, start, 1e9).timestamp, start + 48 * 3600000);
});

test('playback stops exactly at 48h, loops within bounds, and slows near visible event boundaries', () => {
  const start = Date.parse('2026-10-23T00:00:00+08:00'), base = { minute: REPLAY_MINUTES - 1, speed: 60, smart: true, loop: false, events: [], start };
  assert.deepEqual(advanceReplayMinute(base), { minute: REPLAY_MINUTES, playing: false });
  const looping = advanceReplayMinute({ ...base, loop: true }); assert.ok(looping.minute >= 0 && looping.minute < REPLAY_MINUTES); assert.equal(looping.playing, true);
  const near = { ...base, minute: 0, speed: 5, events: [event('soon', '2026-10-23T00:15:00+08:00', '2026-10-23T01:00:00+08:00')] };
  assert.equal(advanceReplayMinute(near).minute, 5);
  assert.equal(advanceReplayMinute({ ...near, events: [] }).minute, 30);
  const brief = [event('short', '2026-10-23T00:30:00+08:00', '2026-10-23T00:35:00+08:00')];
  const gap = advanceReplayMinute({ ...base, minute: 0, speed: 60, events: brief });
  assert.equal(gap.minute, 10);
  assert.equal(advanceReplayMinute({ ...base, minute: gap.minute, speed: 60, events: brief }).minute, 30);
});

test('busiest window counts overlaps at the half-open edge and excludes unpublished events', () => {
  const start = Date.parse('2026-10-23T00:00:00+08:00'), stamp = hours => new Date(start + hours * 3600000).toISOString();
  const events = [event('a', stamp(0), stamp(1)), event('b', stamp(47), stamp(49)), event('c', stamp(48), stamp(49)), event('hidden', stamp(-100), stamp(100), { hidden: true })];
  const chosen = busiestReplayStart(events);
  assert.equal(chosen, start + 1);
  assert.equal(busiestReplayStart([]), null);
});
