// 소설 회차 읽기 (#/n/<id>/<key>)
//   모바일: 화면 전체 + 회차 목록은 위로 덮는 패널
//   PC: 회차 목록을 왼쪽 접이식 패널로 (열림/닫힘 기억)
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { navigate } from '../router.js';
import { FONTS, loadFont } from '../lib/fonts.js';
import { getView, cssVars, themeColors } from '../lib/view.js';
import { getPrefs, applyPrefs } from '../lib/prefs.js';
import { loadNovels, novelById, loadChapters, cachedChapters, fetchChapterText, prefetchChapter } from '../lib/novels.js';
import { splitParagraphs, chapterLabel, lastOpened } from '../lib/novelText.js';
import { loadReading, getReading, saveReading, statusOf, novelReading } from '../lib/progress.js';
import { attachReader } from '../components/readerControls.js';
import { openViewSettings, closeViewSettings, viewSettingsOpen } from '../components/viewSettings.js';
import { icon, textSizeIcon } from '../components/icons.js';
import { chapterRows, chapterHref } from './novels.js';
import { appDark } from './column.js';

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

  mount(view, html`
    <div class="nv-split" data-panel="${panelOpen ? 'open' : ''}">
      <aside class="nv-panel" data-panel-el aria-label="회차 목록"></aside>
      <section class="reader" data-reader-root>
        <div class="reader-bar" data-bar>
          <a href="#/n/${encodeURIComponent(nid)}" class="rb-btn" aria-label="회차 목록 화면으로">${icon('back', 24)}</a>
          <span class="rb-title"><small data-novel>${novel?.title || ''}</small><span data-title></span></span>
          <button type="button" class="rb-btn" data-action="panel" aria-pressed="${panelOpen}" aria-label="회차 목록" title="회차 목록">${icon('list', 22)}</button>
          <button type="button" class="rb-btn" data-action="auto" aria-pressed="false" aria-label="자동 스크롤" title="자동 스크롤">${icon('play', 20)}</button>
          <button type="button" class="rb-btn" data-action="settings" aria-label="보기 설정" title="보기 설정">${textSizeIcon(24)}</button>
          <span class="reader-progress" data-progress></span>
        </div>
        <div class="reader-main"><div class="reader-inner" data-inner>
          <p style="color:var(--r-muted);padding:40px 0">불러오는 중…</p>
        </div></div>
      </section>
    </div>`);
  const split = view.querySelector('.nv-split');
  const panel = view.querySelector('[data-panel-el]');
  const root = view.querySelector('[data-reader-root]');
  const bar = view.querySelector('[data-bar]');
  const progEl = view.querySelector('[data-progress]');
  const inner = view.querySelector('[data-inner]');
  window.scrollTo(0, 0);

  // ---------- 보기 설정 ----------
  const applyView = () => {
    const v = getView(scope);
    loadFont(v.font);
    const vars = cssVars(v, (FONTS[v.font] || FONTS.notoSerif).stack, appDark());
    for (const [k, val] of Object.entries(vars)) { root.style.setProperty(k, val); panel.style.setProperty(k, val); }
    const c = themeColors(v, appDark());
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c.bg));
    if (getPrefs().sameAsBody) applyPrefs();
  };
  applyView();
  cleanups.push(() => applyPrefs());
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', applyView);
  cleanups.push(() => mq.removeEventListener('change', applyView));

  // ---------- 회차 패널 ----------
  const drawPanel = () => {
    if (!chapters) { mount(panel, html`<p class="nv-panel-msg">불러오는 중…</p>`); return; }
    mount(panel, html`
      <div class="nv-panel-head">
        <a href="#/n/${encodeURIComponent(nid)}" class="nv-panel-title">${novel?.title || ''}</a>
        <button type="button" class="rb-btn" data-action="panel" aria-label="회차 목록 닫기">${icon('close', 20)}</button>
      </div>
      <nav class="nv-list">${chapterRows(nid, chapters, { current: key, since })}</nav>`);
  };
  const revealCurrent = () => {
    const el = panel.querySelector('.is-current');
    if (el) panel.scrollTop = el.offsetTop - panel.clientHeight / 3;
  };
  const setPanel = (open) => {
    panelOpen = open;
    split.dataset.panel = open ? 'open' : '';
    view.querySelectorAll('[data-action="panel"]').forEach((b) => b.setAttribute('aria-pressed', String(open)));
    if (wide()) { try { localStorage.setItem(PANEL_KEY, open ? '1' : '0'); } catch {} }
    document.body.style.overflow = open && !wide() ? 'hidden' : '';
    if (open) { drawPanel(); requestAnimationFrame(revealCurrent); }
  };
  cleanups.push(() => { document.body.style.overflow = ''; });
  // 모바일 패널에서 회차를 고르면 닫힘 (주소가 바뀌며 화면이 새로 그려짐)

  let ctrl = null;
  let neighbors = { prev: null, next: null };
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
        <button type="button" class="re-btn ${read ? 'is-on' : ''}" data-action="toggleRead" aria-pressed="${read}">
          ${icon('check', 18, 2.4)}${read ? '읽음' : '다 읽음으로 표시'}</button>
        ${neighbors.prev ? html`<a class="re-btn" href="${chapterHref(nid, neighbors.prev.key)}">‹ 이전 회차</a>` : ''}
        <a class="re-btn" href="#/n/${encodeURIComponent(nid)}">회차 목록</a>
      </div>`);
  };

  cleanups.push(onAction(view, {
    settings() { openViewSettings({ scope, appDark, onChange: applyView }); },
    auto() { ctrl?.toggleAuto(); },
    panel() { setPanel(!panelOpen); },
    toggleRead() {
      const r = getReading('chapter', itemId);
      if (statusOf(r) === 'read') saveReading('chapter', itemId, { novel_id: nid, finished_at: null, anchor: null, progress: 0 });
      else saveReading('chapter', itemId, { novel_id: nid, finished_at: true });
      drawEnd();
      if (panelOpen) drawPanel();
    },
  }));
  cleanups.push(() => closeViewSettings());
  // 모바일 패널 바깥(어두운 부분) 누르면 닫기
  const onBackdrop = (e) => { if (!wide() && panelOpen && e.target === split) setPanel(false); };
  split.addEventListener('click', onBackdrop);

  (async () => {
    try {
      if (!novel) { await loadNovels(); novel = novelById(nid); view.querySelector('[data-novel]').textContent = novel?.title || ''; }
      if (!chapters || !chapters.some((c) => c.key === key)) chapters = await loadChapters(nid);
      else loadChapters(nid).then((l) => { chapters = l; }).catch(() => {});
      const i = chapters.findIndex((c) => c.key === key);
      const ch = chapters[i];
      if (!novel || !ch) {
        mount(inner, html`<div style="padding:48px 0;display:flex;flex-direction:column;gap:12px">
          <strong style="font-size:18px">회차를 찾을 수 없어요</strong>
          <a href="#/n/${encodeURIComponent(nid)}" class="re-btn" style="align-self:flex-start">회차 목록으로</a></div>`);
        return;
      }
      neighbors = { prev: chapters[i - 1] || null, next: chapters[i + 1] || null };
      view.querySelector('[data-title]').textContent = chapterLabel(ch);
      document.title = `${chapterLabel(ch)} · ${novel.title}`;
      if (panelOpen) setPanel(true);

      const [text] = await Promise.all([fetchChapterText(ch), loadReading().catch(() => null)]);
      if (!alive) return;

      // 본문: 줄 번호를 위치 기준으로
      const body = document.createElement('div');
      body.className = 'reader-body nv-body';
      for (const p of splitParagraphs(text)) {
        if (p.gap) { const g = document.createElement('div'); g.className = 'nv-gap'; body.appendChild(g); continue; }
        const el = document.createElement('p');
        el.dataset.anchor = String(p.line);
        el.textContent = p.text;
        body.appendChild(el);
      }
      mount(inner, html`
        <header class="reader-head">
          <div class="rh-cat">${novel.title}</div>
          <h1>${chapterLabel(ch)}</h1>
          <div class="rh-meta"><span>${i + 1} / ${chapters.length.toLocaleString()}화</span>${ch.char_count ? html`<span>· ${Math.max(1, Math.round(ch.char_count / 1000))}천 자</span>` : ''}</div>
        </header>`);
      inner.append(body, endEl);
      drawEnd();

      ctrl = attachReader({
        body,
        tapArea: view.querySelector('.reader-main'),
        anchorSelector: '[data-anchor]',
        getView: () => getView(scope),
        topOffset: () => bar.offsetHeight,
        onPosition(anchor, p) {
          progEl.style.width = `${Math.round(p * 100)}%`;
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
        onChrome(v) {
          if (wide() && !v && !ctrl?.autoRunning) return;
          if (v) bar.removeAttribute('data-hidden'); else bar.setAttribute('data-hidden', '');
        },
        onAutoChange(on) {
          const b = view.querySelector('[data-action="auto"]');
          b.setAttribute('aria-pressed', String(on));
          mount(b, icon(on ? 'pause' : 'play', 20));
        },
        onKey: {
          next: () => neighbors.next && navigate(`/n/${encodeURIComponent(nid)}/${encodeURIComponent(neighbors.next.key)}`),
          prev: () => neighbors.prev && navigate(`/n/${encodeURIComponent(nid)}/${encodeURIComponent(neighbors.prev.key)}`),
          endNext: () => neighbors.next && navigate(`/n/${encodeURIComponent(nid)}/${encodeURIComponent(neighbors.next.key)}`),
          back: () => {
            if (viewSettingsOpen()) return;
            if (panelOpen && !wide()) setPanel(false);
            else if (!wide()) navigate(`/n/${encodeURIComponent(nid)}`);
          },
        },
      });
      cleanups.push(() => ctrl.destroy());

      // 다음 회차 미리 받기 (조금 뒤에)
      const pf = setTimeout(() => prefetchChapter(neighbors.next), 3000);
      cleanups.push(() => clearTimeout(pf));

      const r = getReading('chapter', itemId);
      const wasRead = statusOf(r) === 'read';
      if (!wasRead && (r?.anchor || r?.progress)) {
        requestAnimationFrame(() => ctrl.restore(r.anchor, r.progress));
        toast('읽던 곳부터 이어서 보여드려요.');
      } else ctrl.refresh();
      if (wasRead) ctrl.setEnded(true);
      progEl.style.width = `${Math.round(ctrl.progress() * 100)}%`;
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
    split.removeEventListener('click', onBackdrop);
    cleanups.reverse().forEach((fn) => { try { fn(); } catch {} });
  };
}
