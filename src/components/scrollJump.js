// 긴 목록의 맨 위·맨 아래 바로 가기 버튼 (소설 목록 · 회차 목록)
//   - 스크롤하면 오른쪽 아래(하단 탭 위)에 나타났다가 2초 멈추면 사라짐
//   - 맨 위 근처에서는 ↑, 맨 아래 근처에서는 ↓ 를 숨김
//   - extra: { label, run } 를 주면 가운데에 버튼 하나 더 (회차 목록의 "읽던 회차")
import { html, mount } from '../lib/dom.js';
import { icon } from './icons.js';

export function attachScrollJump(view, { extra = null, minHeight = 1.6 } = {}) {
  const el = document.createElement('div');
  el.className = 'sj';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', '목록 바로 가기');
  document.body.append(el);   // 화면(view)을 다시 그려도 사라지지 않게 body 에
  let timer = null;
  let hovering = false;
  let ex = extra;

  const doc = () => document.scrollingElement || document.documentElement;
  const draw = () => {
    const d = doc();
    const top = window.scrollY < 200;
    const bottom = window.scrollY > d.scrollHeight - window.innerHeight - 200;
    mount(el, html`
      ${!top ? html`<button type="button" data-sj="top" aria-label="맨 위로">${icon('up', 20)}</button>` : ''}
      ${ex ? html`<button type="button" data-sj="extra" class="sj-text">${ex.label}</button>` : ''}
      ${!bottom ? html`<button type="button" data-sj="bottom" aria-label="맨 아래로">${icon('down', 20)}</button>` : ''}`);
  };
  const show = () => {
    // 화면보다 많이 길 때만
    if (doc().scrollHeight < window.innerHeight * minHeight) { el.classList.remove('is-on'); return; }
    draw();
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => { if (!hovering) el.classList.remove('is-on'); }, 2000);
  };
  const onClick = (e) => {
    const b = e.target.closest('[data-sj]');
    if (!b) return;
    const k = b.dataset.sj;
    if (k === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
    else if (k === 'bottom') window.scrollTo({ top: doc().scrollHeight, behavior: 'instant' });
    else ex?.run();
    setTimeout(show, 50);
  };
  // 마우스를 올려 둔 동안은 사라지지 않게 (터치는 해당 없음)
  const enter = (e) => { if (e.pointerType === 'mouse') { hovering = true; clearTimeout(timer); } };
  const leave = (e) => { if (e.pointerType === 'mouse') { hovering = false; show(); } };
  window.addEventListener('scroll', show, { passive: true });
  el.addEventListener('click', onClick);
  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointerleave', leave);
  return {
    setExtra(x) { ex = x; if (el.classList.contains('is-on')) draw(); },
    destroy() {
      clearTimeout(timer);
      window.removeEventListener('scroll', show);
      el.remove();
    },
  };
}
