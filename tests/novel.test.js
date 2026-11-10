import test from 'node:test';
import assert from 'node:assert/strict';
import { splitParagraphs, continueTarget, lastOpened, chapterLabel } from '../src/lib/novelText.js';

test('빈 줄 없이 쓴 소설: 빈 줄은 빈 칸으로, 줄 번호 유지', () => {
  const p = splitParagraphs('\n1\n2\n\n4\n5\n6\n7\n8\n9\n\n\n12\n13\n\n');
  assert.deepEqual(p.filter((x) => !x.gap).map((x) => x.line), [2, 3, 5, 6, 7, 8, 9, 10, 13, 14]);
  assert.equal(p.filter((x) => x.gap).length, 3);
  assert.equal(p.find((x) => x.line === 13).text, '12');
});

test('문단마다 빈 줄을 넣은 소설: 빈 줄 1개는 없애고 2개 이상만 빈 칸', () => {
  const t = ['가', '', '나', '', '다', '', '', '', '라', '', '마'].join('\r\n');
  const p = splitParagraphs(t);
  assert.deepEqual(p.map((x) => (x.gap ? '|' : x.text)).join(''), '가나다|라마');
  assert.equal(p.find((x) => x.text === '라').line, 9);
});

const ch = [{ key: 'intro' }, { key: 'n0001', display_title: '1화' }, { key: 'n0002', title: '[작품] 2화' }, { key: 'n0003' }];
test('이어 읽기 대상', () => {
  assert.equal(continueTarget(ch, {}).chapter.key, 'intro');
  assert.equal(continueTarget(ch, { n0001: { updated_at: '2026-01-01', finished_at: '2026-01-01' } }).chapter.key, 'n0002');
  const t = continueTarget(ch, {
    n0001: { updated_at: '2026-01-01', finished_at: '2026-01-01' },
    n0002: { updated_at: '2026-01-03', progress: 0.4 },
  });
  assert.equal(t.chapter.key, 'n0002');
  assert.equal(t.fresh, false);
  assert.equal(continueTarget(ch, { n0003: { updated_at: '1', finished_at: '1' } }).chapter.key, 'n0003');   // 마지막 회차
  assert.equal(lastOpened({ a: { updated_at: '2026-01-01' }, b: { updated_at: '2026-02-01' } }), '2026-02-01');
  assert.equal(chapterLabel(ch[2]), '[작품] 2화');
});

import { filterNovels, normalizeTag } from '../src/lib/novelText.js';
import { resolveWeight } from '../src/lib/fonts.js';

const NV = [
  { id: 'a', genre: '로맨스 판타지', tags: ['회귀', '아카데미'] },
  { id: 'b', genre: '로맨스 판타지', tags: ['회귀', '계약결혼'] },
  { id: 'c', genre: '판타지', tags: ['회귀', '헌터'] },
  { id: 'd', genre: null, tags: [] },
];
test('장르 하나 + 태그 모두 포함(AND)', () => {
  assert.deepEqual(filterNovels(NV).list.map((n) => n.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterNovels(NV, { genre: '로맨스 판타지' }).list.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(filterNovels(NV, { tags: ['회귀'] }).list.map((n) => n.id), ['a', 'b', 'c']);
  assert.deepEqual(filterNovels(NV, { tags: ['회귀', '아카데미'] }).list.map((n) => n.id), ['a']);
  const f = filterNovels(NV, { genre: '로맨스 판타지' });
  assert.deepEqual(f.genres, [{ name: '로맨스 판타지', count: 2 }, { name: '판타지', count: 1 }]);
  assert.deepEqual(f.tags[0], { name: '회귀', count: 2 });
  assert.ok(!f.tags.some((t) => t.name === '헌터'));   // 지금 조건 밖의 태그는 숨김
});
test('태그 정리 · 글꼴 두께', () => {
  assert.equal(normalizeTag('  ##회귀  '), '회귀');
  assert.equal(normalizeTag('계약   결혼'), '계약 결혼');
  assert.equal(resolveWeight('notoSerif', 'thin'), 300);
  assert.equal(resolveWeight('nanumGothic', 'thin'), null);
  assert.equal(resolveWeight('nanumGothic', 'bold'), 700);
  assert.equal(resolveWeight('notoSerif', 'bold'), 600);
  assert.equal(resolveWeight('gowunDodum', 'bold'), null);
});

import { chapterNo, chapterRest, chapterNoLabel, chapterTotal, findChapterByNo } from '../src/lib/novelText.js';
test('회차 번호: 제목 번호 우선, 없으면 순서, 프롤로그 제외', () => {
  const list = [
    { key: 'intro', seq: 0, display_title: '프롤로그' },
    { key: 'n0001', seq: 1, display_title: '1화. 이게 뭐가 (1)' },
    { key: 'n0003', seq: 2, display_title: '3화' },
    { key: 'x0001', seq: 3, display_title: '후기' },
  ];
  assert.deepEqual(list.map(chapterNo), [null, 1, 3, null]);
  assert.equal(chapterRest(list[1]), '이게 뭐가 (1)');
  assert.equal(chapterRest(list[2]), '');
  assert.equal(chapterNoLabel(list[0]), '프롤로그');
  assert.equal(chapterNoLabel(list[3]), '');
  assert.equal(chapterTotal(list), 3);
  assert.equal(findChapterByNo(list, 3).exact.key, 'n0003');
  assert.equal(findChapterByNo(list, 2).near.key, 'n0001');
  const seq = [{ key: 'intro', seq: 0 }, { key: 's0001', seq: 1, display_title: '돌아왔다(1)' }, { key: 'p0002', seq: 2, display_title: '2편 · 그날 아침…' }];
  assert.deepEqual(seq.map(chapterNo), [null, 1, 2]);
  assert.equal(chapterRest(seq[1]), '돌아왔다(1)');
  assert.equal(chapterRest(seq[2]), '그날 아침…');
});
