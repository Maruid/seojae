// 다른 기기에서 더 읽은 위치 알림
//   글을 연 뒤 서버 기록을 받아 보니, 이 기기에서 쓰지 않은 더 새 기록이 있고 위치가 다르면
//   화면 아래에 "다른 기기에서 …까지 읽었어요 [이동]" (12초 뒤 사라짐, 누르면 그 위치로)
import { html, mount, onAction } from '../lib/dom.js';
import { icon } from './icons.js';

let el = null;
let timer = null;
export function closeOtherDevice() {
  clearTimeout(timer);
  el?.remove();
  el = null;
}

export function offerOtherDevice({ text, go, goLabel = '이동' }) {
  closeOtherDevice();
  el = document.createElement('div');
  el.className = 'od-bar';
  el.setAttribute('role', 'status');
  mount(el, html`
    <span class="od-ic" aria-hidden="true">${icon('next', 16, 2.2)}</span>
    <span class="od-t">${text}</span>
    <button type="button" class="od-go" data-action="go">${goLabel}</button>
    <button type="button" class="od-x" data-action="x" aria-label="닫기">${icon('close', 16)}</button>`);
  onAction(el, { go() { closeOtherDevice(); go(); }, x() { closeOtherDevice(); } });
  document.body.appendChild(el);
  timer = setTimeout(closeOtherDevice, 12000);
}

// 기록 묶음에서 가장 최근 (updated_at)
export function latestRow(rows) {
  let best = null;
  for (const [k, r] of Object.entries(rows || {})) if (r && (!best || String(r.updated_at) > String(best.r.updated_at))) best = { k, r };
  return best;
}
