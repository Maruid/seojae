// 해시 라우터: #/c/<id>, #/n/<id>/<key> 형태
//   match() 는 순수 함수라 테스트에서 바로 씀

export const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'columns', path: '/columns' },
  { name: 'column', path: '/c/:id' },
  { name: 'novels', path: '/novels' },
  { name: 'novel', path: '/n/:id' },
  { name: 'chapter', path: '/n/:id/:key' },
  { name: 'me', path: '/me' },
  { name: 'downloads', path: '/downloads' },
  { name: 'admin', path: '/admin' },
  { name: 'install', path: '/install' },
];

export function match(hash, routes = ROUTES) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart));

  for (const r of routes) {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].startsWith(':')) params[rs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { name: r.name, params, query };
  }
  return { name: 'notfound', params: {}, query };
}

// ---- 방문 기록 (뒤로가기 판단용) ----
//   history.state.i = 이 기록의 칸 번호, stack[i] = 그 칸의 주소 (sessionStorage 에 보관 → 새로고침해도 유지)
let idx = -1;
let stack = [];
try { stack = JSON.parse(sessionStorage.getItem('nav:stack') || '[]'); } catch {}
const saveStack = () => { try { sessionStorage.setItem('nav:stack', JSON.stringify(stack.slice(-60))); } catch {} };
const bare = (h) => (h || '').replace(/^#/, '').split('?')[0] || '/';
function track() {
  const st = history.state;
  if (st && typeof st.i === 'number') idx = st.i;           // 뒤로·앞으로 또는 바꾸기
  else { idx += 1; stack.length = Math.max(0, idx); history.replaceState({ i: idx }, '', location.hash || '#/'); }   // 새 칸
  stack[idx] = location.hash || '#/';
  saveStack();
}
/** 바로 앞 칸이 path 면 진짜 뒤로, 아니면 지금 칸을 path 로 바꿈 (기록이 쌓이지 않게) */
export function goUp(path) {
  if (idx > 0 && bare(stack[idx - 1]) === bare(path)) history.back();
  else navigate(path, { replace: true });
}
export const currentPath = () => bare(location.hash);

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) history.replaceState({ i: Math.max(0, idx) }, '', target);
  else location.hash = path;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function startRouter(onRoute) {
  const run = () => { track(); onRoute(match(location.hash)); };
  window.addEventListener('hashchange', run);
  run();
}
