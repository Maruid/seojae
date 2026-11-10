// 읽기 화면의 위·아래 바 (칼럼·소설 공용)
//   위: 뒤로 · 제목(누르면 정보 팝업) · 검색 · [회차 목록] · 자동 스크롤 · 보기 설정
//       검색 중에는 검색창 · 결과 수 · ↑↓ · 닫기 로 바뀜
//   아래: 진행 막대 · % (누르면 직접 입력) · 이전/다음 · 바 고정
//   - 둘 다 반투명 + 흐림, 가운데 탭/클릭으로 함께 보였다 숨음
//   - 바 고정은 기기별로 기억 (처음값: 마우스 기기 = 고정, 터치 기기 = 안 고정)
import { html, mount, onAction } from '../lib/dom.js';
import { icon, textSizeIcon } from './icons.js';

const PIN_KEY = 'ui:barPin';
export function barPinned() {
  try {
    const v = localStorage.getItem(PIN_KEY);
    if (v != null) return v === '1';
  } catch {}
  return matchMedia('(hover: hover) and (pointer: fine)').matches;
}
const savePin = (on) => { try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch {} };

/**
 * opts:
 *   backHref, backLabel, small, title          상단 제목 (작은 줄 / 큰 줄)
 *   info: () => Safe html                      제목을 누르면 보일 내용
 *   prev / next: { href, label } | null         아래 바 이전/다음
 *   prevText / nextText                         '이전화' / '이전 글' 등
 *   panelButton: boolean, onPanel               회차 목록 버튼 (소설)
 *   onSettings, onAuto, onSeek(p), onSearch(q) → count, onSearchStep(dir) → index, onSearchClose
 */
export function createChrome(root, opts) {
  const top = document.createElement('div');
  top.className = 'reader-bar';
  const foot = document.createElement('div');
  foot.className = 'reader-foot';
  const pop = document.createElement('div');
  pop.className = 'rd-pop-wrap';
  root.prepend(top);
  root.append(foot);
  root.append(pop);

  let pinned = barPinned();
  let visible = true;
  let searching = false;
  let query = '';
  let hits = { count: 0, index: -1 };
  let infoOpen = false;
  let editPct = false;
  let dragging = false;
  let pct = 0;
  let autoOn = false;

  const drawTop = () => {
    if (searching) {
      mount(top, html`
        <div class="rd-search">
          <label class="rd-search-box">
            ${icon('search', 16)}
            <span class="sr-only">글 안에서 찾기</span>
            <input type="search" data-input="q" value="${query}" placeholder="이 글에서 찾기" enterkeyhint="search" autocomplete="off">
          </label>
          <span class="rd-hits" aria-live="polite">${query ? (hits.count ? `${hits.index + 1}/${hits.count}` : '없음') : ''}</span>
          <button type="button" class="rb-btn" data-action="s-prev" aria-label="이전 결과" ${hits.count ? '' : 'disabled'}>${icon('up', 20)}</button>
          <button type="button" class="rb-btn" data-action="s-next" aria-label="다음 결과" ${hits.count ? '' : 'disabled'}>${icon('down', 20)}</button>
          <button type="button" class="rb-btn" data-action="s-close" aria-label="검색 닫기">${icon('close', 20)}</button>
        </div>
        <span class="reader-progress" data-progress style="width:${pct * 100}%"></span>`);
      return;
    }
    mount(top, html`
      <a href="${opts.backHref}" class="rb-btn ${opts.backClass || ''}" aria-label="${opts.backLabel || '뒤로'}">${icon('back', 24)}</a>
      <button type="button" class="rb-title" data-action="info" aria-expanded="${String(infoOpen)}" aria-label="이 글 정보 보기">
        ${opts.small ? html`<small>${opts.small}</small>` : ''}<span>${opts.title || ''}<i aria-hidden="true">▾</i></span>
      </button>
      <button type="button" class="rb-btn" data-action="search" aria-label="글 안에서 찾기 (/)" title="찾기 ( / )">${icon('search', 20)}</button>
      ${opts.panelButton ? html`<button type="button" class="rb-btn" data-action="panel" aria-label="회차 목록" title="회차 목록">${icon('list', 22)}</button>` : ''}
      <button type="button" class="rb-btn" data-action="auto" aria-pressed="${String(autoOn)}" aria-label="자동 스크롤" title="자동 스크롤">${icon(autoOn ? 'pause' : 'play', 20)}</button>
      <button type="button" class="rb-btn" data-action="settings" aria-label="보기 설정" title="보기 설정">${textSizeIcon(24)}</button>
      <span class="reader-progress" data-progress style="width:${pct * 100}%"></span>`);
  };

  const drawFoot = () => {
    const pv = Math.round(pct * 100);
    mount(foot, html`
      <div class="rf-row">
        <input type="range" min="0" max="1000" value="${Math.round(pct * 1000)}" data-input="seek" aria-label="읽는 위치">
        ${editPct ? html`
          <form class="rf-pct-form" data-pct-form>
            <label><span class="sr-only">이동할 위치 (%)</span><input name="pct" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${pv}" autocomplete="off">%</label>
            <button type="submit">이동</button>
          </form>` : html`
          <button type="button" class="rf-pct" data-action="pct" aria-label="위치 직접 입력 (지금 ${pv}%)">${pv}%</button>`}
      </div>
      <div class="rf-row">
        ${opts.prev ? html`<a class="rf-nav" href="${opts.prev.href}" title="${opts.prev.label || ''}">‹ ${opts.prevText}</a>` : html`<span class="rf-nav is-off">‹ ${opts.prevText}</span>`}
        <button type="button" class="rf-pin ${pinned ? 'is-on' : ''}" data-action="pin" aria-pressed="${String(pinned)}" title="바 고정">${icon('pin', 18)}${pinned ? '고정됨' : '고정'}</button>
        ${opts.next ? html`<a class="rf-nav is-next" href="${opts.next.href}" title="${opts.next.label || ''}">${opts.nextText} ›</a>` : html`<span class="rf-nav is-next is-off">${opts.nextText} ›</span>`}
      </div>`);
  };

  const drawPop = () => {
    if (!infoOpen) { mount(pop, html``); return; }
    mount(pop, html`<div class="rd-pop-back" data-action="info-close"></div>
      <section class="rd-pop" role="dialog" aria-label="이 글 정보">${opts.info?.() || ''}</section>`);
  };

  const apply = () => {
    const show = visible || pinned || searching;
    top.toggleAttribute('data-hidden', !show);
    foot.toggleAttribute('data-hidden', !show || searching);
  };

  drawTop(); drawFoot(); apply();

  const offAction = onAction(root, {
    info() { infoOpen = !infoOpen; drawTop(); drawPop(); },
    'info-close'() { infoOpen = false; drawTop(); drawPop(); },
    search() { openSearch(); },
    's-prev'() { hits.index = opts.onSearchStep?.(-1) ?? -1; drawTop(); },
    's-next'() { hits.index = opts.onSearchStep?.(1) ?? -1; drawTop(); },
    's-close'() { closeSearch(); },
    panel() { opts.onPanel?.(); },
    auto() { opts.onAuto?.(); },
    settings() { opts.onSettings?.(); },
    pct() { editPct = true; drawFoot(); const i = foot.querySelector('[name="pct"]'); i?.focus(); i?.select(); },
    pin() {
      pinned = !pinned; savePin(pinned); visible = true;
      drawFoot(); apply(); opts.onPin?.(pinned);
    },
  });

  // 마우스로 누른 바 버튼은 포커스를 놓음 → 이어서 Space 를 누르면 버튼이 아니라 페이지가 넘어가게
  const onClickBlur = (e) => {
    const b = e.target.closest?.('.reader-bar button, .reader-foot button');
    if (b && e.detail > 0) setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
  };
  root.addEventListener('click', onClickBlur, true);

  // 검색어 입력 (조금 멈췄을 때 찾기)
  let st = null;
  const onInput = (e) => {
    if (e.target.dataset.input === 'q') {
      clearTimeout(st);
      st = setTimeout(() => {
        query = e.target.value;
        hits.count = opts.onSearch?.(query) || 0;
        hits.index = hits.count ? opts.onSearchStep?.(0) ?? 0 : -1;
        const caret = e.target.selectionStart;
        drawTop();
        const inp = top.querySelector('[data-input="q"]');
        inp?.focus(); inp?.setSelectionRange(caret, caret);
      }, 160);
    } else if (e.target.dataset.input === 'seek') {
      dragging = true;
      pct = +e.target.value / 1000;
      opts.onSeek?.(pct);
      const b = foot.querySelector('.rf-pct');
      if (b) b.textContent = `${Math.round(pct * 100)}%`;
    }
  };
  const onChange = (e) => { if (e.target.dataset.input === 'seek') dragging = false; };
  const onKey = (e) => {
    if (e.target.dataset?.input === 'q') {
      if (e.key === 'Enter') { e.preventDefault(); hits.index = opts.onSearchStep?.(e.shiftKey ? -1 : 1) ?? -1; const v = e.target.value; drawTop(); const i = top.querySelector('[data-input="q"]'); i?.focus(); i?.setSelectionRange(v.length, v.length); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
    } else if (e.target.name === 'pct' && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); editPct = false; drawFoot();
    } else if (infoOpen && e.key === 'Escape') {
      e.stopPropagation(); infoOpen = false; drawTop(); drawPop();
    }
  };
  const onSubmit = (e) => {
    if (!e.target.matches('[data-pct-form]')) return;
    e.preventDefault();
    const v = Math.max(0, Math.min(100, parseInt(new FormData(e.target).get('pct'), 10) || 0));
    editPct = false;
    pct = v / 100;
    opts.onSeek?.(pct);
    drawFoot();
  };
  const onFocusOut = (e) => {
    // % 입력칸 밖으로 나가면 취소 (이동 버튼을 누르는 경우는 제외)
    if (editPct && e.target.name === 'pct' && !foot.contains(e.relatedTarget)) { editPct = false; setTimeout(drawFoot, 0); }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey, true);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('focusout', onFocusOut);

  function openSearch() {
    searching = true; infoOpen = false; drawPop(); drawTop(); apply();
    const i = top.querySelector('[data-input="q"]');
    i?.focus(); i?.select();
  }
  function closeSearch() {
    searching = false; query = ''; hits = { count: 0, index: -1 };
    opts.onSearchClose?.();
    drawTop(); apply();
  }

  return {
    top, foot,
    get pinned() { return pinned; },
    get searching() { return searching; },
    setVisible(v) { visible = v; if (!v) { infoOpen = false; drawPop(); } apply(); },
    setProgress(p) {
      pct = p;
      const bar = top.querySelector('[data-progress]');
      if (bar) bar.style.width = `${p * 100}%`;
      if (dragging || editPct) return;
      const r = foot.querySelector('[data-input="seek"]');
      if (r) r.value = String(Math.round(p * 1000));
      const b = foot.querySelector('.rf-pct');
      if (b) b.textContent = `${Math.round(p * 100)}%`;
    },
    setTitle(small, title) { opts.small = small; opts.title = title; if (!searching) drawTop(); },
    setNav(prev, next) { opts.prev = prev; opts.next = next; drawFoot(); },
    setAuto(on) { autoOn = on; if (!searching) drawTop(); },
    refreshInfo() { if (infoOpen) drawPop(); },
    openSearch,
    closeSearch,
    // 바를 뺀 실제 읽는 영역 (넘기기·위치 기준)
    edges() {
      const t = top.hasAttribute('data-hidden') ? 0 : Math.max(0, top.getBoundingClientRect().bottom);
      const b = foot.hasAttribute('data-hidden') ? window.innerHeight : Math.min(window.innerHeight, foot.getBoundingClientRect().top);
      return { top: t, bottom: b };
    },
    destroy() {
      offAction();
      clearTimeout(st);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKey, true);
      root.removeEventListener('submit', onSubmit);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('click', onClickBlur, true);
    },
  };
}
