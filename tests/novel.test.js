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
