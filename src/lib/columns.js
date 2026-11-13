// 칼럼 목록·본문 불러오기
//   목록은 기기에 캐시해 두고 먼저 보여준 뒤 새로 받아 갱신
import { supabase, isOffline, offlineError } from './supabase.js';
import { STORAGE_BUCKET } from '../config.js';
import { savedColumnMd, replaceColumnMd, savedImageUrl } from './offline/index.js';
import { signKey, objectKey, fromViewed } from './offline/store.js';

const LIST_KEY = 'list:columns';
const BASE = 'id,title,category,published_at,tags,md_path,links,source_url,author,content_hash,size_bytes';
let fields = `${BASE},image_bytes,image_count`;   // 008 전이면 이미지 크기 칸 없이

let list = null;
let fetchedAt = 0;

export function cachedColumns() {
  if (list) return list;
  try { list = JSON.parse(localStorage.getItem(LIST_KEY) || 'null'); } catch { list = null; }
  return list;
}

export async function loadColumns({ force = false } = {}) {
  if (!force && list && Date.now() - fetchedAt < 120_000) return list;
  if (isOffline()) { if (cachedColumns()) return list; throw offlineError(); }
  const all = [];
  for (let from = 0; ; from += 1000) {
    const q = () => supabase.from('columns').select(fields)
      .order('published_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + 999);
    let { data, error } = await q();
    if (error?.code === '42703' && fields !== BASE) { fields = BASE; ({ data, error } = await q()); }
    if (error) { if (cachedColumns()) return list; throw error; }
    all.push(...data);
    if (data.length < 1000) break;
  }
  list = all;
  fetchedAt = Date.now();
  try { localStorage.setItem(LIST_KEY, JSON.stringify(all)); } catch {}
  return list;
}

export const columnById = (id) => (cachedColumns() || []).find((c) => c.id === id) || null;

// 대구분 목록 (글 수 많은 순)
export function categoriesOf(cols) {
  const m = new Map();
  for (const c of cols) m.set(c.category || '기타', (m.get(c.category || '기타') || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

// 본문 .md (같은 세션 안에서는 메모리에 보관)
const mdCache = new Map();
//   받아 둔 칼럼은 저장본이 최신이면 그걸, 바뀌었으면 서버에서 받아 저장본도 바꿔 넣음 (한도 안 씀)
export async function fetchMd(col) {
  if (mdCache.has(col.id)) return mdCache.get(col.id);
  const saved = await savedColumnMd(col).catch(() => null);
  let text = saved?.text;
  if (text == null && isOffline()) {
    const hit = await fromViewed(objectKey(col.md_path)).catch(() => null);
    if (!hit) throw offlineError();
    text = await hit.text();
  }
  if (text == null) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(col.md_path);
    if (error) {
      const old = saved?.stale ? await savedColumnMd({ ...col, content_hash: null }).catch(() => null) : null;
      if (old?.text == null) throw error;
      text = old.text;
    } else {
      text = await data.text();
      if (saved?.stale) replaceColumnMd(col, text).catch(() => {});
    }
  }
  mdCache.set(col.id, text);
  if (mdCache.size > 30) mdCache.delete(mdCache.keys().next().value);
  return text;
}

// 이미지 서명 주소 (1시간). 같은 경로는 재사용
const signed = new Map();   // path → { url, exp }
//   받아 둔 이미지는 기기 저장본(blob 주소), 오프라인이면 토큰 없는 주소 → 서비스 워커가 열어 본 저장본에서 찾음
export async function signImages(paths) {
  const now = Date.now();
  const local = {};
  await Promise.all([...new Set(paths)].map(async (p) => { const u = await savedImageUrl(p).catch(() => null); if (u) local[p] = u; }));
  if (!navigator.onLine) {
    return Object.fromEntries(paths.map((p) => [p, local[p] || signed.get(p)?.url || `${signKey(p)}?token=offline`]));
  }
  const need = [...new Set(paths)].filter((p) => !local[p] && !(signed.get(p)?.exp > now + 60_000));
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(chunk, 3600);
    if (error) throw error;
    for (const d of data || []) if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, exp: now + 3600_000 });
  }
  return Object.fromEntries(paths.map((p) => [p, local[p] || signed.get(p)?.url]).filter(([, u]) => u));
}

export function fmtDate(iso, withYear = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return withYear ? `${d.getFullYear()}.${mm}.${dd}` : `${mm}.${dd}`;
}
export const monthOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; };
