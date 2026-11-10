// 소설 회차 읽기 (#/n/<id>/<key>)
//   - 본문 위 작품명·회차 제목 없음 (위 바 제목을 누르면 정보 팝업)
//   - 모바일: 화면 전체 + 회차 목록은 위로 덮는 패널 / PC: 왼쪽 접이식 패널 (열림/닫힘 기억)
//   - 패널 정렬(1화부터 ↔ 최신 회차부터)은 회차 목록 화면과 같은 설정
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { navigate } from '../router.js';
import { loadNovels, novelById, loadChapters, cachedChapters, fetchChapterText, prefetchChapter, chapterSortDesc, setChapterSortDesc } from '../lib/novels.js';
import { splitParagraphs, chapterLabel, lastOpened } from '../lib/novelText.js';
import { loadReading, getReading, saveReading, statusOf, novelReading } from '../lib/progress.js';
import { getView } from '../lib/view.js';
import { applyReaderTheme, resetReaderTheme, appDark } from '../lib/readerTheme.js';
import { createSearch } from '../lib/search.js';
import { armFullscreen } from '../lib/fullscreen.js';
import { fmtDate } from '../lib/columns.js';
import { attachReader } from '../components/readerControls.js';
import { createChrome } from '../components/readerChrome.js';
import { openViewSettings, closeViewSettings, viewSettingsOpen } from '../components/viewSettings.js';
import { icon } from '../components/icons.js';
import { chapterRows, chapterHref } from './novels.js';
import { readMinutes, kChars } from './column.js';

const wide = () => matchMedia('(min-width: 1024px)').matches;
const PANEL_KEY = 'ui:nvPanel';
const panelPref = () => { try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch { return true; } };

export function renderChapter(view, nid, key) {
  const cleanups = [];
  let alive = true;
  const scope = 'novel';
  const itemId = `${nid}/${key}`;
  let novel = novelById(nid);
  let chapters = cachedChapters(nid);
  let panelOpen = wide() ? panelPref() : false;
  const since = lastOpened(novelReading(nid));
  let ch = null;
  let idx = -1;

  mount(view, html`
    <div class="nv-split" data-panel="${panelOpen ? 'open' : ''}">
      <aside class="nv-panel" data-panel-el aria-label="회차 목록"></aside>
      <section class="reader" data-reader-root>
        <div class="reader-main"><div class="reader-inner" data-inner>
          <p style="color:var(--r-muted);padding:40px 0">불러오는 중…</p>
        </div></div>
      </section>
    </div>`);
  const split = view.querySelector('.nv-split');
  const panel = view.querySelector('[data-panel-el]');
  const root = view.querySelector('[data-reader-root]');
  const inner = view.querySelector('[data-inner]');
  window.scrollTo(0, 0);

  // ---------- 보기 설정 ----------
  const applyView = () => applyReaderTheme([root, panel], scope);
  applyView();
  cleanups.push(resetReaderTheme);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', applyView);
  cleanups.push(() => mq.removeEventListener('change', applyView));
  cleanups.push(armFullscreen());

  // ---------- 회차 패널 ----------
  const drawPanel = () => {
    if (!chapters) { mount(panel, html`<p class="nv-panel-msg">불러오는 중…</p>`); return; }
    const desc = chapterSortDesc(nid);
    mount(panel, html`
      <div class="nv-panel-head">
        <a href="#/n/${encodeURIComponent(nid)}" class="nv-panel-title">${novel?.title || ''}</a>
        <button type="button" class="rb-btn" data-action="panel" aria-label="회차 목록 닫기">${icon('close', 20)}</button>
      </div>
      <div class="nv-sort" role="group" aria-label="정렬">
        <button type="button" data-action="sort" data-v="asc" aria-pressed="${String(!desc)}">1화부터</button>
        <button type="button" data-action="sort" data-v="desc" aria-pressed="${String(desc)}">최신 회차부터</button>
      </div>
      <nav class="nv-list">${chapterRows(nid, chapters, { current: key, since, desc })}</nav>`);
  };
  const revealCurrent = () => {
    const el = panel.querySelector('.is-current');
    if (el) panel.scrollTop = Math.max(0, el.offsetTop - panel.clientHeight / 3);
  };
  const setPanel = (open) => {
    panelOpen = open;
    split.dataset.panel = open ? 'open' : '';
    if (wide()) { try { localStorage.setItem(PANEL_KEY, open ? '1' : '0'); } catch {} }
    document.body.style.overflow = open && !wide() ? 'hidden' : '';
    if (open) { drawPanel(); requestAnimationFrame(revealCurrent); }
  };
  cleanups.push(() => { document.body.style.overflow = ''; });
  const onBackdrop = (e) => { if (!wide() && panelOpen && e.target === split) setPanel(false); };
  split.addEventListener('click', onBackdrop);
  cleanups.push(() => split.removeEventListener('click', onBackdrop));
  cleanups.push(onAction(panel, {
    panel() { setPanel(false); },
    sort(b) { setChapterSortDesc(nid, b.dataset.v === 'desc'); drawPanel(); requestAnimationFrame(revealCurrent); },
  }));

  // ---------- 위·아래 바 ----------
  let ctrl = null;
  let search = null;
  let neighbors = { prev: null, next: null };
  const navOf = (c) => (c ? { href: chapterHref(nid, c.key), label: chapterLabel(c) } : null);
  const info = () => {
    if (!ch) return '';
    const rows = novelReading(nid);
    const readN = Object.values(rows).filter((r) => statusOf(r) === 'read').length;
    const total = chapters.length;
    const p = Math.round((ctrl?.progress() || 0) * 100);
    const r = getReading('chapter', itemId);
    return html`
      <span class="ri-small">${[novel?.title, novel?.author, novel?.genre].filter(Boolean).join(' · ')}</span>
      <span class="ri-title">${ch.title || chapterLabel(ch)}</span>
      <div class="ri-grid">
        <div class="ri-stat"><span>회차</span><b>${(idx + 1).toLocaleString()} / ${total.toLocaleString()}화</b></div>
        <div class="ri-stat"><span>분량</span><b>${ch.char_count ? `${kChars(ch.char_count)} · 약 ${readMinutes(ch.char_count)}분` : '-'}</b></div>
      </div>
      <div class="ri-bar"><span>이 회차<em style="font-style:normal;color:var(--r-muted)">${p}%</em></span><i><b style="width:${p}%"></b></i></div>
      <div class="ri-bar"><span>작품 전체<em style="font-style:normal;color:var(--r-muted)">${readN.toLocaleString()}화 읽음 · ${total ? Math.round((readN / total) * 1000) / 10 : 0}%</em></span><i><b style="width:${total ? (readN / total) * 100 : 0}%"></b></i></div>
      ${(novel?.tags || []).length ? html`<div class="ri-tags">${novel.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <div class="ri-foot"><span>${ch.added_at ? `${fmtDate(ch.added_at)} 추가` : ''}</span><span>${statusOf(r) === 'read' ? '읽음' : statusOf(r) === 'reading' ? '읽는 중' : '처음 읽음'}</span></div>`;
  };
  const chrome = createChrome(root, {
    backHref: `#/n/${encodeURIComponent(nid)}`, backLabel: '회차 목록 화면으로',
    small: novel?.title || '', title: '',
    info,
    prev: null, next: null, prevText: '이전화', nextText: '다음화',
    panelButton: true, onPanel: () => setPanel(!panelOpen),
    onSettings: () => openViewSettings({ scope, appDark, onChange: applyView }),
    onAuto: () => ctrl?.toggleAuto(),
    onPin: () => ctrl?.setChrome(true),   // 고정을 바꾸면 지금은 보이는 상태로 맞춤
    onSeek: (p) => ctrl?.seek(p),
    onSearch: (q) => search?.run(q) || 0,
    onSearchStep: (d) => (d === 0 ? search?.go(0, chrome.edges().top) : d > 0 ? search?.next(chrome.edges().top) : search?.prev(chrome.edges().top)) ?? -1,
    onSearchClose: () => search?.clear(),
  });
  cleanups.push(() => chrome.destroy());
  cleanups.push(() => closeViewSettings());

  const endEl = document.createElement('footer');
  endEl.className = 'reader-end';
  const drawEnd = () => {
    const read = statusOf(getReading('chapter', itemId)) === 'read';
    mount(endEl, html`
      ${neighbors.next ? html`
        <a class="nv-next" href="${chapterHref(nid, neighbors.next.key)}">
          <small>다음 회차</small><strong>${chapterLabel(neighbors.next)}</strong></a>` : html`
        <p class="nv-last">마지막 회차예요. 새 회차가 올라오면 목록에 "새"로 표시돼요.</p>`}
      <div class="re-actions">
        <button type="button" class="re-btn ${read ? 'is-on' : ''}" data-action="toggleRead" aria-pressed="${String(read)}">
          ${icon('check', 18, 2.4)}${read ? '읽음' : '다 읽음으로 표시'}</button>
        <a class="re-btn" href="#/n/${encodeURIComponent(nid)}">회차 목록</a>
      </div>`);
  };
  cleanups.push(onAction(root, {
    toggleRead() {
      const r = getReading('chapter', itemId);
      if (statusOf(r) === 'read') saveReading('chapter', itemId, { novel_id: nid, finished_at: null, anchor: null, progress: 0 });
      else saveReading('chapter', itemId, { novel_id: nid, finished_at: true });
      drawEnd();
      if (panelOpen) drawPanel();
    },
  }));

  const goChapter = (c) => c && navigate(`/n/${encodeURIComponent(nid)}/${encodeURIComponent(c.key)}`);

  (async () => {
    try {
      if (!novel) { await loadNovels(); novel = novelById(nid); }
      if (!chapters || !chapters.some((c) => c.key === key)) chapters = await loadChapters(nid);
      else loadChapters(nid).then((l) => { chapters = l; }).catch(() => {});
      idx = chapters.findIndex((c) => c.key === key);
      ch = chapters[idx];
      if (!novel || !ch) {
        mount(inner, html`<div style="padding:48px 0;display:flex;flex-direction:column;gap:12px">
          <strong style="font-size:18px">회차를 찾을 수 없어요</strong>
          <a href="#/n/${encodeURIComponent(nid)}" class="re-btn" style="align-self:flex-start">회차 목록으로</a></div>`);
        return;
      }
      neighbors = { prev: chapters[idx - 1] || null, next: chapters[idx + 1] || null };
      chrome.setTitle(`${novel.title} · ${(idx + 1).toLocaleString()} / ${chapters.length.toLocaleString()}화`, chapterLabel(ch));
      chrome.setNav(navOf(neighbors.prev), navOf(neighbors.next));
      document.title = `${chapterLabel(ch)} · ${novel.title}`;
      if (panelOpen) setPanel(true);

      const [text] = await Promise.all([fetchChapterText(ch), loadReading().catch(() => null)]);
      if (!alive) return;

      // 본문: 원본 줄 번호를 위치 기준으로
      const body = document.createElement('div');
      body.className = 'reader-body nv-body';
      for (const p of splitParagraphs(text)) {
        if (p.gap) { const g = document.createElement('div'); g.className = 'nv-gap'; body.appendChild(g); continue; }
        const el = document.createElement('p');
        el.dataset.anchor = String(p.line);
        el.textContent = p.text;
        body.appendChild(el);
      }
      inner.replaceChildren(body, endEl);
      drawEnd();
      search = createSearch(body);
      cleanups.push(() => search.clear());

      ctrl = attachReader({
        body,
        tapArea: root,
        anchorSelector: '[data-anchor]',
        getView: () => getView(scope),
        edges: () => chrome.edges(),
        isPinned: () => chrome.pinned,
        onScrollNow: (p) => chrome.setProgress(p),
        onPosition(anchor, p) {
          const r = getReading('chapter', itemId);
          if (!r && p < 0.02) return;
          saveReading('chapter', itemId, { novel_id: nid, anchor, progress: p });
        },
        onEnd() {
          if (statusOf(getReading('chapter', itemId)) !== 'read') {
            saveReading('chapter', itemId, { novel_id: nid, finished_at: true, progress: 1 });
            drawEnd();
          }
          prefetchChapter(neighbors.next);
        },
        onChrome: (v) => chrome.setVisible(v),
        onAutoChange: (on) => chrome.setAuto(on),
        onKey: {
          next: () => goChapter(neighbors.next),
          prev: () => goChapter(neighbors.prev),
          endNext: () => goChapter(neighbors.next),
          search: () => chrome.openSearch(),
          back: () => {
            if (viewSettingsOpen() || chrome.searching) return;
            if (panelOpen && !wide()) setPanel(false);
            else if (!wide()) navigate(`/n/${encodeURIComponent(nid)}`);
          },
        },
      });
      cleanups.push(() => ctrl.destroy());
      chrome.setVisible(true);

      const pf = setTimeout(() => prefetchChapter(neighbors.next), 3000);
      cleanups.push(() => clearTimeout(pf));

      const r = getReading('chapter', itemId);
      const wasRead = statusOf(r) === 'read';
      if (!wasRead && (r?.anchor || r?.progress)) {
        requestAnimationFrame(() => ctrl.restore(r.anchor, r.progress));
        toast('읽던 곳부터 이어서 보여드려요.');
      } else ctrl.refresh();
      if (wasRead) ctrl.setEnded(true);
      chrome.setProgress(ctrl.progress());
    } catch (err) {
      if (!alive) return;
      mount(inner, html`<div style="padding:48px 0;display:flex;flex-direction:column;gap:12px">
        <strong style="font-size:18px">회차를 불러오지 못했어요</strong>
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
