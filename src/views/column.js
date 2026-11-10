// 칼럼 읽기 (#/c/<id>)
//   모바일: 화면 전체를 글에 (탭바 숨김, 내려가면 상단바도 숨김)
//   PC: 왼쪽 목록 + 오른쪽 글
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { navigate } from '../router.js';
import { FONTS, loadFont } from '../lib/fonts.js';
import { getView, cssVars, themeColors } from '../lib/view.js';
import { getPrefs, applyPrefs } from '../lib/prefs.js';
import { loadColumns, cachedColumns, columnById, fetchMd, signImages, fmtDate } from '../lib/columns.js';
import { loadReading, getReading, saveReading, statusOf } from '../lib/progress.js';
import { buildArticle, paintColors, lazyImages } from '../lib/reader-html.js';
import { attachReader } from '../components/readerControls.js';
import { openViewSettings, closeViewSettings, viewSettingsOpen } from '../components/viewSettings.js';
import { icon, textSizeIcon } from '../components/icons.js';
import { getPane, revealActive, filteredColumns, listState } from './columns.js';

const wide = () => matchMedia('(min-width: 1024px)').matches;
export const appDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

export function renderColumn(view, app, id) {
  const cleanups = [];
  let alive = true;

  // ---------- 틀 ----------
  if (wide()) {
    const p = getPane();
    p.activeId = id;
    const keep = p.el.scrollTop;
    mount(view, html`<div class="col-split"><div data-slot></div><section data-reader></section></div>`);
    view.querySelector('[data-slot]').replaceWith(p.el);
    p.draw();
    p.el.scrollTop = keep;
    requestAnimationFrame(() => revealActive(p));
    if (!p.cols) p.refresh();
  } else {
    mount(view, html`<section data-reader></section>`);
  }
  const host = view.querySelector('[data-reader]');
  window.scrollTo(0, 0);

  const scope = 'column';
  const col0 = columnById(id);
  mount(host, html`
    <div class="reader" data-reader-root>
      <div class="reader-bar" data-bar>
        <a href="#/columns" class="rb-btn rb-back" aria-label="목록으로">${icon('back', 24)}</a>
        <span class="rb-title" data-title>${col0?.title || ''}</span>
        <button type="button" class="rb-btn" data-action="auto" aria-pressed="false" aria-label="자동 스크롤" title="자동 스크롤">${icon('play', 20)}</button>
        <button type="button" class="rb-btn" data-action="settings" aria-label="보기 설정" title="보기 설정">${textSizeIcon(24)}</button>
        <span class="reader-progress" data-progress></span>
      </div>
      <div class="reader-main"><div class="reader-inner" data-inner>
        <p style="color:var(--r-muted);padding:40px 0">불러오는 중…</p>
      </div></div>
    </div>`);
  const root = host.querySelector('[data-reader-root]');
  const bar = host.querySelector('[data-bar]');
  const progEl = host.querySelector('[data-progress]');
  const inner = host.querySelector('[data-inner]');

  // ---------- 보기 설정 적용 ----------
  let bodyEl = null;
  const applyView = () => {
    const v = getView(scope);
    loadFont(v.font);
    const vars = cssVars(v, (FONTS[v.font] || FONTS.nanumGothic).stack, appDark());
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
    const c = themeColors(v, appDark());
    if (bodyEl) paintColors(bodyEl, c.bg, c.fg);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c.bg));
    if (getPrefs().sameAsBody) applyPrefs();
  };
  applyView();
  cleanups.push(() => applyPrefs());   // 앱 화면 색 되돌리기
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => applyView();
  mq.addEventListener('change', onScheme);
  cleanups.push(() => mq.removeEventListener('change', onScheme));

  let ctrl = null;
  cleanups.push(onAction(host, {
    settings() { openViewSettings({ scope, appDark, onChange: applyView }); },
    auto() { ctrl?.toggleAuto(); },
    async toggleRead() {
      const r = getReading('column', id);
      if (statusOf(r) === 'read') saveReading('column', id, { finished_at: null, anchor: null, progress: 0 });
      else saveReading('column', id, { finished_at: true });
      drawEnd();
    },
  }));
  cleanups.push(() => closeViewSettings());

  // ---------- 내용 ----------
  let col = col0;
  let neighbors = { prev: null, next: null };
  const computeNeighbors = () => {
    const all = cachedColumns() || [];
    let list = filteredColumns(all, listState(), { ignoreRead: true });
    if (!list.some((c) => c.id === id)) list = all;
    const i = list.findIndex((c) => c.id === id);
    neighbors = { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  };

  const endEl = document.createElement('footer');
  endEl.className = 'reader-end';
  function drawEnd() {
    if (!col) return;
    const read = statusOf(getReading('column', id)) === 'read';
    computeNeighbors();
    mount(endEl, html`
      <div class="re-actions">
        <button type="button" class="re-btn ${read ? 'is-on' : ''}" data-action="toggleRead" aria-pressed="${read}">
          ${icon('check', 18, 2.4)}${read ? '읽음' : '다 읽음으로 표시'}</button>
        ${col.source_url ? html`<a class="re-btn" href="${col.source_url}" target="_blank" rel="noopener noreferrer">원문 보기 ${icon('external', 16)}</a>` : ''}
      </div>
      ${read ? html`<p style="margin:0;font-size:12px;color:var(--r-muted)">다시 누르면 안 읽음으로 바뀌어요.</p>` : ''}
      ${(col.tags || []).length ? html`<div class="re-tags">${col.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <nav class="re-nav" aria-label="다른 글">
        ${neighbors.prev ? html`<a href="#/c/${encodeURIComponent(neighbors.prev.id)}"><small>‹ 이전 글</small><span>${neighbors.prev.title}</span></a>` : ''}
        ${neighbors.next ? html`<a class="next" href="#/c/${encodeURIComponent(neighbors.next.id)}"><small>다음 글 ›</small><span>${neighbors.next.title}</span></a>` : ''}
      </nav>`);
  }

  (async () => {
    try {
      if (!col) { await loadColumns(); col = columnById(id); }
      if (!col) {
        mount(inner, html`<div style="padding:48px 0;display:flex;flex-direction:column;gap:12px">
          <strong style="font-size:18px">글을 찾을 수 없어요</strong>
          <span style="color:var(--r-muted)">삭제됐거나 주소가 바뀌었을 수 있어요.</span>
          <a href="#/columns" class="re-btn" style="align-self:flex-start">목록으로</a></div>`);
        return;
      }
      host.querySelector('[data-title]').textContent = col.title;
      document.title = `${col.title} · 서재`;
      const [md] = await Promise.all([fetchMd(col), loadReading().catch(() => null)]);
      if (!alive) return;

      const known = new Set((cachedColumns() || []).map((c) => c.id));
      const { el, images } = buildArticle(md, { known, links: col.links || {} });
      el.className = 'reader-body';
      bodyEl = el;

      mount(inner, html`
        <header class="reader-head">
          <div class="rh-cat">${col.category || ''}</div>
          <h1>${col.title}</h1>
          <div class="rh-meta"><span>${fmtDate(col.published_at)}</span>${col.author ? html`<span>· ${col.author}</span>` : ''}</div>
        </header>`);
      inner.append(el, endEl);
      drawEnd();
      applyView();

      // 이미지: 화면 가까이 오면 서명 주소로
      if (images.length) cleanups.push(lazyImages(el, signImages));

      // ---------- 조작 · 위치 ----------
      ctrl = attachReader({
        body: el,
        tapArea: host.querySelector('.reader-main'),
        getView: () => getView(scope),
        topOffset: () => bar.offsetHeight,
        onPosition(anchor, p) {
          progEl.style.width = `${Math.round(p * 100)}%`;
          const r = getReading('column', id);
          if (!r && p < 0.02) return;   // 열자마자 나가면 기록 안 함
          saveReading('column', id, { anchor, progress: p });
        },
        onEnd() {
          const r = getReading('column', id);
          if (statusOf(r) !== 'read') {
            saveReading('column', id, { finished_at: true, progress: 1 });
            drawEnd();
            toast('끝까지 읽어서 읽음으로 표시했어요.');
          }
        },
        onChrome(v) {
          if (wide() && !v && !ctrl?.autoRunning) return;   // PC 는 자동 스크롤 때만 숨김
          if (v) bar.removeAttribute('data-hidden'); else bar.setAttribute('data-hidden', '');
        },
        onAutoChange(on) {
          const b = host.querySelector('[data-action="auto"]');
          b.setAttribute('aria-pressed', String(on));
          mount(b, icon(on ? 'pause' : 'play', 20));
        },
        onKey: {
          next: () => neighbors.next && navigate(`/c/${encodeURIComponent(neighbors.next.id)}`),
          prev: () => neighbors.prev && navigate(`/c/${encodeURIComponent(neighbors.prev.id)}`),
          back: () => { if (!viewSettingsOpen() && !wide()) navigate('/columns'); },
        },
      });
      cleanups.push(() => ctrl.destroy());

      const r = getReading('column', id);
      const wasRead = statusOf(r) === 'read';
      if (!wasRead && (r?.anchor || r?.progress)) {
        // 위쪽 이미지가 늦게 로드돼도 읽던 문단에 머물도록, 사용자가 움직이기 전까지 다시 맞춤
        let pinned = true;
        let pinnedY = -1;
        const unpin = () => { pinned = false; };
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((e) => window.addEventListener(e, unpin, { once: true, passive: true }));
        const again = () => {
          if (!pinned || !alive) return;
          if (pinnedY >= 0 && Math.abs(window.scrollY - pinnedY) > 40) { pinned = false; return; }   // 그새 움직였으면 그대로 둠
          ctrl.restore(r.anchor, r.progress);
          pinnedY = window.scrollY;
        };
        requestAnimationFrame(again);
        el.addEventListener('load', again, true);
        setTimeout(() => { pinned = false; el.removeEventListener('load', again, true); }, 4000);
        toast('읽던 곳부터 이어서 보여드려요.');
      } else {
        ctrl.refresh();
      }
      if (wasRead) ctrl.setEnded(true);
      progEl.style.width = `${Math.round(ctrl.progress() * 100)}%`;
    } catch (err) {
      if (!alive) return;
      mount(inner, html`<div style="padding:48px 0;display:flex;flex-direction:column;gap:12px">
        <strong style="font-size:18px">글을 불러오지 못했어요</strong>
        <span style="color:var(--r-muted)">${errorMessage(err)}</span>
        <button type="button" class="re-btn" style="align-self:flex-start" onclick="location.reload()">다시 시도</button></div>`);
    }
  })();

  return () => {
    alive = false;
    document.title = '서재';
    cleanups.reverse().forEach((fn) => { try { fn(); } catch {} });
  };
}
