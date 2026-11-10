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

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) history.replaceState(null, '', target);
  else location.hash = path;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function startRouter(onRoute) {
  const run = () => onRoute(match(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
