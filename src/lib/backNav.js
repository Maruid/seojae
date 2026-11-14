// 방문 기록이 쌓이는 방식 + 앱의 뒤로가기 버튼
//   - 회차↔회차, 칼럼 글↔글 이동은 기록을 쌓지 않고 지금 칸을 바꿈 (몇 화를 읽든 읽기 화면은 1칸)
//   - 읽기 화면에서 목록으로 가는 링크(<, 회차 목록)는 바로 앞 칸이 그 목록이면 진짜 뒤로
//   - 아래 탭·사이드바: 홈에서 누르면 쌓고, 탭끼리는 바꿈 (뒤로 = 홈)
//   - 앱 뒤로가기: 열린 창 닫기 → 읽기 화면은 목록으로 → 하위 화면은 위 단계로 → 탭은 홈으로 → 홈은 "한 번 더 누르면 종료"
import { match, navigate, goUp, currentPath } from '../router.js';

const TAB_ROOTS = new Set(['columns', 'novels', 'me', 'admin']);

// 지금 화면의 위 단계 (없으면 null = 홈)
export function parentOf(r) {
  switch (r.name) {
    case 'chapter': return `/n/${encodeURIComponent(r.params.id)}`;
    case 'column': return '/columns';
    case 'novel': return '/novels';
    case 'downloads':
    case 'install': return '/me';
    default: return TAB_ROOTS.has(r.name) ? '/' : null;
  }
}

function sameReader(from, to) {
  if (from.name === 'chapter' && to.name === 'chapter') return from.params.id === to.params.id;
  return from.name === 'column' && to.name === 'column';
}

export function installLinkPolicy() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || a.target) return;
    const href = a.getAttribute('href');
    const from = match(location.hash);
    const to = match(href);
    const path = href.slice(1);
    if (currentPath() === path.split('?')[0] && !path.includes('?')) return;
    if (sameReader(from, to)) { e.preventDefault(); navigate(path, { replace: true }); return; }
    const up = parentOf(from);
    if (up && up === path) { e.preventDefault(); goUp(path); return; }
    if (a.closest('[data-tabs], [data-side]') && from.name !== 'home' && (TAB_ROOTS.has(from.name) || to.name === 'home')) {
      e.preventDefault();
      if (to.name === 'home') goUp('/'); else navigate(path, { replace: true });
    }
  }, true);
}

// ---- 앱 뒤로가기 버튼 ----
// 열린 창이 있으면 Esc 를 보내 닫게 함. 창들은 Esc 를 받으면 전파를 멈추거나 기본 동작을 막음 → 처리됨
function closeOverlay() {
  let reached = false;
  const mark = (ev) => { if (ev.seojaeBack) reached = true; };
  window.addEventListener('keydown', mark);
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  ev.seojaeBack = true;
  (document.activeElement && document.activeElement !== document.body ? document.activeElement : document).dispatchEvent(ev);
  window.removeEventListener('keydown', mark);
  return !reached || ev.defaultPrevented;
}

let exitAt = 0;
export function handleBack({ toast, exitApp }) {
  if (closeOverlay()) return;
  const r = match(location.hash);
  const up = parentOf(r);
  if (up) { goUp(up); return; }
  const now = Date.now();
  if (now - exitAt < 2000) { exitApp(); return; }
  exitAt = now;
  toast('한 번 더 누르면 종료돼요');
}
