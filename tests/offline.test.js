import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, chapterBytes, presetKeys, fitSelection, diffChapters, resplitRange, roomOf, isLockedAt, MB } from '../src/lib/offline/plan.js';

const chs = Array.from({ length: 10 }, (_, i) => ({ key: `n${String(i + 1).padStart(4, '0')}`, char_count: 1000 }));
const K = (i) => chs[i - 1].key;

test('용량 표시', () => {
  assert.equal(fmtBytes(0), '0KB');
  assert.equal(fmtBytes(15000), '15KB');
  assert.equal(fmtBytes(2.1 * MB), '2.1MB');
  assert.equal(fmtBytes(412 * MB), '412MB');
  assert.equal(fmtBytes(3 * 1024 * MB), '3.0GB');
});

test('회차 크기: 기록 우선, 없으면 글자 수 × 3', () => {
  assert.deepEqual(chapterBytes({ size_bytes: 1234 }), { bytes: 1234, exact: true });
  assert.equal(chapterBytes({ char_count: 1000 }).exact, false);
  assert.equal(chapterBytes({ char_count: 1000 }).bytes, 3200);
});

test('추천: 안 읽은 회차부터 · 다음 N화 · 전체, 받은 건 빼고 바뀐 건 넣음', () => {
  const have = new Set([K(4), K(5)]);
  const changed = new Set([K(2)]);
  const read = new Set([K(1), K(2), K(3)]);
  assert.deepEqual([...presetKeys({ chapters: chs, start: 3, have, changed, read, mode: 'unread' })], [K(2), K(6), K(7), K(8), K(9), K(10)]);
  assert.deepEqual([...presetKeys({ chapters: chs, start: 3, have, changed, read, mode: 'next', n: 3 })], [K(2), K(6)]);
  assert.deepEqual([...presetKeys({ chapters: chs, start: 3, have, changed, read, mode: 'all' })].length, 6);
  assert.equal(presetKeys({ chapters: chs, start: 3, have, changed, read, mode: 'all', skipRead: false }).size, 8);
});

test('용량 맞추기', () => {
  const g = (id, star, sizes) => ({ id, star, items: sizes.map((b, i) => ({ key: `${id}${i}`, bytes: b, zero: b === 0 })) });
  const groups = [g('a', false, [50, 50, 50]), g('b', true, [10, 10]), g('c', false, [0, 300])];
  const sel = new Map(groups.map((x) => [x.id, new Set(x.items.map((it) => it.key))]));
  const keys = (m) => Object.fromEntries([...m].map(([k, v]) => [k, [...v]]));
  // 전부 들어가는 것만: a(150) 들어가고 b(20) 들어가고 c 는 300 이라 빠지지만 0바이트는 남음
  assert.deepEqual(keys(fitSelection(groups, sel, 200, 'whole')), { a: ['a0', 'a1', 'a2'], b: ['b0', 'b1'], c: ['c0'] });
  // ★ 먼저: b 전부, 그다음 a 를 순서대로 남은 만큼
  assert.deepEqual(keys(fitSelection(groups, sel, 120, 'star')), { a: ['a0', 'a1'], b: ['b0', 'b1'], c: ['c0'] });
  // 골고루: a0, b0, a1, b1 …
  assert.deepEqual(keys(fitSelection(groups, sel, 125, 'even')), { a: ['a0', 'a1'], b: ['b0', 'b1'], c: ['c0'] });
});

test('서버와 비교: 새 · 바뀜 · 사라짐 · 다시 나뉨', () => {
  const server = [{ key: 'a', content_hash: '1' }, { key: 'b', content_hash: 'X' }, { key: 'd', content_hash: '4' }];
  const saved = new Map([['a', { hash: '1' }], ['b', { hash: '2' }], ['c', { hash: '3' }]]);
  const d = diffChapters(server, saved, new Set(['a', 'b', 'c']));
  assert.deepEqual(d, { fresh: ['d'], changed: ['b'], gone: ['c'], resplit: false });
  const many = new Map(['a', 'b', 'c', 'e', 'f'].map((k) => [k, { hash: 'old' }]));
  assert.equal(diffChapters(server, many, null).resplit, true);
});

test('다시 나뉜 범위는 비율로', () => {
  const server = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}` }));
  const keys = resplitRange({ oldTotal: 100, oldIdx: [10, 11, 12, 19] }, server);
  assert.equal(keys[0], 'k20');
  assert.equal(keys.at(-1), 'k39');
});

test('남은 한도 · 30일 잠금', () => {
  assert.equal(roomOf({ unlimited: true }), Infinity);
  assert.equal(roomOf({ limit: 100, used: 30 }), 70);
  assert.equal(roomOf({ limit: 100, used: 130 }), 0);
  const now = Date.UTC(2026, 10, 14);
  assert.equal(isLockedAt(now - 29 * 864e5, now), false);
  assert.equal(isLockedAt(now - 31 * 864e5, now), true);
  assert.equal(isLockedAt(null, now), false);
});
