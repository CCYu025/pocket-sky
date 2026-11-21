import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather, knownWeatherCodes } from '../../js/domain/weathercode.js';

const DOCUMENTED = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

test('every documented WMO code has a label and icon', () => {
  for (const code of DOCUMENTED) {
    for (const isDay of [true, false]) {
      const d = describeWeather(code, isDay);
      assert.ok(d.label && d.label !== '未知', `label for ${code}`);
      assert.ok(d.icon && d.icon !== 'unknown', `icon for ${code}`);
    }
  }
  assert.deepEqual(knownWeatherCodes(), DOCUMENTED);
});

test('unknown code', () => {
  assert.deepEqual(describeWeather(1234), { label: '未知', icon: 'unknown' });
  assert.deepEqual(describeWeather(null), { label: '未知', icon: 'unknown' });
  assert.deepEqual(describeWeather(undefined), { label: '未知', icon: 'unknown' });
});

test('contract example: code 2 is 多雲', () => {
  assert.equal(describeWeather(2).label, '多雲');
});

test('night variants for 0-2 only', () => {
  for (const code of [0, 1, 2]) {
    const day = describeWeather(code, true);
    const night = describeWeather(code, false);
    assert.notEqual(night.icon, day.icon, `code ${code} night icon differs`);
    assert.match(night.icon, /night/);
    assert.equal(night.label, day.label);
  }
  for (const code of [3, 45, 61, 95]) {
    assert.deepEqual(describeWeather(code, false), describeWeather(code, true));
  }
});

test('isDay defaults to true', () => {
  assert.deepEqual(describeWeather(0), describeWeather(0, true));
});
