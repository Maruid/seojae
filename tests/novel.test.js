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

import { filterNovels, normalizeTag, splitList, genresOf } from '../src/lib/novelText.js';
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
  const f = filterNovels(NV, { genres: ['로맨스 판타지'] });
  assert.deepEqual(f.genres, [{ name: '로맨스 판타지', count: 2 }, { name: '판타지', count: 0 }]);
  assert.deepEqual(f.tags[0], { name: '회귀', count: 2 });
  assert.ok(!f.tags.some((t) => t.name === '헌터'));   // 지금 조건 밖의 태그는 숨김
});
test('장르 여러 개 (모두 포함)', () => {
  const M = [{ id: 'a', genres: ['무협', '판타지'], tags: [] }, { id: 'b', genres: ['무협'], tags: [] }, { id: 'c', genre: '판타지', tags: [] }];
  assert.deepEqual(genresOf(M[2]), ['판타지']);
  assert.deepEqual(filterNovels(M, { genres: ['무협'] }).list.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(filterNovels(M, { genres: ['무협', '판타지'] }).list.map((n) => n.id), ['a']);
  assert.deepEqual(filterNovels(M, { genres: ['판타지'] }).list.map((n) => n.id), ['a', 'c']);
});
test('태그 정리 · 글꼴 두께', () => {
  assert.equal(normalizeTag('  ##회귀  '), '회귀');
  assert.equal(normalizeTag('계약   결혼'), '계약결혼');
  assert.deepEqual(splitList('#회귀 #먼치킨, 성장\t현대 판타지/회귀', { tag: true }), ['회귀', '먼치킨', '성장', '현대판타지']);
  assert.deepEqual(splitList(' 무협, 현대 판타지\n로맨스/무협 '), ['무협', '현대 판타지', '로맨스']);
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

import { parseQuery, matchNovel, novelStatus, sortNovels, hasNew } from '../src/lib/novelText.js';
test('소설 검색: 여러 단어 모두 · #은 태그만', () => {
  const n = { title: '시한부 천재가 살아남는 법', author: '청시소', genres: ['퓨전무협', '성장물'], tags: ['회귀', '천재물'] };
  assert.equal(matchNovel(n, parseQuery('무협 회귀')), true);
  assert.equal(matchNovel(n, parseQuery('청시소')), true);
  assert.equal(matchNovel(n, parseQuery('시한부천재')), true);
  assert.equal(matchNovel(n, parseQuery('#무협')), false);
  assert.equal(matchNovel(n, parseQuery('#천재')), true);
  assert.equal(matchNovel(n, parseQuery('무협, 로맨스')), false);
  assert.equal(matchNovel(n, parseQuery('  ')), true);
});
test('소설 상태 · 정렬', () => {
  const n = { chapter_count: 2, last_added_at: '2026-11-02' };
  assert.equal(novelStatus(n, {}), 'unread');
  assert.equal(novelStatus(n, { n0001: { finished_at: 'x' } }), 'reading');
  assert.equal(novelStatus(n, { intro: { finished_at: 'x' }, n0001: { finished_at: 'x' }, n0002: { finished_at: 'x' } }), 'read');
  assert.equal(hasNew(n, '2026-11-01'), true);
  assert.equal(hasNew(n, null), false);
  const L = [{ id: 'a', title: '나', chapter_count: 5, last_added_at: '2026-01-01' }, { id: 'b', title: '가', chapter_count: 9, last_added_at: '2026-03-01' }, { id: 'c', title: '다', chapter_count: 1, last_added_at: '2026-02-01' }];
  const opened = { a: '2026-11-05', c: '2026-11-09' };
  assert.deepEqual(sortNovels(L, 'recent', (x) => opened[x.id]).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(sortNovels(L, 'added', () => null).map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(sortNovels(L, 'title', () => null).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortNovels(L, 'count', () => null).map((x) => x.id), ['b', 'a', 'c']);
});
