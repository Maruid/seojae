// 반응형 껍데기
//   ~1023px: 하단 탭바 / 1024px~: 왼쪽 사이드바 (창 폭 기준)
import { html, mount } from '../lib/dom.js';
import { tabsFor, activeTab } from '../lib/nav.js';
import { icon } from './icons.js';

let shell = null;   // { root, content, nav, side }

export function renderShell(app, routeName, { immersive = false, compact = false } = {}) {
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
        <main data-content class="flex-1 min-w-0 pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-0"></main>
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

// 로그인·승인 대기처럼 메뉴가 없는 화면
export function renderBare() {
  shell = null;
  return document.getElementById('app');
}

export function initial(me) {
  const n = me?.profile?.display_name || me?.profile?.email || '?';
  return n.trim().charAt(0).toUpperCase();
}
