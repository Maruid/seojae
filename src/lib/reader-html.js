// 네이버 본문 HTML → 서재 읽기 화면용으로 정리 (브라우저 전용)
//   1) DOMPurify 로 위험 요소 제거
//   2) 제목·작성자 머리, 하단(태그·작성자 소개) 제거
//   3) 원문 글자 크기 클래스 → 본문 크기 기준 배율(em)
//   4) 인라인 스타일 제거, 글자색만 data-oc 로 보관 (테마에 맞게 보정해서 다시 칠함)
//   5) 서재에 있는 글 링크 → 서재 안 링크, 나머지는 새 창
//   6) ./images/x → Storage 서명 주소로 (화면에 가까워질 때 불러옴)
import DOMPurify from 'dompurify';
import { extractBody, rewriteHref, fsScale, imagePath } from './md.js';
import { adjustTextColor } from './color.js';

const REMOVE = [
  '.se-documentTitle', '.viewer_bottom_section', '.viewer_title_top', 'script', 'style',
  '.se-module-oglink .se-oglink-thumbnail-resource:empty', '.u_likeit_list_module', '.font_resize_wrap',
];

export function buildArticle(mdText, ctx) {
  const body = extractBody(mdText);
  const frag = DOMPurify.sanitize(body, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    ADD_ATTR: ['target'],
  });
  frag.querySelectorAll(REMOVE.join(',')).forEach((el) => el.remove());

  // 스타일: 글자색만 남김
  frag.querySelectorAll('[style]').forEach((el) => {
    const c = el.style.color;
    el.removeAttribute('style');
    if (c) el.dataset.oc = c;
  });
  frag.querySelectorAll('font[color]').forEach((el) => { el.dataset.oc = el.getAttribute('color'); el.removeAttribute('color'); });

  // 원문 글자 크기
  frag.querySelectorAll('[class*="se-fs-fs"]').forEach((el) => {
    const s = fsScale(el.className);
    if (s) el.style.fontSize = `${s}em`;
  });

  // 링크
  frag.querySelectorAll('a').forEach((a) => {
    const r = rewriteHref(a.getAttribute('href'), ctx);
    if (!r) { a.removeAttribute('href'); return; }
    a.setAttribute('href', r.href);
    if (r.internal) { a.removeAttribute('target'); a.dataset.internal = '1'; }
    else { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  });

  // 이미지
  const images = [];
  frag.querySelectorAll('img').forEach((img) => {
    const p = imagePath(img.getAttribute('src'));
    ['onerror', 'srcset', 'data-src', 'data-lazy-src'].forEach((a) => img.removeAttribute(a));
    img.removeAttribute('width'); img.removeAttribute('height');
    img.setAttribute('alt', img.getAttribute('alt') || '');
    if (p) {
      img.removeAttribute('src');
      img.dataset.path = p;
      img.classList.add('r-img-wait');
      images.push(p);
    } else if (/^https?:/i.test(img.getAttribute('src') || '')) {
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.setAttribute('loading', 'lazy');
    } else {
      img.remove();
    }
  });

  // 읽던 위치 기준이 될 문단 (원문 id: SE-xxxx)
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return { el: wrap, images };
}

// 테마에 맞춰 원문 강조색 다시 칠하기
export function paintColors(root, bg, fg) {
  root.querySelectorAll('[data-oc]').forEach((el) => {
    const c = adjustTextColor(el.dataset.oc, bg, fg);
    el.style.color = c || '';
  });
}

// 화면 근처에 온 이미지부터 서명 주소 받아서 표시
export function lazyImages(root, sign) {
  const imgs = [...root.querySelectorAll('img[data-path]')];
  if (!imgs.length) return () => {};
  const load = async (batch) => {
    try {
      const urls = await sign(batch.map((i) => i.dataset.path));
      for (const img of batch) {
        const u = urls[img.dataset.path];
        if (!u) { img.classList.add('r-img-fail'); continue; }
        img.onload = () => img.classList.remove('r-img-wait');
        img.onerror = () => img.classList.add('r-img-fail');
        img.src = u;
      }
    } catch { batch.forEach((i) => i.classList.add('r-img-fail')); }
  };
  if (!('IntersectionObserver' in window)) { load(imgs); return () => {}; }
  let queue = [];
  let t = null;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { queue.push(e.target); io.unobserve(e.target); }
    clearTimeout(t);
    t = setTimeout(() => { const b = queue; queue = []; if (b.length) load(b); }, 30);
  }, { rootMargin: '1200px 0px' });
  imgs.forEach((i) => io.observe(i));
  return () => io.disconnect();
}
