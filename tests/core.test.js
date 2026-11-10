import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, escapeHtml, trusted } from '../src/lib/dom.js';
import { match } from '../src/router.js';
import { tabsFor, activeTab, canAccess } from '../src/lib/nav.js';

test('html``: 값은 escape, 조각은 그대로', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${false}${undefined}${0}`), '0');
  assert.equal(String(html`${trusted('<b>ok</b>')}`), '<b>ok</b>');
  assert.equal(escapeHtml('a"b'), 'a&quot;b');
});

test('router: 경로와 파라미터', () => {
  assert.deepEqual(match(''), { name: 'home', params: {}, query: {} });
  assert.deepEqual(match('#/'), { name: 'home', params: {}, query: {} });
  assert.equal(match('#/c/261027193125065qu').params.id, '261027193125065qu');
  assert.deepEqual(match('#/n/nv-6f6d00f9/n0428').params, { id: 'nv-6f6d00f9', key: 'n0428' });
  assert.equal(match('#/columns?cat=%ED%88%AC%EC%9E%90').query.cat, '투자');
  assert.equal(match('#/nope/x/y/z').name, 'notfound');
});

const S = { columns: { key: 'columns', name: '칼럼', kind: 'column' }, novels: { key: 'novels', name: '소설', kind: 'novel' } };
const keys = (me) => tabsFor(me).map((t) => t.key);

test('탭: 권한별 구성', () => {
  assert.deepEqual(keys({ sectors: [S.columns] }), ['home', 'columns', 'me']);
  assert.deepEqual(keys({ sectors: [S.novels] }), ['home', 'novels', 'me']);
  assert.deepEqual(keys({ sectors: [S.columns, S.novels] }), ['home', 'columns', 'novels', 'me']);
  assert.deepEqual(keys({ sectors: [S.columns, S.novels], is_admin: true }), ['home', 'columns', 'novels', 'me', 'admin']);
  assert.deepEqual(keys({ sectors: [] }), ['home', 'me']);
});

test('탭: 활성 탭과 접근 권한', () => {
  const tabs = tabsFor({ sectors: [S.columns, S.novels] });
  assert.equal(activeTab(tabs, 'column'), 'columns');
  assert.equal(activeTab(tabs, 'chapter'), 'novels');
  assert.equal(activeTab(tabs, 'install'), 'me');
  assert.equal(canAccess({ sectors: [S.columns] }, 'novel'), false);
  assert.equal(canAccess({ sectors: [S.columns] }, 'column'), true);
});
