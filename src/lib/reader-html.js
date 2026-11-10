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

// 영상 삽입(se-oembed)은 iframe 이라 정리 과정에서 빠짐 → 정리 전에 모듈 데이터(주소·제목)를 읽어 둠
function readEmbeds(body) {
  const out = {};
  if (!body.includes('oembed')) return out;
  const doc = new DOMParser().parseFromString(body, 'text/html');   // 실행·로딩 없는 문서
  doc.querySelectorAll('script.__se_module_data').forEach((sc) => {
    try {
      const m = JSON.parse(sc.getAttribute('data-module-v2') || sc.getAttribute('data-module') || '{}');
      if (!/oembed/.test(m.type || '')) return;
      const d = m.data || {};
      const src = (String(d.html || '').match(/src=["']([^"']+)/) || [])[1];
      out[m.id] = {
        url: d.inputUrl || d.url || src || '',
        title: d.title || '',
        provider: d.providerName || '',
        thumb: d.thumbnailUrl || '',
      };
    } catch {}
  });
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function buildArticle(mdText, ctx) {
  const body = extractBody(mdText);
  const embeds = readEmbeds(body);
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

  // 링크 카드(se-oglink): 주소 표시 정리 (naver.me → 실제 사이트 / 서재 글이면 "서재에서 읽기")
  frag.querySelectorAll('.se-module-oglink').forEach((mod) => {
    const info = mod.querySelector('a.se-oglink-info');
    const urlEl = mod.querySelector('.se-oglink-url');
    if (!mod.querySelector('.se-oglink-thumbnail img')) mod.classList.add('r-og-noimg');
    if (!info || !urlEl) return;
    if (info.dataset.internal) { urlEl.textContent = '서재에서 읽기'; mod.classList.add('r-og-internal'); }
    else if (info.getAttribute('href')) urlEl.textContent = hostOf(info.getAttribute('href')) || urlEl.textContent;
  });

  // 영상 삽입 → 새 창으로 여는 카드
  frag.querySelectorAll('.se-oembed').forEach((comp) => {
    const e = embeds[comp.id];
    if (!e?.url || !/^https?:/i.test(e.url)) { comp.remove(); return; }
    const a = document.createElement('a');
    a.className = 'r-embed';
    a.href = e.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const t = document.createElement('span');
    t.className = 'r-embed-title';
    t.textContent = e.title || '영상 보기';
    const s2 = document.createElement('span');
    s2.className = 'r-embed-src';
    s2.textContent = `${e.provider || hostOf(e.url)} · 새 창에서 보기`;
    const play = document.createElement('span');
    play.className = 'r-embed-play';
    a.append(play, t, s2);
    comp.replaceChildren(a);
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
