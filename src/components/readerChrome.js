// 읽기 화면의 위·아래 바 (칼럼·소설 공용)
//   위: 뒤로 · 제목 두 줄(누르면 정보 팝업) · [회차 목록] · 자동 재생 · 보기 설정  (아이콘은 오른쪽에 붙임)
//       검색 중에는 검색창 · 결과 수 · ↑↓ · 닫기 로 바뀜
//   아래: ‹ 이전 · 고정 · 검색 · % · 다음 ›   + 위 테두리에 얇은 진행선
//     % 를 누르면 위치 패널: 게이지 + 숫자 입력 (터치 기기는 앱 안 숫자 패드, PC는 입력칸)
//       소설은 % / 회차 전환 → 회차 번호로 바로 이동
//   - 바가 숨어 있을 때 스크롤하면 화면 맨 아래에 진행선이 잠깐 보였다 사라짐
//   - 자동 재생: ▶ 를 누르면 속도 창 → 시작. 재생 중에는 ■ (누르면 끔)
//               잠깐 멈춤 상태에서는 아래에 [− 속도 +] [이어서] 알약
import { html, mount, onAction } from '../lib/dom.js';
import { icon } from './icons.js';

const PIN_KEY = 'ui:barPin';
export function barPinned() {
  try {
    const v = localStorage.getItem(PIN_KEY);
    if (v != null) return v === '1';
  } catch {}
  return matchMedia('(hover: hover) and (pointer: fine)').matches;
}
const savePin = (on) => { try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch {} };
const coarse = () => matchMedia('(pointer: coarse)').matches;
const SPEED = [1, 10];

/**
 * opts:
 *   backHref, backLabel, backClass, small, title   상단 제목 (작은 줄 / 큰 줄)
 *   info: () => Safe html                           제목을 누르면 보일 내용
 *   prev / next: { href, label } | null              아래 바 이전/다음
 *   prevText / nextText                              '이전화' / '이전 글' 등
 *   panelButton: boolean, onPanel                    회차 목록 버튼 (소설)
 *   jump: { go(n) → { ok } | { near: { n, label } }, first(), last() }   회차 번호로 이동 (소설)
 *   onSettings, onPin, onSeek(p), onSearch(q) → count, onSearchStep(dir) → index, onSearchClose
 *   getSpeed(), onAutoStart(speed), onAutoStop(), onAutoResume(), onAutoSpeed(speed)
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
  let autoState = 'off';      // off | run | pause | wait
  let autoDialog = false;
  let pct = 0;
  let dragging = false;
  // 위치 패널
  let seekOpen = false;
  let mode = 'pct';           // pct | ch
  let typed = '';
  let msg = null;             // { text, near?: { n, label } }
  let closedAt = 0;
  let seekFresh = false;      // 패널을 막 열었을 때만 떠오르는 애니메이션 (숫자를 누를 때마다 깜빡이지 않게)           // 바깥을 눌러 패널을 닫은 시각 (그 탭으로 페이지가 넘어가지 않게)

  // ---------- 위 바 ----------
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
        </div>`);
      return;
    }
    const on = autoState !== 'off';
    mount(top, html`
      <a href="${opts.backHref}" class="rb-btn ${opts.backClass || ''}" aria-label="${opts.backLabel || '뒤로'}">${icon('back', 22)}</a>
      <button type="button" class="rb-title" data-action="info" aria-expanded="${String(infoOpen)}" aria-label="이 글 정보 보기">
        ${opts.small ? html`<small>${opts.small}</small>` : ''}<span>${opts.title || ''}</span>
      </button>
      <div class="rb-icons">
        <span class="rb-off" title="오프라인 · 받아 둔 글만 열 수 있어요">${icon('wifiOff', 13, 2.2)}오프라인</span>
        ${opts.panelButton ? html`<button type="button" class="rb-btn rb-sm" data-action="panel" aria-label="회차 목록" title="회차 목록">${icon('list', 20)}</button>` : ''}
        <button type="button" class="rb-btn rb-sm ${on ? 'is-on' : ''}" data-action="auto" aria-pressed="${String(on)}"
          aria-label="${on ? '자동 재생 끄기' : '자동 재생'}" title="${on ? '자동 재생 끄기' : '자동 재생'}">${icon(on ? 'stop' : 'play', 20)}</button>
        <button type="button" class="rb-btn rb-sm" data-action="settings" aria-label="보기 설정" title="보기 설정">${icon('gear', 20, 1.8)}</button>
      </div>`);
  };

  // ---------- 아래 바 ----------
  const drawFoot = () => {
    const pv = Math.round(pct * 100);
    mount(foot, html`
      <span class="rf-line" aria-hidden="true"><i data-line style="width:${pct * 100}%"></i></span>
      ${seekOpen ? seekPanel() : ''}
      <div class="rf-row">
        ${opts.prev ? html`<a class="rf-nav" href="${opts.prev.href}" title="${opts.prev.label || ''}">‹ ${opts.prevText}</a>` : html`<span class="rf-nav is-off">‹ ${opts.prevText}</span>`}
        <div class="rf-tools">
          <button type="button" class="rf-btn ${pinned ? 'is-on' : ''}" data-action="pin" aria-pressed="${String(pinned)}" aria-label="바 고정" title="바 고정">${icon('pin', 19)}</button>
          <button type="button" class="rf-btn" data-action="search" aria-label="글 안에서 찾기 (/)" title="찾기 ( / )">${icon('search', 19)}</button>
          <button type="button" class="rf-btn rf-pct ${seekOpen ? 'is-on' : ''}" data-action="seek" aria-expanded="${String(seekOpen)}" aria-label="위치 이동 (지금 ${pv}%)">${pv}%</button>
        </div>
        ${opts.next ? html`<a class="rf-nav is-next" href="${opts.next.href}" title="${opts.next.label || ''}">${opts.nextText} ›</a>` : html`<span class="rf-nav is-next is-off">${opts.nextText} ›</span>`}
      </div>`);
    if (seekOpen && !coarse()) {
      const i = foot.querySelector('[name="skv"]');
      if (i && document.activeElement !== i) { i.focus(); i.select(); }
    }
  };

  const seekPanel = () => {
    const pv = Math.round(pct * 100);
    const ch = mode === 'ch';
    const unit = ch ? '화' : '%';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'close'];
    return html`
      <div class="rd-seek ${seekFresh ? 'is-enter' : ''}" role="dialog" aria-label="위치 이동" data-no-tap>
        <div class="sk-gauge">
          <input type="range" min="0" max="1000" value="${Math.round(pct * 1000)}" data-input="seek" aria-label="읽는 위치">
          <b data-cur>${pv}%</b>
        </div>
        <div class="sk-row">
          ${opts.jump ? html`
            <div class="sk-mode" role="group" aria-label="이동 방식">
              <button type="button" data-action="sk-mode" data-v="pct" aria-pressed="${String(!ch)}">%</button>
              <button type="button" data-action="sk-mode" data-v="ch" aria-pressed="${String(ch)}">회차</button>
            </div>` : ''}
          ${coarse() ? html`
            <output class="sk-field ${typed ? '' : 'is-empty'}" aria-live="polite">${typed || (ch ? '회차 번호' : String(pv))}<small>${typed || !ch ? unit : ''}</small></output>` : html`
            <label class="sk-field sk-input"><span class="sr-only">${ch ? '이동할 회차 번호' : '이동할 위치 (%)'}</span>
              <input name="skv" inputmode="numeric" autocomplete="off" maxlength="${ch ? 5 : 3}" value="${typed}" placeholder="${ch ? '회차 번호' : String(pv)}"><small>${unit}</small></label>`}
          <button type="button" class="sk-go" data-action="sk-go" ${typed ? '' : 'disabled'}>이동</button>
        </div>
        ${msg ? html`<p class="sk-msg">${msg.text}${msg.near ? html` <button type="button" data-action="sk-near" data-n="${msg.near.n}">${msg.near.label}로 가기</button>` : ''}</p>` : ''}
        <div class="sk-chips">
          ${ch ? html`
            <button type="button" data-action="sk-first">첫 화</button>
            <button type="button" data-action="sk-last">최신 화</button>` : [10, 25, 50, 75, 90].map((v) => html`
            <button type="button" data-action="sk-chip" data-v="${v}">${v}%</button>`)}
        </div>
        ${coarse() ? html`
          <div class="sk-pad">
            ${keys.map((k) => (k === 'del'
              ? html`<button type="button" data-action="sk-key" data-k="del" aria-label="지우기">${icon('backspace', 22, 1.8)}</button>`
              : k === 'close'
                ? html`<button type="button" data-action="seek" class="sk-close">닫기</button>`
                : html`<button type="button" data-action="sk-key" data-k="${k}">${k}</button>`))}
          </div>` : ''}
      </div>`;
  };

  // ---------- 팝업 (정보 · 자동 재생 창 · 멈춤 알약 · 숨은 진행선) ----------
  const drawPop = () => {
    const sp = opts.getSpeed?.() || 4;
    mount(pop, html`
      ${infoOpen ? html`<div class="rd-pop-back" data-action="info-close"></div>
        <section class="rd-pop" role="dialog" aria-label="이 글 정보">${opts.info?.() || ''}</section>` : ''}
      ${autoDialog ? html`<div class="rd-pop-back is-dim" data-action="auto-cancel"></div>
        <section class="rd-pop rd-auto" role="dialog" aria-label="자동 재생">
          <strong>자동 재생</strong>
          <div class="au-speed">
            <button type="button" data-action="au-step" data-d="-1" aria-label="느리게">${icon('minus', 20)}</button>
            <input type="range" min="${SPEED[0]}" max="${SPEED[1]}" step="1" value="${sp}" data-input="au-speed" aria-label="속도">
            <button type="button" data-action="au-step" data-d="1" aria-label="빠르게">${icon('plus', 20)}</button>
          </div>
          <div class="au-val"><span>느리게</span><b data-au-val>속도 ${sp}</b><span>빠르게</span></div>
          <p class="au-note">${opts.panelButton
            ? '화면을 누르면 잠깐 멈추고, 다시 가운데를 누르면 이어서 가요. 회차 끝에 닿으면 다음 화로 넘어가요. 완전히 끄려면 위의 ■ 를 누르세요.'
            : '화면을 누르면 잠깐 멈추고, 다시 가운데를 누르면 이어서 가요. 글 끝에 닿으면 멈춰요.'}</p>
          <div class="au-actions">
            <button type="button" data-action="auto-cancel">취소</button>
            <button type="button" class="is-main" data-action="auto-start">${icon('play', 16)}시작</button>
          </div>
        </section>` : ''}
      ${autoState === 'pause' && !autoDialog ? html`
        <div class="rd-pill" role="group" aria-label="자동 재생 멈춤" data-no-tap>
          <button type="button" data-action="au-pill" data-d="-1" aria-label="느리게">${icon('minus', 18)}</button>
          <span>속도 <b>${sp}</b></span>
          <button type="button" data-action="au-pill" data-d="1" aria-label="빠르게">${icon('plus', 18)}</button>
          <button type="button" class="is-main" data-action="au-resume">${icon('play', 15)}이어서</button>
        </div>` : ''}
      <span class="rd-notch" aria-hidden="true"></span>
      <span class="rd-line" aria-hidden="true"><i data-hline style="width:${pct * 100}%"></i></span>`);
  };

  const apply = () => {
    const show = visible || pinned || searching;
    top.toggleAttribute('data-hidden', !show);
    foot.toggleAttribute('data-hidden', !show || searching);
    root.style.setProperty('--foot-h', `${foot.hasAttribute('data-hidden') ? 0 : foot.offsetHeight}px`);
  };

  drawTop(); drawFoot(); drawPop(); apply();

  // ---------- 위치 패널 동작 ----------
  const openSeek = (on) => {
    seekOpen = on; typed = ''; msg = null;
    if (on) { infoOpen = false; drawPop(); }
    seekFresh = on;
    drawFoot();
    seekFresh = false;
  };
  const runGo = () => {
    const n = parseInt(typed, 10);
    if (!Number.isFinite(n)) return;
    if (mode === 'pct') {
      pct = Math.max(0, Math.min(100, n)) / 100;
      opts.onSeek?.(pct);
      openSeek(false);
      return;
    }
    const r = opts.jump?.go(n);
    if (r?.ok) { openSeek(false); return; }
    msg = r?.near ? { text: `${n.toLocaleString()}화가 없어요.`, near: r.near } : { text: `${n.toLocaleString()}화가 없어요.` };
    typed = '';
    drawFoot();
  };
  const pressKey = (k) => {
    msg = null;
    if (k === 'del') typed = typed.slice(0, -1);
    else if (typed.length < (mode === 'ch' ? 5 : 3)) typed = (typed + k).replace(/^0+(?=\d)/, '');
    if (mode === 'pct' && +typed > 100) typed = '100';
    drawFoot();
  };

  // ---------- 자동 재생 ----------
  const setSpeed = (v) => {
    v = Math.max(SPEED[0], Math.min(SPEED[1], v));
    opts.onAutoSpeed?.(v);
    return v;
  };

  const offAction = onAction(root, {
    info() { infoOpen = !infoOpen; if (infoOpen && seekOpen) { seekOpen = false; drawFoot(); } drawTop(); drawPop(); },
    'info-close'() { infoOpen = false; drawTop(); drawPop(); },
    search() { openSearch(); },
    's-prev'() { hits.index = opts.onSearchStep?.(-1) ?? -1; drawTop(); },
    's-next'() { hits.index = opts.onSearchStep?.(1) ?? -1; drawTop(); },
    's-close'() { closeSearch(); },
    panel() { opts.onPanel?.(); },
    auto() {
      if (autoState !== 'off') { opts.onAutoStop?.(); return; }
      autoDialog = true; infoOpen = false; seekOpen = false; drawFoot(); drawPop();
      pop.querySelector('.is-main')?.focus();
    },
    'auto-cancel'() { autoDialog = false; drawPop(); },
    'auto-start'() {
      const v = +(pop.querySelector('[data-input="au-speed"]')?.value || opts.getSpeed?.() || 4);
      setSpeed(v);
      autoDialog = false; drawPop();
      opts.onAutoStart?.(v);
    },
    'au-step'(b) {
      const r = pop.querySelector('[data-input="au-speed"]');
      if (!r) return;
      r.value = String(Math.max(SPEED[0], Math.min(SPEED[1], +r.value + +b.dataset.d)));
      pop.querySelector('[data-au-val]').textContent = `속도 ${r.value}`;
    },
    'au-pill'(b) { setSpeed((opts.getSpeed?.() || 4) + +b.dataset.d); drawPop(); },
    'au-resume'() { opts.onAutoResume?.(); },
    settings() { opts.onSettings?.(); },
    seek() { openSeek(!seekOpen); },
    'sk-mode'(b) { mode = b.dataset.v; typed = ''; msg = null; drawFoot(); },
    'sk-key'(b) { pressKey(b.dataset.k); },
    'sk-go'() { runGo(); },
    'sk-chip'(b) { pct = +b.dataset.v / 100; opts.onSeek?.(pct); openSeek(false); },
    'sk-first'() { opts.jump?.first(); openSeek(false); },
    'sk-last'() { opts.jump?.last(); openSeek(false); },
    'sk-near'(b) { typed = b.dataset.n; runGo(); },
    pin() {
      pinned = !pinned; savePin(pinned); visible = true;
      drawFoot(); apply(); opts.onPin?.(pinned);
    },
  });

  // 마우스로 누른 바 버튼은 포커스를 놓음 → 이어서 Space 를 누르면 버튼이 아니라 페이지가 넘어가게
  const onClickBlur = (e) => {
    const b = e.target.closest?.('.reader-bar button, .reader-foot button');
    if (b && e.detail > 0 && !b.closest('.rd-seek')) setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
  };
  root.addEventListener('click', onClickBlur, true);

  // 위치 패널 바깥을 누르면 닫힘
  const onDown = (e) => {
    if (!seekOpen) return;
    if (e.target.closest?.('.rd-seek, .rf-pct')) return;
    closedAt = Date.now();
    seekOpen = false; typed = ''; msg = null; drawFoot();
  };
  document.addEventListener('pointerdown', onDown, true);

  // 검색어 입력 (조금 멈췄을 때 찾기) · 게이지 · PC 숫자 입력
  let st = null;
  const onInput = (e) => {
    const k = e.target.dataset?.input;
    if (k === 'q') {
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
    } else if (k === 'seek') {
      dragging = true;
      pct = +e.target.value / 1000;
      opts.onSeek?.(pct);
      const pv = `${Math.round(pct * 100)}%`;
      const cur = foot.querySelector('[data-cur]');
      if (cur) cur.textContent = pv;
      const b = foot.querySelector('.rf-pct');
      if (b) b.textContent = pv;
    } else if (k === 'au-speed') {
      const v = pop.querySelector('[data-au-val]');
      if (v) v.textContent = `속도 ${e.target.value}`;
    } else if (e.target.name === 'skv') {
      const v = e.target.value.replace(/\D/g, '');
      typed = mode === 'pct' && +v > 100 ? '100' : v;
      if (e.target.value !== typed) e.target.value = typed;
      msg = null;
      const go = foot.querySelector('.sk-go');
      if (go) go.disabled = !typed;
      foot.querySelector('.sk-msg')?.remove();
    }
  };
  const onChange = (e) => { if (e.target.dataset?.input === 'seek') dragging = false; };
  const onKey = (e) => {
    if (e.target.dataset?.input === 'q') {
      if (e.key === 'Enter') { e.preventDefault(); hits.index = opts.onSearchStep?.(e.shiftKey ? -1 : 1) ?? -1; const v = e.target.value; drawTop(); const i = top.querySelector('[data-input="q"]'); i?.focus(); i?.setSelectionRange(v.length, v.length); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
      return;
    }
    if (e.target.name === 'skv' && e.key === 'Enter') { e.preventDefault(); runGo(); return; }
    if (e.key !== 'Escape') return;
    if (autoDialog) { e.stopPropagation(); autoDialog = false; drawPop(); }
    else if (seekOpen) { e.stopPropagation(); openSeek(false); }
    else if (infoOpen) { e.stopPropagation(); infoOpen = false; drawTop(); drawPop(); }
  };
  const onDocKey = (e) => {
    // 자동 재생 창: Enter = 시작 (입력칸이 아닐 때)
    if (autoDialog && e.key === 'Enter') { e.preventDefault(); pop.querySelector('.is-main')?.click(); }
    else if ((autoDialog || seekOpen || infoOpen) && e.key === 'Escape') onKey(e);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey, true);
  document.addEventListener('keydown', onDocKey, true);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => apply()) : null;
  ro?.observe(foot);

  function openSearch() {
    searching = true; infoOpen = false; seekOpen = false; drawPop(); drawFoot(); drawTop(); apply();
    const i = top.querySelector('[data-input="q"]');
    i?.focus(); i?.select();
  }
  function closeSearch() {
    searching = false; query = ''; hits = { count: 0, index: -1 };
    opts.onSearchClose?.();
    drawTop(); apply();
  }

  let lineTimer = null;
  return {
    top, foot,
    get pinned() { return pinned; },
    get searching() { return searching; },
    // 바를 숨기면 안 되는 상태 (팝업·패널이 열려 있음)
    get busy() { return searching || infoOpen || seekOpen || autoDialog; },
    get justClosed() { return Date.now() - closedAt < 500; },
    setVisible(v) {
      visible = v;
      if (!v) {
        if (infoOpen || autoDialog) { infoOpen = false; autoDialog = false; drawPop(); drawTop(); }
        if (seekOpen) { seekOpen = false; drawFoot(); }
      }
      apply();
    },
    setProgress(p) {
      pct = p;
      const w = `${p * 100}%`;
      const l = foot.querySelector('[data-line]');
      if (l) l.style.width = w;
      const h = pop.querySelector('[data-hline]');
      if (h) h.style.width = w;
      if (dragging) return;
      const pv = `${Math.round(p * 100)}%`;
      const r = foot.querySelector('[data-input="seek"]');
      if (r) r.value = String(Math.round(p * 1000));
      const cur = foot.querySelector('[data-cur]');
      if (cur) cur.textContent = pv;
      const b = foot.querySelector('.rf-pct');
      if (b) b.textContent = pv;
    },
    // 바가 숨어 있을 때 화면 맨 아래 진행선을 잠깐 보여 줌
    flashLine() {
      if (!foot.hasAttribute('data-hidden')) return;
      const el = pop.querySelector('.rd-line');
      if (!el) return;
      el.classList.add('is-on');
      clearTimeout(lineTimer);
      lineTimer = setTimeout(() => el.classList.remove('is-on'), 1000);
    },
    setTitle(small, title) { opts.small = small; opts.title = title; if (!searching) drawTop(); },
    setNav(prev, next) { opts.prev = prev; opts.next = next; drawFoot(); },
    setAuto(state) { autoState = state; if (!searching) drawTop(); drawPop(); },
    refreshInfo() { if (infoOpen) drawPop(); },
    openSearch,
    closeSearch,
    // 바를 뺀 실제 읽는 영역 (넘기기·위치 기준)
    edges() {
      // 전체 화면의 검은 띠(카메라 구멍 자리) 아래부터가 읽는 영역
      const notch = pop.querySelector('.rd-notch')?.getBoundingClientRect().height || 0;
      const t = Math.max(notch, top.hasAttribute('data-hidden') ? 0 : top.getBoundingClientRect().bottom);
      const b = foot.hasAttribute('data-hidden') ? window.innerHeight : Math.min(window.innerHeight, foot.getBoundingClientRect().top);
      return { top: t, bottom: b };
    },
    destroy() {
      offAction();
      clearTimeout(st);
      clearTimeout(lineTimer);
      ro?.disconnect();
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keydown', onDocKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('click', onClickBlur, true);
    },
  };
}
