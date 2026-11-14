// 반응형 껍데기
//   ~1023px: 하단 탭바 / 1024px~: 왼쪽 사이드바 (창 폭 기준)
import { html, mount } from '../lib/dom.js';
import { tabsFor, activeTab } from '../lib/nav.js';
import { icon } from './icons.js';

let shell = null;   // { root, content, nav, side }
let last = null;    // 마지막 renderShell 인자 (창 폭이 바뀌면 사이드바만 다시 그림)

// 칼럼·회차 읽기처럼 목록+본문을 나란히 두는 화면은 창이 좁은 PC(1024~1399px)에서만 아이콘 사이드바
const NARROW_PC = '(min-width: 1024px) and (max-width: 1399.98px)';
const narrowMq = matchMedia(NARROW_PC);
narrowMq.addEventListener('change', () => { if (shell && last) renderShell(...last); });

export function renderShell(app, routeName, { immersive = false, narrowable = false } = {}) {
  last = [app, routeName, { immersive, narrowable }];
  const compact = narrowable && narrowMq.matches;
  const tabs = tabsFor(app.me);
  const active = activeTab(tabs, routeName);
  const badge = (t) => (t.key === 'admin' && app.pendingCount
    ? html`<span class="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-bold inline-flex items-center justify-center" aria-label="승인 대기 ${app.pendingCount}명">${app.pendingCount}</span>`
    : '');

  if (!shell) {
    const root = document.getElementById('app');
    mount(root, html`
      <div class="shell min-h-dvh lg:flex">
        <nav data-side aria-label="주 메뉴" class="hidden lg:flex lg:flex-col lg:gap-1 lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh lg:px-4 lg:py-6 lg:border-r lg:border-line lg:bg-surface"></nav>
        <main data-content class="flex-1 min-w-0 pb-[calc(72px+var(--sab))] lg:pb-0"></main>
        <nav data-tabs aria-label="주 메뉴" class="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-line safe-bottom"></nav>
      </div>`);
    shell = { root, content: root.querySelector('[data-content]'), tabs: root.querySelector('[data-tabs]'), side: root.querySelector('[data-side]') };
  }

  mount(shell.tabs, html`
    <div class="grid h-[72px]" style="grid-template-columns: repeat(${tabs.length}, minmax(0, 1fr))">
      ${tabs.map((t) => html`
        <a href="${t.href}" ${t.key === active ? html`aria-current="page"` : ''}
           class="relative flex flex-col items-center justify-center gap-1 text-[11px] no-underline ${t.key === active ? 'text-ink font-bold' : 'text-muted'}">
          ${icon(t.icon)}${t.label}
          ${t.key === 'admin' && app.pendingCount ? html`<span class="absolute top-2.5 left-[calc(50%+6px)]">${badge(t)}</span>` : ''}
        </a>`)}
    </div>`);

  const shellEl = shell.root.firstElementChild;
  if (immersive) shellEl.dataset.immersive = ''; else delete shellEl.dataset.immersive;
  shell.side.style.width = compact ? '76px' : '232px';
  shell.side.style.paddingLeft = shell.side.style.paddingRight = compact ? '12px' : '';

  mount(shell.side, compact ? html`
    <a href="#/" class="font-serif text-xl font-bold text-ink no-underline text-center pb-5" title="서재 홈">서재</a>
    ${tabs.map((t) => html`
      <a href="${t.href}" ${t.key === active ? html`aria-current="page"` : ''} title="${t.label}" aria-label="${t.label}"
         class="relative h-12 rounded-[12px] flex items-center justify-center no-underline ${t.key === active ? 'bg-chip text-ink' : 'text-muted hover-mouse:bg-chip/60'}">
        ${icon(t.icon, 22)}
        ${t.key === 'admin' && app.pendingCount ? html`<span class="absolute top-1 right-1">${badge(t)}</span>` : ''}
      </a>`)}
    <div class="mt-auto pt-3 border-t border-line-soft flex justify-center">
      <span class="w-8 h-8 rounded-full bg-chip text-muted font-bold text-[13px] flex items-center justify-center" title="${app.me?.profile?.display_name || ''}">${initial(app.me)}</span>
    </div>` : html`
    <a href="#/" class="font-serif text-2xl font-bold text-ink no-underline px-3 pb-5">서재</a>
    ${tabs.map((t) => html`
      <a href="${t.href}" ${t.key === active ? html`aria-current="page"` : ''}
         class="h-11 px-3 rounded-[10px] flex items-center gap-3 no-underline text-[15px] ${t.key === active ? 'bg-chip text-ink font-bold' : 'text-muted hover-mouse:bg-chip/60'}">
        ${icon(t.icon, 20)}<span class="flex-1">${t.label}</span>${badge(t)}
      </a>`)}
    <div class="mt-auto px-3 pt-3 border-t border-line-soft flex items-center gap-2.5 text-sm">
      <span class="w-8 h-8 rounded-full bg-chip text-muted font-bold text-[13px] flex items-center justify-center">${initial(app.me)}</span>
      <span class="truncate">${app.me?.profile?.display_name || ''}</span>
    </div>`);

  shell.root.querySelector('[data-tabs]').hidden = false;
  return shell.content;
}

// 오프라인 표시
//   - html.is-offline: 읽기 화면 위 바의 작은 "오프라인" 표시를 켬 (CSS)
//   - 목록·홈·내 정보: 내용 맨 위에 얇은 한 줄 (고정 아님, 스크롤하면 같이 올라감). 읽기 화면에는 없음
export function syncOfflineNote(on, reading) {
  document.documentElement.classList.toggle('is-offline', on);
  const box = shell?.content;
  if (!box) return;
  let el = box.querySelector(':scope > .off-note');
  if (!on || reading) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.className = 'off-note';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>오프라인 · 받아 둔 글과 열어 본 글만 볼 수 있어요</span><a href="#/downloads">보관함 ›</a>';
  box.prepend(el);
}

// 로그인·승인 대기처럼 메뉴가 없는 화면
export function renderBare() {
  shell = null;
  return document.getElementById('app');
}

export function initial(me) {
  const n = me?.profile?.display_name || me?.profile?.email || '?';
  return n.trim().charAt(0).toUpperCase();
}
