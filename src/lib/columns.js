// 칼럼 목록·본문 불러오기
//   목록은 기기에 캐시해 두고 먼저 보여준 뒤 새로 받아 갱신
import { supabase } from './supabase.js';
import { STORAGE_BUCKET } from '../config.js';

const LIST_KEY = 'list:columns';
const FIELDS = 'id,title,category,published_at,tags,md_path,links,source_url,author';

let list = null;
let fetchedAt = 0;

export function cachedColumns() {
  if (list) return list;
  try { list = JSON.parse(localStorage.getItem(LIST_KEY) || 'null'); } catch { list = null; }
  return list;
}

export async function loadColumns({ force = false } = {}) {
  if (!force && list && Date.now() - fetchedAt < 120_000) return list;
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('columns').select(FIELDS)
      .order('published_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + 999);
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
export async function fetchMd(col) {
  if (mdCache.has(col.id)) return mdCache.get(col.id);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(col.md_path);
  if (error) throw error;
  const text = await data.text();
  mdCache.set(col.id, text);
  if (mdCache.size > 30) mdCache.delete(mdCache.keys().next().value);
  return text;
}

// 이미지 서명 주소 (1시간). 같은 경로는 재사용
const signed = new Map();   // path → { url, exp }
export async function signImages(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !(signed.get(p)?.exp > now + 60_000));
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(chunk, 3600);
    if (error) throw error;
    for (const d of data || []) if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, exp: now + 3600_000 });
  }
  return Object.fromEntries(paths.map((p) => [p, signed.get(p)?.url]).filter(([, u]) => u));
}

export function fmtDate(iso, withYear = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return withYear ? `${d.getFullYear()}.${mm}.${dd}` : `${mm}.${dd}`;
}
export const monthOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; };
