import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, extractBody, contentIdOf, rewriteHref, fsScale, imagePath } from '../src/lib/md.js';
import { contrast, adjustTextColor, mix } from '../src/lib/color.js';

const MD = `---\r\ncategory: "투자 전략"\r\ntitle: "3가지 \\"토큰\\""\r\nsource_url: "https://contents.premium.naver.com/assetx2/assetsx2/contents/261027193125065qu"\r\n---\r\n\r\n# 제목\r\n\r\n- **대구분**: 투자 전략\r\n\r\n---\r\n\r\n<div class="se_viewer_content">\r\n<p id="SE-1">본문</p>\r\n</div>\r\n`;

test('머리말 파싱 (JSON 이스케이프 포함)', () => {
  const { meta } = parseFrontmatter(MD);
  assert.equal(meta.category, '투자 전략');
  assert.equal(meta.title, '3가지 "토큰"');
});

test('본문 HTML 만 추출', () => {
  const b = extractBody(MD);
  assert.ok(b.startsWith('<div class="se_viewer_content">'));
  assert.ok(!b.includes('대구분'));
});

test('링크 바꾸기: 서재에 있는 글은 내부 링크', () => {
  const known = new Set(['261027193125065qu']);
  const links = { 'https://naver.me/F7F7s8wz': 'https://contents.premium.naver.com/assetx2/assetsx2/contents/261027193125065qu?from=x' };
  assert.equal(contentIdOf('https://contents.premium.naver.com/a/b/contents/261027193125065qu'), '261027193125065qu');
  assert.deepEqual(rewriteHref('https://naver.me/F7F7s8wz', { known, links }), { href: '#/c/261027193125065qu', internal: true });
  assert.deepEqual(rewriteHref('/assetx2/assetsx2/contents/261027193125065qu', { known }), { href: '#/c/261027193125065qu', internal: true });
  assert.deepEqual(rewriteHref('https://contents.premium.naver.com/a/b/contents/999', { known }), { href: 'https://contents.premium.naver.com/a/b/contents/999', internal: false });
  assert.equal(rewriteHref('javascript:alert(1)', { known }), null);
  assert.equal(rewriteHref('#', {}), null);
});

test('글자 크기 클래스 배율', () => {
  assert.equal(fsScale('se-fs- se-ff-'), null);
  assert.equal(fsScale('se-fs-fs16'), null);
  assert.equal(fsScale('se-fs-fs19 se-ff-'), 1.25);
  assert.equal(fsScale('se-fs-fs13'), 0.875);
  assert.equal(fsScale('se-fs-fs24'), 1.5);
});

test('이미지 경로', () => {
  assert.equal(imagePath('./images/img_1.png'), 'columns/images/img_1.png');
  assert.equal(imagePath('images/a%20b.jpg'), 'columns/images/a b.jpg');
  assert.equal(imagePath('https://x/y.png'), null);
});

test('원문 글자색 보정', () => {
  assert.equal(adjustTextColor('#999999', '#FFFFFF', '#1B1D21'), null);       // 회색 → 테마 글자색
  assert.equal(adjustTextColor('rgb(0,0,0)', '#15171A', '#D9D6CF'), null);
  assert.equal(adjustTextColor('#ff0010', '#FFFFFF', '#1B1D21'), '#ff0010');  // 잘 보이면 그대로
  const dark = adjustTextColor('#0b1f8f', '#000000', '#BDBDBD');            // 검정 배경의 진한 파랑
  assert.ok(contrast(dark, '#000000') >= 3, dark);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});
