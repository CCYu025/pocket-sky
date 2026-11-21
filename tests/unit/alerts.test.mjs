import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_RULES, evaluateAlerts, pickAlert } from '../../js/rules/alerts.js';

const NOW = Date.UTC(2026, 10, 21, 6, 20); // arbitrary fixed instant
const H = 3600e3;

/** Build a valid 24-hour view model; `rain`/`temp` map hour offset -> value. */
function makeVm({ rain = {}, temp = {}, hoursAvailable = true } = {}) {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hourKey: `2026-11-21T${String((14 + i) % 24).padStart(2, '0')}:00`,
    hour: (14 + i) % 24,
    temp: i in temp ? temp[i] : 20,
    rainProb: i in rain ? rain[i] : 10,
  }));
  return {
    hoursAvailable,
    now: { hourKey: '2026-11-21T14:00' },
    hours: hoursAvailable ? hours : [],
  };
}

const ev = (vm, o = {}) => evaluateAlerts(vm, { nowMs: NOW, ...o });

test('rules constants', () => {
  assert.equal(ALERT_RULES.cooldownHours, 3);
});

test('rainJump boundaries: current 30 triggers, 31 does not', () => {
  assert.equal(ev(makeVm({ rain: { 0: 30, 2: 70 } })).length, 1);
  assert.equal(ev(makeVm({ rain: { 0: 31, 2: 70 } })).length, 0);
});

test('rainJump boundaries: future 60 triggers, 59 does not', () => {
  assert.equal(ev(makeVm({ rain: { 2: 60 } }))[0].kind, 'rainJump');
  assert.equal(ev(makeVm({ rain: { 2: 59 } })).length, 0);
});

test('rainJump uses first qualifying hour and formats text', () => {
  const [a] = ev(makeVm({ rain: { 2: 65, 3: 90 } }));
  assert.equal(a.startsAt, '2026-11-21T16:00');
  assert.equal(a.title, '16:00 起可能下雨');
  assert.equal(a.detail, '降雨機率 65%');
  assert.equal(a.id, 'rainJump:2026-11-21T16:00');
  assert.equal(a.priority, 2);
});

test('rainJump window: 3 hours ahead counts, 4 hours ahead does not', () => {
  assert.equal(ev(makeVm({ rain: { 3: 90 } })).length, 1);
  assert.equal(ev(makeVm({ rain: { 4: 90 } })).length, 0);
});

test('rainJump ignores null rainProb', () => {
  assert.equal(ev(makeVm({ rain: { 0: null, 2: 90 } })).length, 0);
  assert.equal(ev(makeVm({ rain: { 1: null, 2: null } })).length, 0);
  assert.equal(ev(makeVm({ rain: { 1: null, 2: 80 } })).length, 1);
});

test('tempDrop: exactly 4 triggers, 3.9 does not', () => {
  assert.equal(ev(makeVm({ temp: { 2: 16 } }))[0].kind, 'tempDrop');
  assert.equal(ev(makeVm({ temp: { 2: 16.1 } })).length, 0);
});

test('tempDrop reports min hour, rounded numbers', () => {
  const [a] = ev(makeVm({ temp: { 1: 17.4, 3: 14.6 } }));
  assert.equal(a.startsAt, '2026-11-21T17:00');
  assert.equal(a.title, '氣溫將下降 5°');
  assert.equal(a.detail, '17:00 降至 15°');
  assert.equal(a.priority, 1);
  assert.equal(a.id, 'tempDrop:2026-11-21T17:00');
});

test('tempDrop ignores nulls and window limit', () => {
  assert.equal(ev(makeVm({ temp: { 0: null, 2: 10 } })).length, 0);
  assert.equal(ev(makeVm({ temp: { 1: null, 2: null } })).length, 0);
  assert.equal(ev(makeVm({ temp: { 4: 5 } })).length, 0);
});

test('both present sorted by priority; pickAlert', () => {
  const list = ev(makeVm({ rain: { 1: 80 }, temp: { 2: 10 } }));
  assert.deepEqual(list.map((a) => a.kind), ['rainJump', 'tempDrop']);
  assert.equal(pickAlert(list).kind, 'rainJump');
  assert.equal(pickAlert([]), null);
});

test('dismissed id suppresses only that alert', () => {
  const vm = makeVm({ rain: { 1: 80 }, temp: { 2: 10 } });
  const list = ev(vm, { dismissed: { 'rainJump:2026-11-21T15:00': true } });
  assert.deepEqual(list.map((a) => a.kind), ['tempDrop']);
});

test('cooldown suppresses different-id alert of same kind, allows after 3 h', () => {
  const vm = makeVm({ rain: { 1: 80 } });
  const other = { rainJump: 'rainJump:2026-11-21T10:00' };
  assert.equal(ev(vm, { lastShown: { rainJump: NOW - 2 * H }, lastShownId: other }).length, 0);
  assert.equal(ev(vm, { lastShown: { rainJump: NOW - 2 * H } }).length, 0);
  assert.equal(ev(vm, { lastShown: { rainJump: NOW - 3 * H }, lastShownId: other }).length, 1);
  assert.equal(ev(vm, { lastShown: { rainJump: NOW - 4 * H }, lastShownId: other }).length, 1);
});

test('cooldown is per kind', () => {
  const vm = makeVm({ rain: { 1: 80 }, temp: { 2: 10 } });
  const list = ev(vm, { lastShown: { rainJump: NOW - H } });
  assert.deepEqual(list.map((a) => a.kind), ['tempDrop']);
});

test('same id within cooldown is still shown', () => {
  const vm = makeVm({ rain: { 1: 80 } });
  const list = ev(vm, {
    lastShown: { rainJump: NOW - H },
    lastShownId: { rainJump: 'rainJump:2026-11-21T15:00' },
  });
  assert.equal(list.length, 1);
});

test('hoursAvailable false or null vm gives []', () => {
  assert.deepEqual(ev(makeVm({ hoursAvailable: false })), []);
  assert.deepEqual(ev(null), []);
});

test('id is per event: kind + startsAt, so a later event of the same kind gets a new id', () => {
  const [a] = ev(makeVm({ rain: { 1: 80 } }));
  const [b] = ev(makeVm({ rain: { 3: 80 } }));
  assert.equal(a.id, 'rainJump:2026-11-21T15:00');
  assert.equal(b.id, 'rainJump:2026-11-21T17:00');
  assert.notEqual(a.id, b.id);
});

test('dismissing one event does not hide a different event of the same kind', () => {
  const dismissed = { 'rainJump:2026-11-21T15:00': true };
  assert.equal(ev(makeVm({ rain: { 1: 80 } }), { dismissed }).length, 0);
  assert.equal(ev(makeVm({ rain: { 3: 80 } }), { dismissed }).length, 1);
});

test('cooldown applies between different events of a kind; the same event is exempt', () => {
  const shown = { lastShown: { rainJump: NOW - H }, lastShownId: { rainJump: 'rainJump:2026-11-21T15:00' } };
  assert.equal(ev(makeVm({ rain: { 1: 80 } }), shown).length, 1, 're-render of the same event');
  assert.equal(ev(makeVm({ rain: { 3: 80 } }), shown).length, 0, 'new event inside cooldown');
  const later = { lastShown: { rainJump: NOW - 3 * H }, lastShownId: shown.lastShownId };
  assert.equal(ev(makeVm({ rain: { 3: 80 } }), later).length, 1, 'new event after cooldown');
});
