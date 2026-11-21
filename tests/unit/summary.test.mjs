import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headline } from '../../js/domain/summary.js';

/** Valid 24-hour view model with quiet defaults. */
function makeVm(o = {}) {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hourKey: `2026-11-21T${String((14 + i) % 24).padStart(2, '0')}:00`,
    hour: (14 + i) % 24,
    temp: 20,
    rainProb: (o.rain && o.rain[i]) ?? 10,
  }));
  return {
    hoursAvailable: true,
    now: { hourKey: '2026-11-21T14:00', label: '晴朗' },
    today: { max: 26.4, min: 18.6 },
    yesterdayDelta: 0,
    hours,
    ...o.over,
  };
}

test('branch 1: alert text for both kinds', () => {
  const vm = makeVm();
  assert.equal(
    headline(vm, { kind: 'rainJump', startsAt: '2026-11-21T15:00', title: '15:00 起可能下雨' }),
    '15 時起可能下雨，記得帶傘',
  );
  assert.equal(
    headline(vm, { kind: 'tempDrop', startsAt: '2026-11-21T16:00', title: '氣溫將下降 5°', value: 5 }),
    '氣溫將下降 5°，加件外套',
  );
  // value missing: falls back to the title's number
  assert.equal(
    headline(vm, { kind: 'tempDrop', startsAt: '2026-11-21T16:00', title: '氣溫將下降 6°' }),
    '氣溫將下降 6°，加件外套',
  );
});

test('alert beats rain, delta and condition', () => {
  const vm = makeVm({ rain: { 1: 90 }, over: { yesterdayDelta: -8 } });
  assert.equal(
    headline(vm, { kind: 'tempDrop', startsAt: '2026-11-21T16:00', title: 'x', value: 4 }),
    '氣溫將下降 4°，加件外套',
  );
});

test('branch 2: rain within next 6 hours (>= 40)', () => {
  assert.equal(headline(makeVm({ rain: { 4: 40 } })), '18 時可能下雨，記得帶傘');
  assert.equal(headline(makeVm({ rain: { 4: 39 } })), '今天晴朗，26° / 19°');
  assert.equal(headline(makeVm({ rain: { 6: 50 } })), '20 時可能下雨，記得帶傘');
  assert.equal(headline(makeVm({ rain: { 7: 90 } })), '今天晴朗，26° / 19°');
});

test('branch 3: yesterday delta, with rounding', () => {
  assert.equal(headline(makeVm({ over: { yesterdayDelta: -3.6 } })), '比昨天冷 4°，加件外套');
  assert.equal(headline(makeVm({ over: { yesterdayDelta: 4 } })), '比昨天熱 4°，注意補水');
  assert.equal(headline(makeVm({ over: { yesterdayDelta: -3.9 } })), '比昨天冷 4°，加件外套');
  assert.equal(headline(makeVm({ over: { yesterdayDelta: 3.9 } })), '比昨天熱 4°，注意補水');
  assert.equal(headline(makeVm({ over: { yesterdayDelta: 3.4 } })), '今天晴朗，26° / 19°');
});

test('branch 4: condition with max/min, omitted when null', () => {
  assert.equal(headline(makeVm()), '今天晴朗，26° / 19°');
  assert.equal(headline(makeVm({ over: { today: { max: null, min: 10 } } })), '今天晴朗');
  assert.equal(headline(makeVm({ over: { today: { max: null, min: null } } })), '今天晴朗');
  assert.equal(headline(makeVm({ over: { yesterdayDelta: null } })), '今天晴朗，26° / 19°');
});

test('branch 5: unavailable data', () => {
  assert.equal(headline(null, null), '資料暫時無法取得');
  assert.equal(headline(undefined), '資料暫時無法取得');
  assert.equal(headline(makeVm({ over: { hoursAvailable: false } })), '資料暫時無法取得');
  assert.equal(
    headline(makeVm({ over: { hoursAvailable: false } }), { kind: 'rainJump', startsAt: '2026-11-21T15:00', title: '' }),
    '資料暫時無法取得',
  );
});
