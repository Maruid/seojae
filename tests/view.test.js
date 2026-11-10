import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
};
const { getView, setView, setSeparate, getMeta, saveMyTheme, themeColors, cssVars, clamp } = await import('../src/lib/view.js');

test('기본값: 칼럼 나눔고딕 16 / 소설 본명조 18', () => {
  assert.equal(getView('column').font, 'nanumGothic');
  assert.equal(getView('column').fontSize, 16);
  assert.equal(getView('novel').font, 'notoSerif');
  assert.equal(getView('novel').fontSize, 18);
});

test('따로 설정 / 공통 설정 전환', () => {
  setView('column', { fontSize: 20 });
  assert.equal(getView('novel').fontSize, 18);
  setSeparate(false, 'column');
  assert.equal(getView('novel').fontSize, 20);   // 공통은 지금 화면 값으로 시작
  setView('novel', { lh: 2 });
  assert.equal(getView('column').lh, 2);
  setSeparate(true, 'column');
  assert.equal(getView('novel').fontSize, 18);   // 따로 저장돼 있던 값으로
  assert.equal(getMeta().separate, true);
});

test('내 테마 최대 3개, 중복 제거', () => {
  saveMyTheme({ bg: '#111111', fg: '#eeeeee' });
  saveMyTheme({ bg: '#222222', fg: '#eeeeee' });
  saveMyTheme({ bg: '#111111', fg: '#eeeeee' });
  saveMyTheme({ bg: '#333333', fg: '#eeeeee' });
  const l = saveMyTheme({ bg: '#444444', fg: '#eeeeee' });
  assert.equal(l.length, 3);
  assert.equal(l[0].bg, '#444444');
});

test('테마 색 · CSS 변수', () => {
  const v = { ...getView('column'), theme: null };
  assert.equal(themeColors(v, false).bg, '#FFFFFF');
  assert.equal(themeColors(v, true).bg, '#15171A');
  assert.equal(themeColors({ ...v, theme: 'sepia' }).bg, '#EAD9B8');
  const vars = cssVars({ ...v, fontSize: 17, paraGap: 0.5, lh: 1.8 }, 'X', false);
  assert.equal(vars['--r-size'], '17px');
  assert.equal(vars['--r-para'], '0.90em');
  assert.equal(clamp('fontSize', 99), 30);
});
