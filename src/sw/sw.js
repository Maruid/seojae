/* 서재 Service Worker — 빌드 때 vite.config.js 가 __VERSION__ / __PRECACHE__ 를 채워 dist/sw.js 로 만듦
 *   - 앱 화면(HTML·JS·CSS·아이콘): 미리 저장 → 인터넷 없어도 앱이 열림
 *   - 글꼴: 한 번 받은 건 저장해 두고 뒤에서 새로 고침
 *   - 본문(칼럼 .md · 소설 회차 .txt · 이미지): 열어 본 것만 저장 (seojae-content)
 *       본문은 새로 받은 걸 우선, 실패하면 저장본 / 이미지는 저장본 우선
 *       로그아웃·차단 시 앱이 seojae-content 를 지움
 *   - 로그인·목록·읽기 기록(API)은 저장하지 않음 (앱이 따로 기기 캐시 사용)
 *   - 다운로드한 글(seojae-content-dl): 앱이 직접 넣고 지움. 여기서는 오프라인 대체로만 찾아 봄
 *       앱의 다운로드 요청(cache: 'no-store')은 건드리지 않음 → 열어 본 글 저장 공간이 밀려나지 않음
 */
const VERSION = '__VERSION__';
const SHELL = `seojae-shell-${VERSION}`;
const CONTENT = 'seojae-content';
const DL = 'seojae-content-dl';
const FONTS = 'seojae-fonts';
const PRECACHE = __PRECACHE__;
const CONTENT_MAX = 400;

const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map(scopeUrl))));
  // 새 버전은 사용자가 배너에서 "새로고침"을 누를 때 적용 (읽는 도중 화면이 바뀌지 않게)
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('seojae-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// 열어 본 글 → 다운로드한 글 순서로 찾기
async function matchStored(key) {
  const a = await (await caches.open(CONTENT)).match(key, { ignoreVary: true });
  if (a) return a;
  return (await caches.open(DL)).match(key, { ignoreVary: true });
}

async function networkFirst(req, cacheName, key, timeout = 0) {
  const cache = await caches.open(cacheName);
  try {
    const net = fetch(req);
    const res = await (timeout ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]) : net);
    if (res.ok) { cache.put(key, res.clone()); if (cacheName === CONTENT) trim(cache, CONTENT_MAX); }
    return res;
  } catch (err) {
    const hit = cacheName === CONTENT ? await matchStored(key) : await cache.match(key, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  const hit = cacheName === CONTENT ? await matchStored(key) : await cache.match(key, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { cache.put(key, res.clone()); if (cacheName === CONTENT) trim(cache, CONTENT_MAX); }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 앱 화면
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // 오프라인이면 바로 저장본, 연결이 약하면 1.5초만 기다림
      if (self.navigator && self.navigator.onLine === false) {
        e.respondWith(caches.match(scopeUrl('index.html'), { ignoreVary: true }).then((hit) => hit || fetch(req)));
        return;
      }
      e.respondWith(networkFirst(req, SHELL, scopeUrl('index.html'), 1500)
        .catch(() => caches.match(scopeUrl('index.html'), { ignoreVary: true })));
      return;
    }
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));   // 모듈 스크립트는 Origin 헤더가 달라 Vary 무시
    return;
  }

  // 글꼴
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard'))) {
    e.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }

  // Supabase Storage (본문·이미지). 서명 토큰 등 주소 뒤 ?… 는 빼고 저장
  if (url.pathname.includes('/storage/v1/object/')) {
    if (req.cache === 'no-store') return;   // 앱의 다운로드 요청
    const key = url.origin + url.pathname;
    if (url.pathname.includes('/object/sign/')) e.respondWith(cacheFirst(req, CONTENT, key));
    else e.respondWith(networkFirst(req, CONTENT, key, 8000));
  }
});
