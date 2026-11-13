// 칼럼 읽기 (#/c/<id>)
//   모바일: 화면 전체를 글에 (탭바 숨김, 위·아래 바는 가운데 탭으로)
//   PC: 왼쪽 목록 + 오른쪽 글
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { navigate } from '../router.js';
import { loadColumns, cachedColumns, columnById, fetchMd, signImages, fmtDate } from '../lib/columns.js';
import { loadReading, getReading, saveReading, statusOf, isMine } from '../lib/progress.js';
import { offerOtherDevice, closeOtherDevice } from '../components/otherDevice.js';
import { getView, setView } from '../lib/view.js';
import { wantAwake } from '../lib/wakeLock.js';
import { buildArticle, paintColors, lazyImages } from '../lib/reader-html.js';
import { applyReaderTheme, resetReaderTheme, appDark } from '../lib/readerTheme.js';
import { createSearch } from '../lib/search.js';
import { armFullscreen } from '../lib/fullscreen.js';
import { attachReader } from '../components/readerControls.js';
import { createChrome } from '../components/readerChrome.js';
import { openViewSettings, closeViewSettings, viewSettingsOpen } from '../components/viewSettings.js';
import { icon } from '../components/icons.js';
import { getPane, revealActive, filteredColumns, listState } from './columns.js';
import { isColumnSaved, savedColumnsNow, refreshIndex } from '../lib/offline/index.js';
import { openColumnDownload } from '../components/dlFlow.js';
import { fmtBytes } from '../lib/offline/plan.js';

const wide = () => matchMedia('(min-width: 1024px)').matches;
export { appDark };

// 읽는 데 걸리는 시간 (한국어 1분에 약 500자)
export const readMinutes = (chars) => Math.max(1, Math.round(chars / 500));
// 글 → 글로 넘어갈 때는 바를 다시 띄우지 않음
let lastLeave = 0;

export const kChars = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만 자` : n >= 1000 ? `${Math.round(n / 1000)}천 자` : `${n}자`);

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
  const quiet = Date.now() - lastLeave < 3000;
  wantAwake('read', true);
  cleanups.push(() => { wantAwake('read', false); wantAwake('auto', false); lastLeave = Date.now(); });

  const scope = 'column';
  let col = columnById(id);
  mount(host, html`
    <div class="reader" data-reader-root>
      <div class="reader-main"><div class="reader-inner" data-inner>
        <p style="color:var(--r-muted);padding:40px 0">불러오는 중…</p>
      </div></div>
    </div>`);
  const root = host.querySelector('[data-reader-root]');
  const inner = host.querySelector('[data-inner]');

  // ---------- 이전·다음 글 (목록에서 고른 대구분·검색 순서) ----------
  let neighbors = { prev: null, next: null };
  const computeNeighbors = () => {
    const all = cachedColumns() || [];
    let list = filteredColumns(all, listState(), { ignoreRead: true });
    if (!list.some((c) => c.id === id)) list = all;
    const i = list.findIndex((c) => c.id === id);
    neighbors = { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  };
  const navOf = (c) => (c ? { href: `#/c/${encodeURIComponent(c.id)}`, label: c.title } : null);

  // ---------- 보기 설정 ----------
  let bodyEl = null;
  let search = null;
  let chars = 0;
  const applyView = () => {
    const c = applyReaderTheme([root], scope);
    if (bodyEl) paintColors(bodyEl, c.bg, c.fg);
  };
  applyView();
  cleanups.push(resetReaderTheme);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', applyView);
  cleanups.push(() => mq.removeEventListener('change', applyView));
  cleanups.push(armFullscreen());

  // ---------- 위·아래 바 ----------
  let ctrl = null;
  const info = () => {
    if (!col) return '';
    const r = getReading('column', id);
    const p = Math.round((ctrl?.progress() || 0) * 100);
    return html`
      <span class="ri-small">칼럼 · ${col.category || ''}</span>
      <span class="ri-title">${col.title}</span>
      <div class="ri-grid">
        <div class="ri-stat"><span>올린 날</span><b>${fmtDate(col.published_at)}</b></div>
        <div class="ri-stat"><span>분량</span><b>${chars ? `${kChars(chars)} · 약 ${readMinutes(chars)}분` : '…'}</b></div>
      </div>
      <div class="ri-bar"><span>이 글<em style="font-style:normal;color:var(--r-muted)">${p}%</em></span><i><b style="width:${p}%"></b></i></div>
      ${(col.tags || []).length ? html`<div class="ri-tags">${col.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <div class="ri-foot"><span>${col.author || ''} · ${statusOf(r) === 'read' ? '읽음' : statusOf(r) === 'reading' ? '읽는 중' : '안 읽음'}</span>
        ${col.source_url ? html`<a href="${col.source_url}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>` : ''}</div>`;
  };
  computeNeighbors();
  const chrome = createChrome(root, {
    backHref: '#/columns', backLabel: '목록으로', backClass: 'rb-back',
    small: col ? `칼럼 · ${col.category || ''}` : '칼럼', title: col?.title || '',
    info,
    prev: navOf(neighbors.prev), next: navOf(neighbors.next), prevText: '이전 글', nextText: '다음 글',
    onSettings: () => openViewSettings({ scope, appDark, onChange: applyView }),
    getSpeed: () => getView(scope).speed,
    onAutoSpeed: (v) => setView(scope, { speed: v }),
    onAutoStart: () => ctrl?.startAuto(),
    onAutoStop: () => ctrl?.stopAuto(),
    onAutoResume: () => ctrl?.resumeAuto(),
    onPin: () => ctrl?.setChrome(true),   // 고정을 바꾸면 지금은 보이는 상태로 맞춤
    onSeek: (p) => ctrl?.seek(p),
    onSearch: (q) => search?.run(q) || 0,
    onSearchStep: (d) => (d === 0 ? search?.go(0, chrome.edges().top) : d > 0 ? search?.next(chrome.edges().top) : search?.prev(chrome.edges().top)) ?? -1,
    onSearchClose: () => search?.clear(),
  });
  cleanups.push(() => chrome.destroy());
  cleanups.push(() => closeViewSettings());

  cleanups.push(onAction(root, {
    toggleRead() {
      const r = getReading('column', id);
      if (statusOf(r) === 'read') saveReading('column', id, { finished_at: null, anchor: null, progress: 0 });
      else saveReading('column', id, { finished_at: true });
      drawEnd();
    },
    async dlOne() {
      if (!col || isColumnSaved(id)) return;
      await openColumnDownload([col], { title: '이 글 받기' });
      await refreshIndex().catch(() => {});
      drawEnd();
    },
  }));

  const endEl = document.createElement('footer');
  endEl.className = 'reader-end';
  function drawEnd() {
    if (!col) return;
    const read = statusOf(getReading('column', id)) === 'read';
    mount(endEl, html`
      <div class="re-mark">글 끝</div>
      ${neighbors.next ? html`
        <a class="nv-next" href="#/c/${encodeURIComponent(neighbors.next.id)}">
          <small>다음 글 ›</small><strong>${neighbors.next.title}</strong></a>` : ''}
      <div class="re-actions">
        <button type="button" class="re-btn ${read ? 'is-on' : ''}" data-action="toggleRead" aria-pressed="${String(read)}">
          ${icon('check', 18, 2.4)}${read ? '읽음' : '다 읽음으로 표시'}</button>
        ${col.source_url ? html`<a class="re-btn" href="${col.source_url}" target="_blank" rel="noopener noreferrer">원문 보기 ${icon('external', 16)}</a>` : ''}
        ${isColumnSaved(id) ? html`<span class="re-btn is-on" aria-label="받아 둠">${icon('download', 17, 2.2)}받아 둠 · ${fmtBytes(savedColumnsNow().get(id)?.bytes)}</span>`
          : navigator.onLine ? html`<button type="button" class="re-btn" data-action="dlOne">${icon('download', 17, 2.2)}오프라인으로 받기</button>` : ''}
      </div>
      ${read ? html`<p style="margin:0;font-size:12px;color:var(--r-muted)">다시 누르면 안 읽음으로 바뀌어요.</p>` : ''}
      ${(col.tags || []).length ? html`<div class="re-tags">${col.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <nav class="re-nav" aria-label="다른 글">
        ${neighbors.prev ? html`<a href="#/c/${encodeURIComponent(neighbors.prev.id)}"><small>‹ 이전 글</small><span>${neighbors.prev.title}</span></a>` : ''}
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
      computeNeighbors();
      chrome.setTitle(`칼럼 · ${col.category || ''}`, col.title);
      chrome.setNav(navOf(neighbors.prev), navOf(neighbors.next));
      document.title = `${col.title} · 서재`;
      // 본문부터 바로 (읽던 위치는 기기 기록으로, 서버 기록은 뒤에서)
      const before = getReading('column', id)?.updated_at || '';
      cleanups.push(closeOtherDevice);
      const md = await fetchMd(col);
      if (!alive) return;

      const known = new Set((cachedColumns() || []).map((c) => c.id));
      const { el, images } = buildArticle(md, { known, links: col.links || {} });
      el.className = 'reader-body';
      bodyEl = el;
      chars = (el.textContent || '').replace(/\s+/g, '').length;

      // 칼럼은 본문 위 대구분·제목·날짜 유지
      mount(inner, html`
        <header class="reader-head">
          <div class="rh-cat">${col.category || ''}</div>
          <h1>${col.title}</h1>
          <div class="rh-meta"><span>${fmtDate(col.published_at)}</span>${col.author ? html`<span>· ${col.author}</span>` : ''}
            ${isColumnSaved(id) ? html`<span class="rh-dl" aria-label="받아 둠">${icon('download', 13, 2.4)}받아 둠</span>`
              : navigator.onLine ? html`<button type="button" class="rh-dl is-btn" data-action="dlOne">${icon('download', 13, 2.4)}받기</button>` : ''}</div>
        </header>`);
      inner.append(el, endEl);
      drawEnd();
      applyView();
      search = createSearch(el);
      cleanups.push(() => search.clear());

      if (images.length) cleanups.push(lazyImages(el, signImages));

      ctrl = attachReader({
        body: el,
        tapArea: root,
        getView: () => getView(scope),
        edges: () => chrome.edges(),
        isPinned: () => chrome.pinned,
        isBusy: () => chrome.busy,
        justClosed: () => chrome.justClosed,
        onScrollNow: (p, auto) => { chrome.setProgress(p); if (!auto) chrome.flashLine(); },
        onPosition(anchor, p) {
          const r = getReading('column', id);
          if (!r && p < 0.02) return;   // 열자마자 나가면 기록 안 함
          saveReading('column', id, { anchor, progress: p });
        },
        onEnd() {
          if (statusOf(getReading('column', id)) !== 'read') {
            saveReading('column', id, { finished_at: true, progress: 1 });
            drawEnd();
            toast('끝까지 읽어서 읽음으로 표시했어요.');
          }
        },
        onChrome: (v) => chrome.setVisible(v),
        onAutoChange: (state) => { chrome.setAuto(state); wantAwake('auto', state !== 'off'); },
        onKey: {
          next: () => neighbors.next && navigate(`/c/${encodeURIComponent(neighbors.next.id)}`),
          prev: () => neighbors.prev && navigate(`/c/${encodeURIComponent(neighbors.prev.id)}`),
          search: () => chrome.openSearch(),
          back: () => { if (!viewSettingsOpen() && !chrome.searching && !wide()) navigate('/columns'); },
        },
      });
      cleanups.push(() => ctrl.destroy());
      // 바: 목록에서 들어오면 1.5초만 보였다 숨김, 글끼리 넘어갈 때는 숨긴 채
      if (quiet) ctrl.setChrome(false);
      else {
        ctrl.setChrome(true);
        const t = setTimeout(() => { if (!chrome.busy) ctrl.setChrome(false); }, 1500);
        cleanups.push(() => clearTimeout(t));
      }

      const r = getReading('column', id);
      const wasRead = statusOf(r) === 'read';
      if (!wasRead && (r?.anchor || r?.progress)) {
        // 위쪽 이미지가 늦게 로드돼도 읽던 문단에 머물도록, 사용자가 움직이기 전까지 다시 맞춤
        let pinnedPos = true;
        let pinnedY = -1;
        const unpin = () => { pinnedPos = false; };
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((e) => window.addEventListener(e, unpin, { once: true, passive: true }));
        const again = () => {
          if (!pinnedPos || !alive) return;
          if (pinnedY >= 0 && Math.abs(window.scrollY - pinnedY) > 40) { pinnedPos = false; return; }
          ctrl.restore(r.anchor, r.progress);
          pinnedY = window.scrollY;
        };
        requestAnimationFrame(again);
        el.addEventListener('load', again, true);
        setTimeout(() => { pinnedPos = false; el.removeEventListener('load', again, true); }, 4000);
        toast('읽던 곳부터 이어서 보여드려요.');
      } else {
        ctrl.refresh();
      }
      if (wasRead) ctrl.setEnded(true);
      chrome.setProgress(ctrl.progress());

      // 다른 기기에서 더 읽은 위치
      if (navigator.onLine) {
        loadReading({ maxAge: 15_000 }).then(() => {
          if (!alive) return;
          const t = getReading('column', id);
          if (!t || String(t.updated_at) <= before || isMine(t) || t.finished_at) return;
          if (Math.abs((t.progress || 0) - ctrl.progress()) < 0.05) return;
          offerOtherDevice({ text: `다른 기기에서 이 글을 ${Math.round((t.progress || 0) * 100)}%까지 읽었어요.`, goLabel: '그 위치로', go: () => ctrl.restore(t.anchor, t.progress) });
        }).catch(() => {});
      }
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
