// 오프라인 보관함 저장소
//   - 파일: Cache API 'seojae-content-dl' (열어 본 글 저장 공간 'seojae-content' 와 따로, 개수 제한 없음)
//       주소 키는 서비스 워커와 같은 규칙: Storage 주소에서 ?토큰 을 뺀 것
//   - 기록: IndexedDB 'seojae-offline'
//       items: novel(n:<id>) · chapter(c:<id>/<key>) · column(col:<id>)
//       kv:    lastOnline(마지막 온라인 확인) · job(받다 만 작업) · notices(알림)
//   - 로그아웃·차단 시 둘 다 지움 (clearOffline)
import { SUPABASE_URL, STORAGE_BUCKET } from '../../config.js';
import { nativeDlReady, nativeDl, fileSrc } from '../native.js';

export const DL_CACHE = 'seojae-content-dl';
export const CONTENT_CACHE = 'seojae-content';
const DB_NAME = 'seojae-offline';

// ---- 주소 키 ----
export const objectKey = (path) => new URL(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`).href;
export const signKey = (path) => new URL(`${SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}/${path}`).href;

// ---- IndexedDB ----
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const items = d.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('kind', 'kind');
      items.createIndex('novelId', 'novelId');
      d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getItem = (id) => tx('items', 'readonly', (s) => req(s.get(id))).catch(() => undefined);
export const putItems = (list) => tx('items', 'readwrite', (s) => { list.forEach((x) => s.put(x)); });
export const deleteItems = (ids) => tx('items', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
export const itemsOfKind = (kind) => tx('items', 'readonly', (s) => req(s.index('kind').getAll(kind))).catch(() => []);
export const itemsOfNovel = (novelId) => tx('items', 'readonly', (s) => req(s.index('novelId').getAll(novelId))).catch(() => []);

export const kvGet = (k) => tx('kv', 'readonly', (s) => req(s.get(k))).then((r) => r?.v).catch(() => undefined);
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => { if (v === undefined) s.delete(k); else s.put({ k, v }); }).catch(() => {});

// ---- 앱 2+: 화면이 꺼져도 받은 파일은 앱 저장 공간(files/dl/<이름>)에 ----
//   이름 = 주소 키의 SHA-256 앞 40자 + 확장자 (앱·웹이 같은 규칙으로 계산)
const native = { ready: null, dir: '', names: new Set() };
export function initNativeFiles() {
  if (!native.ready) {
    native.ready = (async () => {
      if (!(await nativeDlReady())) return false;
      try {
        native.dir = (await nativeDl.info()).dir;
        native.names = new Set((await nativeDl.list()).names || []);
        return true;
      } catch { return false; }
    })();
  }
  return native.ready;
}
export async function nativeName(key) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  const ext = (new URL(key).pathname.match(/\.(txt|md|webp|jpe?g|png|gif)$/i) || [''])[0].toLowerCase();
  return hex + ext;
}
export const noteNativeFile = (name) => native.names.add(name);
async function nativeFile(key) {
  if (!(await initNativeFiles())) return null;
  const name = await nativeName(key);
  if (!native.names.has(name)) return null;
  try { const r = await fetch(fileSrc(`${native.dir}/${name}`)); return r.ok ? r : null; } catch { return null; }
}

// ---- 파일 ----
export async function dlCache() { return caches.open(DL_CACHE); }
export async function putFile(key, body, type) {
  const c = await dlCache();
  await c.put(key, new Response(body, { headers: { 'content-type': type || 'application/octet-stream' } }));
}
export async function hasFile(key) {
  if ((await initNativeFiles()) && native.names.has(await nativeName(key))) return true;
  return !!(await (await dlCache()).match(key, { ignoreVary: true }));
}
export async function getFile(key) {
  return (await nativeFile(key)) || (await dlCache()).match(key, { ignoreVary: true });
}
export async function deleteFiles(keys) {
  const c = await dlCache();
  await Promise.all(keys.map((k) => c.delete(k)));
  if (await initNativeFiles()) {
    const names = (await Promise.all(keys.map(nativeName))).filter((n) => native.names.has(n));
    if (names.length) { names.forEach((n) => native.names.delete(n)); await nativeDl.remove(names).catch(() => {}); }
  }
}
// 열어 본 글 저장 공간에 이미 있는 것 (옮겨 담으면 서버에서 받지 않아도 됨 → 한도 안 씀)
export async function fromViewed(key) {
  if (typeof caches === 'undefined') return null;
  const c = await caches.open(CONTENT_CACHE);
  return c.match(key, { ignoreVary: true });
}

// 앱에는 서비스 워커가 없으므로 열어 본 글을 직접 저장 (웹은 서비스 워커가 함). 400개 넘으면 오래된 것부터
export async function rememberViewed(key, body, type) {
  if (typeof caches === 'undefined') return;
  try {
    const c = await caches.open(CONTENT_CACHE);
    await c.put(key, new Response(body, { headers: { 'content-type': type } }));
    const keys = await c.keys();
    for (let i = 0; i < keys.length - 400; i++) await c.delete(keys[i]);
  } catch {}
}

// ---- 알림 (관리 창에 한 번 보여 줌) ----
export async function addNotice(text) {
  const list = (await kvGet('notices')) || [];
  list.push({ text, at: Date.now() });
  await kvSet('notices', list.slice(-10));
}
export async function takeNotices() {
  const list = (await kvGet('notices')) || [];
  if (list.length) await kvSet('notices', []);
  return list;
}

// ---- 30일 잠금용 ----
export const markOnline = () => kvSet('lastOnline', Date.now());
export const lastOnline = () => kvGet('lastOnline');

// ---- 모두 지우기 (로그아웃·차단) ----
export async function clearOffline() {
  try { if (typeof caches !== 'undefined') await caches.delete(DL_CACHE); } catch {}
  try { if (await nativeDlReady()) { await nativeDl.clear(); native.names.clear(); } } catch {}
  try {
    if (dbp) { (await dbp).close(); dbp = null; }
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  } catch {}
}
