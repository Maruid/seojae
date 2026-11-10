// 칼럼 .md 파일 다루기 (순수 함수: 브라우저·테스트 공용)
//   파일 구조: --- 머리말 --- / # 제목 / 정보 목록 / --- / <div ...> 네이버 본문 HTML

export function parseFrontmatter(text) {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, rest: t };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    meta[mm[1]] = v;
  }
  return { meta, rest: t.slice(m[0].length) };
}

// 본문 HTML 부분만: 머리말 뒤, 첫 HTML 태그 줄부터
export function extractBody(text) {
  const { rest } = parseFrontmatter(text);
  const lines = rest.split('\n');
  const i = lines.findIndex((l) => /^\s*</.test(l));
  return i < 0 ? '' : lines.slice(i).join('\n');
}

// 네이버 콘텐츠 주소에서 글 id
const CONTENT_RE = /^https?:\/\/(?:m\.)?contents\.premium\.naver\.com\/[^/]+\/[^/]+\/contents\/([0-9A-Za-z]+)/;
export function contentIdOf(url) {
  const m = String(url || '').match(CONTENT_RE);
  return m ? m[1] : null;
}

/**
 * 본문 링크를 서재 안 링크로 바꿀지 결정
 *   ctx.known: 서재에 있는 칼럼 id Set
 *   ctx.links: { 'https://naver.me/xx': '실제 주소' } (업로드 때 펼쳐 둔 것)
 * 반환: { href, internal }
 */
export function rewriteHref(href, ctx = {}) {
  if (!href) return null;
  let h = href.trim();
  if (/^javascript:/i.test(h) || h === '#') return null;
  if (h.startsWith('/')) h = 'https://contents.premium.naver.com' + h;
  const real = ctx.links?.[h] || h;
  const id = contentIdOf(real);
  if (id && ctx.known?.has(id)) return { href: `#/c/${encodeURIComponent(id)}`, internal: true };
  if (!/^https?:\/\//i.test(real) && !/^mailto:/i.test(real)) return null;
  return { href: real, internal: false };
}

// 네이버 글자 크기 클래스 → 본문 크기 대비 배율 (기준 se-fs- = 15px = 본문 크기)
const FS = { 11: 0.75, 13: 0.875, 15: 1, 16: 1, 19: 1.25, 24: 1.5, 28: 1.75, 30: 1.875, 34: 2, 38: 2.2 };
export function fsScale(className) {
  const m = String(className || '').match(/se-fs-fs(\d+)/);
  if (!m) return null;
  const n = +m[1];
  if (FS[n]) return FS[n] === 1 ? null : FS[n];
  return Math.round((n / 16) * 100) / 100;
}

// 이미지 상대 경로 → Storage 경로
export function imagePath(src) {
  const m = String(src || '').match(/^(?:\.\/)?images\/([^?#]+)$/);
  return m ? `columns/images/${decodeURIComponent(m[1])}` : null;
}
